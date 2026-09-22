"""
Backend TimeMap / Cowrie.

Serve le sessioni dell'honeypot leggendo i file Parquet con DuckDB, su tre
livelli di dettaglio, dal piu' grosso al piu' fine:

    /api/histogram              conteggi per intervallo di tempo  -> barre della timeline
    /api/locations              conteggi per luogo                -> marker della mappa
    /api/events                 le singole sessioni               -> puntini e SessionCard
    /api/sessions/{id}/events   i log di una sessione             -> SessionCard aperta

I primi due esistono perche' una finestra larga contiene fino a decine di
migliaia di sessioni: il conteggio lo fa il database e al browser arrivano
poche righe, invece di un elenco troncato che farebbe sembrare vuota meta'
della giornata.
"""

from fastapi import FastAPI, Query, Response
import duckdb
import os
from datetime import datetime, timezone
from typing import Optional

app = FastAPI(
    title="TimeMap Cowrie Backend",
    version="1.1.0"
)

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "data"))

# Retrocompatibilita': i percorsi dei due file singoli prodotti dalla versione
# precedente della pipeline.
PARQUET_FILE = os.path.join(DATA_DIR, "sessions.parquet")
EVENTS_FILE = os.path.join(DATA_DIR, "events.parquet")

# Stadio raggiunto dall'attaccante nella sessione. L'ordine dei rami replica
# SESSION_STAGES in src/common/cowrie.js: vince il primo che si verifica, cioe'
# il punto piu' avanzato raggiunto. Backend e frontend devono classificare allo
# stesso modo, altrimenti i colori della mappa non corrispondono alle barre.
STAGE_SQL = """
    CASE
        WHEN list_contains(associations, 'cowrie.session.file_download')
          OR list_contains(associations, 'cowrie.session.file_download.failed')
          OR list_contains(associations, 'cowrie.session.file_upload')
            THEN 'cowrie.session.file_download'
        WHEN len(list_filter(associations, x -> starts_with(x, 'cowrie.direct-tcpip.'))) > 0
            THEN 'cowrie.direct-tcpip.request'
        WHEN len(list_filter(associations, x -> starts_with(x, 'cowrie.command.'))) > 0
            THEN 'cowrie.command.input'
        WHEN list_contains(associations, 'cowrie.login.success')
            THEN 'cowrie.login.success'
        WHEN list_contains(associations, 'cowrie.login.failed')
            THEN 'cowrie.login.failed'
        ELSE 'cowrie.session.connect'
    END
"""

# Ampiezza delle barre della timeline, in secondi.
BUCKET_SECONDS = {
    "day": 86400,
    "hour": 3600,
    "10min": 600,
    "minute": 60,
}

ISO_FMT = "%Y-%m-%dT%H:%M:%S.000Z"


def parquet_source(name: str) -> str:
    """Espressione SQL da cui leggere un dataset ('sessions' o 'events').

    La pipeline scrive una directory partizionata per giornata
    (data/sessions/date=AAAA-MM-GG/*.parquet), cosi' il dataset puo' crescere
    aggiungendo i log dei giorni nuovi senza rifare il resto. Se quella
    directory non c'e' si ricade sul singolo file della versione precedente.
    """
    partitioned = os.path.join(DATA_DIR, name)
    if os.path.isdir(partitioned):
        pattern = os.path.join(partitioned, "**", "*.parquet").replace("\\", "/")
        return (
            f"read_parquet('{pattern}', hive_partitioning = true, "
            "union_by_name = true)"
        )
    return "'{}'".format(os.path.join(DATA_DIR, f"{name}.parquet").replace("\\", "/"))


# Una sola istanza DuckDB per processo: le viste sono definite su un pattern di
# file, quindi le giornate aggiunte in seguito dalla pipeline compaiono da sole
# alla query successiva, senza riavviare il backend.
_DB = duckdb.connect()
_DB.execute(f"CREATE OR REPLACE VIEW sessions AS SELECT * FROM {parquet_source('sessions')}")
_DB.execute(f"CREATE OR REPLACE VIEW events AS SELECT * FROM {parquet_source('events')}")


def connect():
    """Cursore indipendente sulla stessa istanza: FastAPI serve le richieste su
    piu' thread e un cursore per richiesta evita di condividerne lo stato."""
    con = _DB.cursor()
    con.execute("SET TimeZone = 'UTC'")
    return con


