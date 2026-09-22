"""
Orchestrazione della pipeline ETL: dai log grezzi di Cowrie ai Parquet.

Un solo passaggio in streaming fa tutto il lavoro:

    log NDJSON -> sessioni -> geolocalizzazione -> Parquet per giornata

Il dataset e' pensato per crescere. Il manifesto (`data/manifest.json`) ricorda
quali file sono gia' stati importati e con quale dimensione: alla riesecuzione
vengono riletti solo i file nuovi o cresciuti, piu' quello immediatamente
precedente, perche' una sessione aperta prima di mezzanotte si chiude nel file
del giorno dopo e la sua giornata va ricostruita per intero. Le partizioni
toccate vengono riscritte, le altre restano dove sono.
"""

import json
import os
import time
from datetime import datetime, timezone

from . import logs as logmod
from .geo import GeoCache
from .sessions import Sessionizer
from .store import EVENT_SCHEMA, SESSION_SCHEMA, PartitionedWriter

MANIFEST_NAME = "manifest.json"
GEO_CACHE_NAME = "ip_cache.json"


def load_manifest(data_dir):
    path = os.path.join(data_dir, MANIFEST_NAME)
    if not os.path.exists(path):
        return {"files": {}, "days": {}}
    try:
        with open(path, encoding="utf-8") as handle:
            manifest = json.load(handle)
    except (ValueError, OSError):
        return {"files": {}, "days": {}}
    manifest.setdefault("files", {})
    manifest.setdefault("days", {})
    return manifest


def save_manifest(data_dir, manifest):
    manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
    os.makedirs(data_dir, exist_ok=True)
    path = os.path.join(data_dir, MANIFEST_NAME)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2, sort_keys=True)
    os.replace(tmp, path)


def file_signature(path):
    info = os.stat(path)
    return {"size": info.st_size, "mtime": int(info.st_mtime)}


def select_files(paths, manifest, full):
    """I file da rileggere in questa esecuzione.

    Un file ruotato non cambia piu': se dimensione e data coincidono con quanto
    registrato nel manifesto e' gia' stato importato. Il file della giornata in
    corso invece cresce, quindi torna sempre nell'elenco.
    """
    if full:
        return list(paths)

    first_changed = None
    for idx, path in enumerate(paths):
        known = manifest["files"].get(os.path.basename(path))
        if known != file_signature(path):
            first_changed = idx
            break

    if first_changed is None:
        return []

    # Un file indietro: copre le sessioni a cavallo della mezzanotte.
    return list(paths[max(0, first_changed - 1):])


