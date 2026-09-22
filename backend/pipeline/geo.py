"""
Geolocalizzazione degli indirizzi IP, con cache su disco.

La mappa ha bisogno di una coordinata per sessione, ma l'honeypot registra solo
un indirizzo. Tradurre l'uno nell'altra e' l'unico passo della pipeline che
puo' aver bisogno della rete, quindi e' anche l'unico che va tenuto sotto
controllo:

* la cache (`data/ip_cache.json`) e' la sorgente primaria e sopravvive alle
  esecuzioni successive: reimportare i log non ripete le richieste;
* `cache` (predefinito) non contatta nessuno: gli indirizzi sconosciuti restano
  senza coordinate e vengono contati nel resoconto finale;
* `ip-api` risolve gli sconosciuti con ip-api.com, a blocchi di 100 e con la
  pausa imposta dal limite del servizio gratuito;
* `maxmind` usa un database GeoLite2 locale: nessun indirizzo esce dalla
  macchina, il risultato e' deterministico e quindi riproducibile.

L'ultimo punto non e' un dettaglio tecnico: gli indirizzi IP degli attaccanti
sono dati personali, e risolverli in locale evita di trasferirli a terzi.
"""

import json
import os
import time
import urllib.request

IP_API_URL = "http://ip-api.com/batch"
IP_API_FIELDS = "status,country,city,lat,lon,query"
IP_API_CHUNK = 100
# Il servizio gratuito concede 45 richieste al minuto: una pausa di 1,5s fra i
# blocchi resta comodamente sotto la soglia.
IP_API_PAUSE = 1.5


class GeoCache:
    """Mappa indirizzo -> {location, latitude, longitude}, persistente."""

    def __init__(self, path):
        self.path = path
        self.entries = {}
        self.resolved_now = 0
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as handle:
                    self.entries = json.load(handle)
            except (ValueError, OSError):
                self.entries = {}

    def __len__(self):
        return len(self.entries)

    def get(self, ip):
        return self.entries.get(ip)

    def save(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(self.entries, handle, ensure_ascii=False)
        os.replace(tmp, self.path)

    def missing(self, ips):
        return sorted(ip for ip in ips if ip and ip not in self.entries)

    def bootstrap_from_parquet(self, parquet_path):
        """Riprende gli indirizzi gia' risolti da un dataset esistente.

        Evita di ripetere da capo la risoluzione di tutti gli indirizzi quando
        il dataset e' gia' stato geolocalizzato in passato.
        """
        import duckdb

        con = duckdb.connect()
        rows = con.execute(
            f"""
            SELECT DISTINCT src_ip, location, latitude, longitude
            FROM '{parquet_path.replace(os.sep, '/')}'
            WHERE src_ip IS NOT NULL AND latitude IS NOT NULL
            """
        ).fetchall()
        con.close()

        added = 0
        for src_ip, location, latitude, longitude in rows:
            if src_ip in self.entries:
                continue
            self.entries[src_ip] = {
                "location": location,
                "latitude": latitude,
                "longitude": longitude,
            }
            added += 1

        self.save()
        return added

    def resolve_missing(self, ips, mode, mmdb_path=None, on_progress=None):
        """Risolve gli indirizzi non ancora in cache, secondo la modalita'."""
        pending = self.missing(ips)
        if not pending or mode == "cache":
            return 0

        if mode == "ip-api":
            resolved = self._resolve_ip_api(pending, on_progress)
        elif mode == "maxmind":
            resolved = self._resolve_maxmind(pending, mmdb_path, on_progress)
        else:
            raise ValueError(f"Modalita' di geolocalizzazione sconosciuta: {mode}")

        self.resolved_now += resolved
        self.save()
        return resolved

    def _resolve_ip_api(self, pending, on_progress):
        resolved = 0

        for start in range(0, len(pending), IP_API_CHUNK):
            chunk = pending[start : start + IP_API_CHUNK]
            payload = json.dumps(
                [{"query": ip, "fields": IP_API_FIELDS} for ip in chunk]
            ).encode("utf-8")
            request = urllib.request.Request(
                IP_API_URL,
                data=payload,
                headers={"Content-Type": "application/json"},
            )

            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    results = json.loads(response.read().decode("utf-8"))
            except Exception as error:  # rete assente, timeout, quota esaurita
                print(f"  geolocalizzazione interrotta: {error}")
                break

            for result in results:
                ip = result.get("query")
                if not ip or result.get("status") != "success":
                    continue
                city, country = result.get("city"), result.get("country")
                self.entries[ip] = {
                    "location": ", ".join(part for part in (city, country) if part)
                    or None,
                    "latitude": result.get("lat"),
                    "longitude": result.get("lon"),
                }
                resolved += 1

            if on_progress is not None:
                on_progress(min(start + IP_API_CHUNK, len(pending)), len(pending))

            # La cache viene salvata a ogni blocco: se il processo si ferma a
            # meta', il lavoro gia' fatto non si perde.
            self.save()
            time.sleep(IP_API_PAUSE)

        return resolved

    def _resolve_maxmind(self, pending, mmdb_path, on_progress):
        try:
            import geoip2.database
        except ImportError:
            raise SystemExit(
                "La modalita' maxmind richiede il pacchetto geoip2:\n"
                "    pip install geoip2\n"
                "e un database GeoLite2-City.mmdb scaricato dal proprio "
                "account MaxMind (--mmdb)."
            )

        if not mmdb_path or not os.path.exists(mmdb_path):
            raise SystemExit(
                "Database GeoLite2 non trovato: indicarlo con --mmdb "
                "/percorso/GeoLite2-City.mmdb"
            )

        resolved = 0
        with geoip2.database.Reader(mmdb_path) as reader:
            for idx, ip in enumerate(pending, start=1):
                try:
                    answer = reader.city(ip)
                except Exception:
                    continue
                if answer.location.latitude is None:
                    continue
                city = answer.city.name
                country = answer.country.name
                self.entries[ip] = {
                    "location": ", ".join(part for part in (city, country) if part)
                    or None,
                    "latitude": answer.location.latitude,
                    "longitude": answer.location.longitude,
                }
                resolved += 1
                if on_progress is not None and idx % 1000 == 0:
                    on_progress(idx, len(pending))

        return resolved
