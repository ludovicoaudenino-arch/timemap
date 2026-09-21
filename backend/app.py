from fastapi import FastAPI, Query
import duckdb
import os
from typing import Optional

app = FastAPI(
    title="TimeMap Cowrie Backend",
    version="1.0.0"
)

PARQUET_FILE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "data", "sessions.parquet")
)
EVENTS_FILE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "data", "events.parquet")
)


@app.get("/")
def read_root():
    """Health Check"""
    return {"status": "online", "message": "backend active"}


@app.get("/api/events")
def get_events(
    filter: Optional[str] = Query(None, description="Filtra per associazione (es. cowrie.login.failed)"),
    from_date: Optional[str] = Query(None, description="Data inizio ISO (es. 2026-04-01T00:00:00Z)"),
    to_date: Optional[str] = Query(None, description="Data fine ISO (es. 2026-08-01T00:00:00Z)"),
    limit: int = Query(5000, description="Numero massimo di record")
):
    con = duckdb.connect()
    con.execute("SET TimeZone = 'UTC'")

    params = []
    where_clauses = []

    if isinstance(filter, str) and filter.strip():
        where_clauses.append("list_contains(associations, ?)")
        params.append(filter.strip())

    if isinstance(from_date, str) and from_date.strip():
        where_clauses.append("start_time >= ?::TIMESTAMPTZ")
        params.append(from_date.strip())

    if isinstance(to_date, str) and to_date.strip():
        where_clauses.append("start_time <= ?::TIMESTAMPTZ")
        params.append(to_date.strip())

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    params.append(limit)

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
            strftime(start_time, '%Y-%m-%dT%H:%M:%S.000Z') AS time_display,
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
                startTimestamp := strftime(start_time, '%Y-%m-%dT%H:%M:%S.000Z'),
                endTimestamp := strftime(end_time, '%Y-%m-%dT%H:%M:%S.000Z'),
                durationSec := duration_sec,
                eventIds := associations,
                eventCount := event_count,
                events := []::JSON[],
                groups := []::STRUCT(eventid VARCHAR, events JSON[])[]
            ) AS session
        FROM '{PARQUET_FILE}'
        {where_sql}
        ORDER BY start_time ASC
        LIMIT ?
    """

    rel = con.execute(query, params)
    records = [dict(zip([col[0] for col in rel.description], row)) for row in rel.fetchall()]
    con.close()
    return records


@app.get("/api/sessions/{session_id}/events")
def get_session_events(session_id: str):
    con = duckdb.connect()
    con.execute("SET TimeZone = 'UTC'")
    query = f"""
        SELECT
            strftime(timestamp, '%Y-%m-%dT%H:%M:%S.000Z') AS timestamp,
            eventid,
            message,
            data_json
        FROM '{EVENTS_FILE}'
        WHERE session_id = ?
        ORDER BY timestamp ASC
    """
    rel = con.execute(query, [session_id])
    records = [dict(zip([col[0] for col in rel.description], row)) for row in rel.fetchall()]
    con.close()
    return records