@app.on_event("startup")
def describe_dataset():
    """All'avvio dice cosa sta servendo: da dove legge e quanto c'e' dentro.

    Serve a non passare mezz'ora a chiedersi perche' la mappa e' vuota quando
    la pipeline non e' ancora stata eseguita.
    """
    partitioned = os.path.isdir(os.path.join(DATA_DIR, "sessions"))
    origin = "partizioni per giornata" if partitioned else "file singoli"
    try:
        con = connect()
        sessions, days, first, last = con.execute(
            "SELECT count(*), count(DISTINCT date_trunc('day', start_time)), "
            "min(start_time)::VARCHAR, max(start_time)::VARCHAR FROM sessions"
        ).fetchone()
        con.close()
        print(f"[dataset] {origin}: {sessions} sessioni in {days} giornate, "
              f"da {first} a {last}")
    except Exception as error:
        print(f"[dataset] nessun dato leggibile ({origin}): {error}")
        print("[dataset] importa i log con: python -m backend.pipeline "
              "--logs ../data/cowrie")


def fetch(con, query, params):
    """Esegue la query e restituisce una lista di dizionari."""
    rel = con.execute(query, params)
    columns = [col[0] for col in rel.description]
    return [dict(zip(columns, row)) for row in rel.fetchall()]


def session_filters(filter: Optional[str], from_date: Optional[str], to_date: Optional[str]):
    """Clausola WHERE comune ai tre endpoint, piu' i parametri da associarvi.

    Il filtro temporale guarda l'inizio della sessione: una sessione appartiene
    alla finestra in cui e' cominciata, anche se si chiude dopo.
    """
    clauses = []
    params = []

    if isinstance(filter, str) and filter.strip():
        clauses.append("list_contains(associations, ?)")
        params.append(filter.strip())

    if isinstance(from_date, str) and from_date.strip():
        clauses.append("start_time >= ?::TIMESTAMPTZ")
        params.append(from_date.strip())

    if isinstance(to_date, str) and to_date.strip():
        clauses.append("start_time <= ?::TIMESTAMPTZ")
        params.append(to_date.strip())

    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return where_sql, params


def parse_iso(value: Optional[str]):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None


def choose_bucket(from_date: Optional[str], to_date: Optional[str]) -> str:
    """Ampiezza delle barre adatta alla finestra richiesta.

    Sono i livelli del drill-down: mesi -> una barra al giorno, una giornata ->
    una barra all'ora, un'ora -> una barra ogni dieci minuti. Sotto l'ora si
    scende al minuto, ma a quel punto le sessioni sono poche e la timeline
    torna a mostrarle una per una.
    """
    start, end = parse_iso(from_date), parse_iso(to_date)
    if start is None or end is None:
        return "day"

    minutes = (end - start).total_seconds() / 60.0
    if minutes > 72 * 60:
        return "day"
    if minutes > 3 * 60:
        return "hour"
    if minutes > 10:
        return "10min"
    return "minute"


@app.get("/")
def read_root():
    """Health Check"""
    return {"status": "online", "message": "backend active"}


@app.get("/api/histogram")
def get_histogram(
    filter: Optional[str] = Query(None, description="Filtra per associazione (es. cowrie.login.failed)"),
    from_date: Optional[str] = Query(None, description="Data inizio ISO"),
    to_date: Optional[str] = Query(None, description="Data fine ISO"),
    bucket: str = Query("auto", description="day | hour | 10min | minute | auto"),
):
    """Conteggi per intervallo di tempo: le barre della timeline.

    Una riga per intervallo, con il totale e la ripartizione per stadio. Sono
    conteggi esatti calcolati su tutte le sessioni della finestra, non su un
    campione.
    """
    if bucket not in BUCKET_SECONDS:
        bucket = choose_bucket(from_date, to_date)
    seconds = BUCKET_SECONDS[bucket]

    where_sql, params = session_filters(filter, from_date, to_date)

    query = f"""
        SELECT
            strftime(
                to_timestamp(floor(epoch(start_time) / {seconds}) * {seconds}),
                '{ISO_FMT}'
            ) AS bucket_start,
            {STAGE_SQL} AS stage,
            count(*) AS count
        FROM sessions
        {where_sql}
        GROUP BY ALL
        ORDER BY bucket_start
    """

    con = connect()
    rows = fetch(con, query, params)
    con.close()

    # Una voce per intervallo, con dentro la ripartizione per stadio.
    buckets = {}
    for row in rows:
        entry = buckets.setdefault(
            row["bucket_start"],
            {"start": row["bucket_start"], "count": 0, "by_stage": {}},
        )
        entry["count"] += row["count"]
        entry["by_stage"][row["stage"]] = row["count"]

    ordered = [buckets[key] for key in sorted(buckets)]
    return {
        "bucket": bucket,
        "bucket_seconds": seconds,
        "total": sum(entry["count"] for entry in ordered),
        "buckets": ordered,
    }


