from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import duckdb
import os
from typing import Optional

app = FastAPI(
    title="TimeMap Cowrie Backend",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PARQUET_FILE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "data", "sessions.parquet")
)


@app.get("/")
def read_root():
    """Healt Check"""
    return {"status" : "online", "message" : "backend active"}

@app.get("/api/events")
def get_events(
    filter: Optional[str] = Query(None, description="Filtra per associazione (es. cowrie.login.failed)"),
    limit: int = Query(1000, description="Numero massimo di record")
):
    con = duckdb.connect()

    where_clauses = []
    if isinstance(filter, str) and filter.strip():
        where_clauses.append(f"list_contains(associations, '{filter.strip()}')")

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

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
            latitude,
            longitude,
            strftime(start_time, '%Y-%m-%d') AS date,
            strftime(start_time, '%H:%M:%S') AS time,
            associations,
            duration_sec,
            event_count
        FROM '{PARQUET_FILE}'
        {where_sql}
        ORDER BY start_time ASC
        LIMIT {limit}
    """

    rel = con.sql(query)
    records = [dict(zip(rel.columns, row)) for row in rel.fetchall()]
    con.close()
    return records