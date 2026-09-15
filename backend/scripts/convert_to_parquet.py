#!/usr/bin/env python3
"""
Pipeline ETL: Cowrie JSON -> Apache Parquet con calcolo di deriveStage e Benchmark.
Modulo 4 - TimeMap Honeypot Analytics.
"""

import sys
import os
import time
import json
from datetime import datetime
import pyarrow as pa
import pyarrow.parquet as pq


# ----------------------------------------------------------------------
# 1. Logica deriveStage (trasposta da JavaScript a Python)
# ----------------------------------------------------------------------
def derive_stage(event_ids: set[str]) -> str:
    """
    Classifica lo stadio massimo della Kill Chain raggiunto dall'attaccante.
    Priorità decrescente:
    1. Download/Upload file (malware / esfiltrazione)
    2. Richieste TCP tunnel / proxy
    3. Comandi shell interattivi
    4. Login riuscito
    5. Tentativo di login fallito
    6. Connessione stabilita (fallback)
    """
    if (
        "cowrie.session.file_download" in event_ids
        or "cowrie.session.file_download.failed" in event_ids
        or "cowrie.session.file_upload" in event_ids
    ):
        return "cowrie.session.file_download"

    if any(eid.startswith("cowrie.direct-tcpip.") for eid in event_ids):
        return "cowrie.direct-tcpip.request"

    if any(eid.startswith("cowrie.command.") for eid in event_ids):
        return "cowrie.command.input"

    if "cowrie.login.success" in event_ids:
        return "cowrie.login.success"

    if "cowrie.login.failed" in event_ids:
        return "cowrie.login.failed"

    return "cowrie.session.connect"


# ----------------------------------------------------------------------
# 2. Parsing e Trasformazione
# ----------------------------------------------------------------------
def parse_float_safe(val):
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def parse_int_safe(val):
    if val is None or val == "":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def parse_iso_datetime(ts_str):
    if not ts_str:
        return None
    try:
        clean_ts = ts_str.replace("Z", "+00:00")
        return datetime.fromisoformat(clean_ts)
    except Exception:
        return None


def transform_cowrie_sessions(raw_data: dict):
    """
    Trasforma il dizionario delle sessioni in liste piatte pronte per PyArrow.
    """
    sessions_rows = []
    events_rows = []

    for session_id, record in raw_data.items():
        if not record or not isinstance(record, dict):
            continue

        raw_events = record.get("events", [])
        if not raw_events:
            continue

        event_ids = set()
        parsed_events = []

        connect_event = None
        closed_event = None

        for ev in raw_events:
            if not ev or not isinstance(ev, dict):
                continue
            eid = ev.get("eventid")
            if not eid:
                continue
            event_ids.add(eid)

            ts_str = ev.get("timestamp")
            dt = parse_iso_datetime(ts_str)
            if dt:
                parsed_events.append((dt, ts_str, ev))

            if eid == "cowrie.session.connect" and connect_event is None:
                connect_event = ev
            elif eid == "cowrie.session.closed":
                closed_event = ev

        if not parsed_events:
            continue

        # Ordina gli eventi cronologicamente
        parsed_events.sort(key=lambda x: x[0])
        first_dt, first_ts, first_ev = parsed_events[0]
        last_dt, last_ts, last_ev = parsed_events[-1]

        # Calcolo stage con derive_stage
        stage = derive_stage(event_ids)

        # Calcolo durata
        duration = None
        if closed_event and "duration" in closed_event:
            duration = parse_float_safe(closed_event.get("duration"))
        if duration is None and first_dt and last_dt:
            duration = (last_dt - first_dt).total_seconds()

        connect = connect_event or {}

        # 1. Tabella Sessioni
        sessions_rows.append({
            "session_id": str(session_id),
            "src_ip": record.get("src_ip") or first_ev.get("src_ip"),
            "src_port": parse_int_safe(connect.get("src_port")),
            "dst_ip": connect.get("dst_ip"),
            "dst_port": parse_int_safe(connect.get("dst_port")),
            "protocol": first_ev.get("protocol"),
            "sensor": first_ev.get("sensor"),
            "location": record.get("location"),
            "latitude": parse_float_safe(record.get("latitude")),
            "longitude": parse_float_safe(record.get("longitude")),
            "start_time": first_dt,
            "end_time": last_dt,
            "duration_sec": duration,
            "stage": stage,
            "event_count": len(parsed_events),
            "event_ids": list(event_ids),
        })

        # 2. Tabella Eventi grezzi
        for dt, ts_str, ev in parsed_events:
            msg = ev.get("message")
            if isinstance(msg, (list, dict)):
                msg_str = json.dumps(msg)
            elif msg is not None:
                msg_str = str(msg)
            else:
                msg_str = None

            events_rows.append({
                "session_id": str(session_id),
                "timestamp": dt,
                "eventid": ev.get("eventid"),
                "message": msg_str,
                "data_json": json.dumps(ev),
            })

    return sessions_rows, events_rows