@app.get("/api/locations")
def get_locations(
    filter: Optional[str] = Query(None, description="Filtra per associazione"),
    from_date: Optional[str] = Query(None, description="Data inizio ISO"),
    to_date: Optional[str] = Query(None, description="Data fine ISO"),
    limit: int = Query(5000, description="Numero massimo di luoghi"),
):
    """Conteggi per luogo: i marker della mappa quando la finestra e' larga.

    Le coordinate distinte sono poche migliaia in tutto il dataset, quindi
    questa risposta resta piccola qualunque sia la finestra richiesta.
    """
    where_sql, params = session_filters(filter, from_date, to_date)

    query = f"""
        SELECT
            location,
            latitude,
            longitude,
            {STAGE_SQL} AS stage,
            count(*) AS count
        FROM sessions
        {where_sql}
        GROUP BY ALL
    """

    con = connect()
    rows = fetch(con, query, params)
    con.close()

    places = {}
    for row in rows:
        key = (row["latitude"], row["longitude"])
        place = places.setdefault(
            key,
            {
                "location": row["location"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "count": 0,
                "by_stage": {},
            },
        )
        place["count"] += row["count"]
        place["by_stage"][row["stage"]] = (
            place["by_stage"].get(row["stage"], 0) + row["count"]
        )

    ordered = sorted(places.values(), key=lambda p: p["count"], reverse=True)
    truncated = len(ordered) > limit
    return {
        "total_sessions": sum(place["count"] for place in ordered),
        "total_locations": len(ordered),
        "truncated": truncated,
        "locations": ordered[:limit],
    }


@app.get("/api/events")
def get_events(
    response: Response,
    filter: Optional[str] = Query(None, description="Filtra per associazione (es. cowrie.login.failed)"),
    from_date: Optional[str] = Query(None, description="Data inizio ISO (es. 2026-04-01T00:00:00Z)"),
    to_date: Optional[str] = Query(None, description="Data fine ISO (es. 2026-08-01T00:00:00Z)"),
    limit: int = Query(5000, description="Numero massimo di record")
):
    """Le singole sessioni della finestra.

    Se la finestra ne contiene piu' di `limit`, la risposta e' per forza
    parziale: `X-Total-Count` dice quante sono davvero e `X-Truncated` segnala
    il troncamento, cosi' l'interfaccia puo' dirlo invece di mostrare una
    giornata che sembra finire a meta'.
    """
    where_sql, params = session_filters(filter, from_date, to_date)

    con = connect()

    total = con.execute(
        f"SELECT count(*) FROM sessions {where_sql}", list(params)
    ).fetchone()[0]

    query = f"""
        SELECT
            session_id AS id,
            session_id AS civId,
            src_ip,
            src_port,
            dst_ip,
            dst_port,
            protocol,
            location,
            COALESCE(CAST(latitude AS VARCHAR), '') AS latitude,
            COALESCE(CAST(longitude AS VARCHAR), '') AS longitude,
            strftime(start_time, '%Y-%m-%d') AS date,
            strftime(start_time, '%H:%M:%S') AS time,
            'second' AS time_precision,
            strftime(start_time, '{ISO_FMT}') AS time_display,
            CONCAT(session_id, ' ', COALESCE(src_ip, ''), ' > ', COALESCE(dst_ip, ''), ' ', COALESCE(protocol, '')) AS description,
            COALESCE(protocol, 'session') AS type,
            COALESCE(protocol, 'session') AS category,
            COALESCE(protocol, 'session') AS category_full,
            '#3fb950' AS colour,
            associations,
            duration_sec,
            event_count,
            struct_pack(
                id := session_id,
                srcIp := src_ip,
                srcPort := src_port,
                dstIp := dst_ip,
                dstPort := dst_port,
                protocol := protocol,
                location := location,
                latitude := COALESCE(CAST(latitude AS VARCHAR), ''),
                longitude := COALESCE(CAST(longitude AS VARCHAR), ''),
                startTimestamp := strftime(start_time, '{ISO_FMT}'),
                endTimestamp := strftime(end_time, '{ISO_FMT}'),
                durationSec := duration_sec,
                eventIds := associations,
                eventCount := event_count,
                events := []::JSON[],
                groups := []::STRUCT(eventid VARCHAR, events JSON[])[]
            ) AS session
        FROM sessions
        {where_sql}
        ORDER BY start_time ASC
        LIMIT ?
    """

    records = fetch(con, query, list(params) + [limit])
    con.close()

    response.headers["X-Total-Count"] = str(total)
    response.headers["X-Truncated"] = "true" if total > len(records) else "false"
    return records


@app.get("/api/sessions/{session_id}/events")
def get_session_events(session_id: str):
    query = f"""
        SELECT
            seq,
            strftime(timestamp, '{ISO_FMT}') AS timestamp,
            eventid,
            message,
            data_json
        FROM sessions
        WHERE session_id = ?
        ORDER BY seq ASC
    """
    con = connect()
    records = fetch(con, query, [session_id])
    con.close()
    return records