def run(log_dir, data_dir, geo_mode="cache", mmdb_path=None, full=False,
        batch_size=50000, verbose=True):
    def say(message=""):
        if verbose:
            print(message, flush=True)

    if not os.path.isdir(log_dir):
        raise SystemExit(f"Cartella dei log non trovata: {log_dir}")

    os.makedirs(data_dir, exist_ok=True)
    manifest = load_manifest(data_dir)
    available = logmod.discover(log_dir)
    if not available:
        raise SystemExit(f"Nessun file cowrie.json* in {log_dir}")

    todo = select_files(available, manifest, full)
    say("=" * 70)
    say(" PIPELINE COWRIE -> PARQUET")
    say("=" * 70)
    say(f"log:          {log_dir}")
    say(f"dati:         {data_dir}")
    say(f"file trovati: {len(available)}")
    if not todo:
        say("Nessun file nuovo: il dataset e' gia' aggiornato.")
        return manifest
    say(f"da importare: {len(todo)} (dal piu' vecchio: {os.path.basename(todo[0])})")

    input_bytes = sum(os.path.getsize(path) for path in todo)
    say(f"da leggere:   {input_bytes / 1048576:.0f} MB")
    say()

    # --- Geolocalizzazione ------------------------------------------------
    geo_cache = GeoCache(os.path.join(data_dir, GEO_CACHE_NAME))
    say(f"[1/3] geolocalizzazione (modalita': {geo_mode})")
    say(f"      indirizzi gia' in cache: {len(geo_cache)}")

    if geo_mode != "cache":
        t_scan = time.perf_counter()
        ips = logmod.distinct_source_ips(
            todo,
            on_progress=lambda lines, found: say(
                f"      {lines // 1000000} mln di righe, {found} indirizzi"
            ),
        )
        missing = geo_cache.missing(ips)
        say(f"      indirizzi distinti: {len(ips)}, da risolvere: {len(missing)}")
        if missing:
            resolved = geo_cache.resolve_missing(
                ips, geo_mode, mmdb_path,
                on_progress=lambda done, total: say(f"      risolti {done}/{total}"),
            )
            say(f"      risolti ora: {resolved}")
        say(f"      ricognizione in {time.perf_counter() - t_scan:.1f}s")
    elif len(geo_cache) == 0:
        # Senza cache e senza rete non esce una sola coordinata, e la mappa
        # resta vuota: meglio dirlo prima di leggere gigabyte di log.
        say("      ATTENZIONE: la cache e' vuota e la modalita' 'cache' non")
        say("      contatta nessuno, quindi nessuna sessione avra' coordinate.")
        say("      Riempila da un dataset gia' geolocalizzato:")
        say("          python -m backend.pipeline --bootstrap-geo "
            "backend/data/sessions.parquet")
        say("      oppure risolvi gli indirizzi con --geo ip-api / --geo maxmind.")
    else:
        say("      nessuna richiesta di rete; gli indirizzi non in cache "
            "restano senza coordinate")
    say()

    # --- Sessioni e scrittura --------------------------------------------
    say("[2/3] lettura dei log e ricostruzione delle sessioni")
    sessions_writer = PartitionedWriter(
        os.path.join(data_dir, "sessions"), SESSION_SCHEMA, batch_size
    )
    events_writer = PartitionedWriter(
        os.path.join(data_dir, "events"), EVENT_SCHEMA, batch_size
    )

    sessionizer = Sessionizer(geo_cache)
    days_seen = set()
    total_sessions = 0
    total_events = 0
    t_start = time.perf_counter()

    def emit(built):
        nonlocal total_sessions, total_events
        session_row, event_rows = built
        day = session_row["start_time"].astimezone(timezone.utc).strftime("%Y-%m-%d")
        if day not in days_seen:
            # Prima volta che si tocca questa giornata: la partizione
            # precedente va tolta, altrimenti le sessioni risulterebbero
            # duplicate.
            days_seen.add(day)
            sessions_writer.reset_day(day)
            events_writer.reset_day(day)
        sessions_writer.add(day, [session_row])
        events_writer.add(day, event_rows)
        total_sessions += 1
        total_events += len(event_rows)

    for event in logmod.iter_events(
        todo,
        on_progress=lambda stats: say(
            f"      {stats['events'] // 1000000} mln di eventi, "
            f"{total_sessions} sessioni"
        ),
    ):
        built = sessionizer.add(event)
        if built is not None:
            emit(built)

    # Le sessioni ancora aperte quando i log finiscono: l'ultima giornata e'
    # per definizione incompleta.
    still_open = 0
    for built in sessionizer.flush():
        emit(built)
        still_open += 1

    sessions_writer.close()
    events_writer.close()
    elapsed = time.perf_counter() - t_start
    read_stats = getattr(logmod.iter_events, "stats", {})
    say()

    # --- Manifesto e resoconto -------------------------------------------
    say("[3/3] aggiornamento del manifesto")
    for path in todo:
        manifest["files"][os.path.basename(path)] = file_signature(path)
    for day in sorted(days_seen):
        manifest["days"][day] = {
            "sessions": sessions_writer.counts.get(day, 0),
            "events": events_writer.counts.get(day, 0),
        }
    manifest["geo_mode"] = geo_mode
    save_manifest(data_dir, manifest)

    output_bytes = sessions_writer.bytes_written() + events_writer.bytes_written()
    say()
    say("-" * 70)
    say(f"eventi letti:        {read_stats.get('events', 0):,}".replace(",", "."))
    say(f"righe illeggibili:   {read_stats.get('unparsable', 0)}")
    say(f"eventi senza sessione: {sessionizer.without_session}")
    say(f"eventi senza data:   {sessionizer.without_timestamp}")
    say(f"sessioni scritte:    {total_sessions:,}".replace(",", "."))
    say(f"  senza chiusura:    {still_open}")
    say(f"giornate toccate:    {len(days_seen)}")
    say(f"indirizzi non risolti: {len(sessionizer.unresolved_ips)}")
    say("-" * 70)
    say(f"tempo:               {elapsed:.1f}s")
    if elapsed > 0:
        say(f"throughput:          {input_bytes / 1048576 / elapsed:.1f} MB/s")
    say(f"JSON in ingresso:    {input_bytes / 1048576:.1f} MB")
    say(f"Parquet prodotti:    {output_bytes / 1048576:.1f} MB")
    if output_bytes:
        say(f"rapporto di compressione: {input_bytes / output_bytes:.1f}x")
    say("-" * 70)

    return manifest


def bootstrap_geo(data_dir, parquet_path, verbose=True):
    """Riempie la cache degli IP da un dataset gia' geolocalizzato."""
    cache = GeoCache(os.path.join(data_dir, GEO_CACHE_NAME))
    before = len(cache)
    added = cache.bootstrap_from_parquet(parquet_path)
    if verbose:
        print(f"cache: {before} -> {len(cache)} indirizzi (+{added})")
    return added
