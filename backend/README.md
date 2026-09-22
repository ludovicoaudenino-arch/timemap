# Backend TimeMap / Cowrie

FastAPI + DuckDB davanti a dei file Parquet. Due cose soltanto: una pipeline
che importa i log grezzi dell'honeypot, e un'API che li serve alla mappa.

## Importare i log

I log di Cowrie sono una cartella di file NDJSON giornalieri (`cowrie.json`
per la giornata in corso, `cowrie.json.AAAA-MM-GG` per quelle chiuse, anche
compressi in `.gz`). La pipeline prende quella cartella cosi' com'e':

```bash
python -m backend.pipeline --logs ../data/cowrie
```

Fa tutto in un passaggio solo, in streaming: legge gli eventi, li raggruppa in
sessioni, aggiunge le coordinate dell'indirizzo sorgente e scrive i Parquet in
`backend/data/`, una partizione per giornata.

**Il dataset e' pensato per crescere.** Il manifesto `backend/data/manifest.json`
ricorda quali file sono gia' stati importati: quando arrivano i log di nuove
giornate basta rieseguire lo stesso comando e vengono letti solo quelli nuovi
(piu' il file immediatamente precedente, perche' una sessione aperta prima di
mezzanotte si chiude nel file del giorno dopo). Le partizioni gia' scritte
restano dove sono. Per rifare tutto da capo: `--full`.

### Geolocalizzazione

La mappa ha bisogno di una coordinata per sessione, e l'honeypot registra solo
un indirizzo IP. La traduzione passa da una cache su disco
(`backend/data/ip_cache.json`), cosi' reimportare i log non ripete le richieste.

| Modalita' | Cosa fa |
|---|---|
| `--geo cache` (predefinito) | solo cache: nessuna richiesta di rete, gli indirizzi sconosciuti restano senza coordinate e vengono contati nel resoconto |
| `--geo ip-api` | risolve gli sconosciuti con ip-api.com, a blocchi di 100, rispettando il limite del servizio gratuito |
| `--geo maxmind --mmdb GeoLite2-City.mmdb` | database locale: nessun indirizzo esce dalla macchina e il risultato e' riproducibile. Richiede `pip install geoip2` e un account gratuito MaxMind |

Gli indirizzi IP degli attaccanti sono dati personali: `maxmind` e' l'unica
modalita' che non li trasferisce a terzi.

Se un dataset gia' geolocalizzato esiste, la cache si riempie da quello senza
contattare nessuno:

```bash
python -m backend.pipeline --bootstrap-geo backend/data/sessions.parquet
```

## Avviare l'API

```bash
python -m uvicorn backend.app:app --reload --port 8000
```

Il server di sviluppo del frontend (`npm run dev`, porta 8080) inoltra `/api`
qui, quindi non serve altro.

### Endpoint

Tre livelli di dettaglio, dal piu' grosso al piu' fine. Esistono perche' una
finestra larga contiene fino a decine di migliaia di sessioni: i conteggi li fa
il database, al browser arrivano poche righe.

| Endpoint | Restituisce |
|---|---|
| `GET /api/histogram?from_date&to_date&bucket` | conteggi per intervallo di tempo, con ripartizione per stadio: le barre della timeline. `bucket` e' `day`, `hour`, `10min`, `minute` o `auto` |
| `GET /api/locations?from_date&to_date` | conteggi per luogo: i marker della mappa quando la finestra e' larga |
| `GET /api/events?from_date&to_date&limit` | le singole sessioni. Gli header `X-Total-Count` e `X-Truncated` dicono quante sono davvero e se la risposta e' parziale |
| `GET /api/sessions/{id}/events` | i log di una sessione, per la SessionCard |

Tutti accettano `filter=<eventid>` per limitarsi a un tipo di evento.

## Struttura

```
backend/
  app.py                API FastAPI (le query DuckDB)
  pipeline/
    __main__.py         riga di comando
    run.py              orchestrazione e manifesto
    logs.py             lettura dei log grezzi
    sessions.py         ricostruzione delle sessioni e stadi
    geo.py              geolocalizzazione e cache
    store.py            scrittura Parquet partizionata
  data/
    sessions/date=.../part.parquet
    events/date=.../part.parquet
    ip_cache.json       cache della geolocalizzazione
    manifest.json       cosa e' gia' stato importato
  scripts/
    convert_to_parquet.py   versione precedente, partiva da un JSON gia' lavorato
```

Il backend legge le partizioni se `data/sessions/` esiste, altrimenti ricade
sui file singoli `data/sessions.parquet` e `data/events.parquet` della versione
precedente.