# ----------------------------------------------------------------------
# 3. Pipeline Principale con Misurazione del Benchmark
# ----------------------------------------------------------------------
def run_pipeline(input_json_path: str, output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    sessions_parquet_path = os.path.join(output_dir, "sessions.parquet")
    events_parquet_path = os.path.join(output_dir, "events.parquet")

    print("=" * 72)
    print(" PIPELINE COWRIE -> PARQUET & BENCHMARK (Modulo 4) ")
    print("=" * 72)
    print(f"File di input:      {input_json_path}")
    print(f"Cartella di output: {output_dir}")

    t_start_total = time.perf_counter()

    # 1. LETTURA JSON
    print("\n[1/3] Lettura del file JSON...")
    t0_read = time.perf_counter()
    with open(input_json_path, "r", encoding="utf-8") as f:
        raw_data = json.load(f)
    t_read = time.perf_counter() - t0_read
    raw_size_bytes = os.path.getsize(input_json_path)
    print(f"  -> Caricate {len(raw_data)} sessioni in {t_read:.3f} s")

    # 2. TRASFORMAZIONE E deriveStage
    print("\n[2/3] Trasformazione e calcolo deriveStage...")
    t0_trans = time.perf_counter()
    sessions_data, events_data = transform_cowrie_sessions(raw_data)
    t_trans = time.perf_counter() - t0_trans
    print(f"  -> Elaborate {len(sessions_data)} sessioni e {len(events_data)} eventi in {t_trans:.3f} s")

    # 3. SCRITTURA PARQUET
    print("\n[3/3] Serializzazione Parquet colonnare (compressione ZSTD)...")
    t0_write = time.perf_counter()

    # Tabella Sessioni
    table_sessions = pa.Table.from_pylist(sessions_data)
    pq.write_table(table_sessions, sessions_parquet_path, compression="zstd")

    # Tabella Eventi
    table_events = pa.Table.from_pylist(events_data)
    pq.write_table(table_events, events_parquet_path, compression="zstd")

    t_write = time.perf_counter() - t0_write
    t_total = time.perf_counter() - t_start_total

    size_sessions_bytes = os.path.getsize(sessions_parquet_path)
    size_events_bytes = os.path.getsize(events_parquet_path)
    total_parquet_bytes = size_sessions_bytes + size_events_bytes

    # ------------------------------------------------------------------
    # 4. REPORT DEL BENCHMARK
    # ------------------------------------------------------------------
    raw_mb = raw_size_bytes / (1024 * 1024)
    sessions_mb = size_sessions_bytes / (1024 * 1024)
    events_mb = size_events_bytes / (1024 * 1024)
    total_parquet_mb = total_parquet_bytes / (1024 * 1024)

    ratio_sessions = raw_size_bytes / size_sessions_bytes if size_sessions_bytes else 0
    ratio_total = raw_size_bytes / total_parquet_bytes if total_parquet_bytes else 0
    savings_pct = (1.0 - (total_parquet_bytes / raw_size_bytes)) * 100.0

    throughput_mb_s = raw_mb / t_total if t_total > 0 else 0
    throughput_sessions_s = len(sessions_data) / t_total if t_total > 0 else 0

    print("\n" + "=" * 72)
    print(" RISULTATI DEL BENCHMARK ")
    print("=" * 72)
    print(f"{'Metrica':<35} | {'Valore':<30}")
    print("-" * 72)
    print(f"{'Dimensione JSON iniziale':<35} | {raw_mb:.2f} MB ({raw_size_bytes:,} bytes)")
    print(f"{'Dimensione sessions.parquet':<35} | {sessions_mb:.2f} MB ({size_sessions_bytes:,} bytes)")
    print(f"{'Dimensione events.parquet':<35} | {events_mb:.2f} MB ({size_events_bytes:,} bytes)")
    print(f"{'Dimensione totale Parquet':<35} | {total_parquet_mb:.2f} MB ({total_parquet_bytes:,} bytes)")
    print("-" * 72)
    print(f"{'Rapporto Compressione (Sessioni)':<35} | {ratio_sessions:.2f}x (volte piu compatto)")
    print(f"{'Rapporto Compressione Totale':<35} | {ratio_total:.2f}x (volte piu compatto)")
    print(f"{'Risparmio Spazio Disco (Savings)':<35} | {savings_pct:.2f} %")
    print("-" * 72)
    print(f"{'Tempo lettura JSON (T_read)':<35} | {t_read:.3f} s")
    print(f"{'Tempo trasformazione (T_transform)':<35} | {t_trans:.3f} s")
    print(f"{'Tempo scrittura Parquet (T_write)':<35} | {t_write:.3f} s")
    print(f"{'TEMPO TOTALE (T_total)':<35} | {t_total:.3f} s")
    print("-" * 72)
    print(f"{'Throughput Elaborazione Dati':<35} | {throughput_mb_s:.2f} MB/s")
    print(f"{'Throughput Record':<35} | {throughput_sessions_s:.1f} sessioni/s")
    print("=" * 72)
    print("Conversione completata con successo!\n")


if __name__ == "__main__":
    default_input = "timemap_v1/public/sample_1000.json"
    default_output = "data/parquet_output"

    input_file = sys.argv[1] if len(sys.argv) > 1 else default_input
    output_dir = sys.argv[2] if len(sys.argv) > 2 else default_output

    run_pipeline(input_file, output_dir)
