#!/usr/bin/env python3
"""
Pipeline ETL ad alte prestazioni: Cowrie JSON -> Apache Parquet con Benchmark.
Supporta sia campioni ridotti che dataset massivi (2.5+ GB / 600k+ sessioni) in streaming costante.
"""

import sys
import os
import time
import json
import shutil
from datetime import datetime
import pyarrow as pa
import pyarrow.parquet as pq


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


def process_single_session(session_id: str, record: dict):
    """
    Elabora una singola sessione Cowrie producendo:
    1. Una riga per la tabella sessioni
    2. Una lista di righe per la tabella eventi dettagliati
    """
    if not record or not isinstance(record, dict):
        return None, []

    raw_events = record.get("events", [])
    if not raw_events:
        return None, []

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
        return None, []

    parsed_events.sort(key=lambda x: x[0])
    first_dt, first_ts, first_ev = parsed_events[0]
    last_dt, last_ts, last_ev = parsed_events[-1]

    duration = None
    if closed_event and "duration" in closed_event:
        duration = parse_float_safe(closed_event.get("duration"))
    if duration is None and first_dt and last_dt:
        duration = (last_dt - first_dt).total_seconds()

    connect = connect_event or {}

    session_row = {
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
        "associations": sorted(list(event_ids)),
        "event_count": len(parsed_events),
    }

    events_rows = []
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

    return session_row, events_rows


def run_pipeline(input_json_path: str, output_dir: str, batch_size: int = 50000):
    os.makedirs(output_dir, exist_ok=True)
    sessions_parquet_path = os.path.join(output_dir, "sessions.parquet")
    events_parquet_path = os.path.join(output_dir, "events.parquet")

    # Rimuovi file precedenti se presenti
    if os.path.exists(sessions_parquet_path):
        os.remove(sessions_parquet_path)
    if os.path.exists(events_parquet_path):
        os.remove(events_parquet_path)

    raw_size_bytes = os.path.getsize(input_json_path)
    raw_mb = raw_size_bytes / (1024 * 1024)

    print("=" * 75)
    print(" PIPELINE AD ALTE PRESTAZIONI: COWRIE JSON -> PARQUET (Modulo 4) ")
    print("=" * 75)
    print(f"File sorgente:    {input_json_path} ({raw_mb:.2f} MB)")
    print(f"Destinazione:     {output_dir}")
    print(f"Modalità:         Streaming a blocchi di {batch_size:,} record (RAM costante ~50MB)")
    print("=" * 75)

    t_start_total = time.perf_counter()

    writer_sessions = None
    writer_events = None

    sessions_batch = []
    events_batch = []

    total_sessions_count = 0
    total_events_count = 0

    print("\nElaborazione e scrittura Parquet in corso...")

    # Apertura del file in streaming riga per riga
    with open(input_json_path, "r", encoding="utf-8") as f:
        for line_idx, line in enumerate(f, start=1):
            line = line.strip()
            if not line or line in ("{", "}", "]", "["):
                continue

            if line.endswith(","):
                line = line[:-1]

            try:
                # Gestisce sia file 'session_id: {...}' che '{"session_id": {...}}'
                if not line.startswith("{"):
                    line_wrapped = "{" + line + "}"
                else:
                    line_wrapped = line

                obj = json.loads(line_wrapped)
                for session_id, record in obj.items():
                    s_row, e_rows = process_single_session(session_id, record)
                    if s_row:
                        sessions_batch.append(s_row)
                        events_batch.extend(e_rows)
                        total_sessions_count += 1
                        total_events_count += len(e_rows)
            except Exception:
                continue

            # Scrittura del blocco su disco quando si raggiunge il batch_size
            if len(sessions_batch) >= batch_size:
                table_s = pa.Table.from_pylist(sessions_batch)
                table_e = pa.Table.from_pylist(events_batch)

                if writer_sessions is None:
                    writer_sessions = pq.ParquetWriter(sessions_parquet_path, table_s.schema, compression="zstd")
                if writer_events is None:
                    writer_events = pq.ParquetWriter(events_parquet_path, table_e.schema, compression="zstd")

                writer_sessions.write_table(table_s)
                writer_events.write_table(table_e)

                sessions_batch.clear()
                events_batch.clear()

                elapsed_so_far = time.perf_counter() - t_start_total
                speed = total_sessions_count / elapsed_so_far if elapsed_so_far > 0 else 0
                print(f"  -> {total_sessions_count:,} sessioni elaborate in {elapsed_so_far:.1f}s ({speed:,.0f} sess/s)...")

    # Scrittura dell'ultimo blocco residuo
    if sessions_batch:
        table_s = pa.Table.from_pylist(sessions_batch)
        table_e = pa.Table.from_pylist(events_batch)

        if writer_sessions is None:
            writer_sessions = pq.ParquetWriter(sessions_parquet_path, table_s.schema, compression="zstd")
        if writer_events is None:
            writer_events = pq.ParquetWriter(events_parquet_path, table_e.schema, compression="zstd")

        writer_sessions.write_table(table_s)
        writer_events.write_table(table_e)

    # Chiusura dei file Parquet
    if writer_sessions:
        writer_sessions.close()
    if writer_events:
        writer_events.close()

    t_total = time.perf_counter() - t_start_total

    # Sincronizza anche session.parquet (singolare)
    single_parquet_path = os.path.join(output_dir, "session.parquet")
    shutil.copyfile(sessions_parquet_path, single_parquet_path)

    size_sessions_bytes = os.path.getsize(sessions_parquet_path)
    size_events_bytes = os.path.getsize(events_parquet_path)
    total_parquet_bytes = size_sessions_bytes + size_events_bytes

    sessions_mb = size_sessions_bytes / (1024 * 1024)
    events_mb = size_events_bytes / (1024 * 1024)
    total_parquet_mb = total_parquet_bytes / (1024 * 1024)

    ratio_sessions = raw_size_bytes / size_sessions_bytes if size_sessions_bytes else 0
    ratio_total = raw_size_bytes / total_parquet_bytes if total_parquet_bytes else 0
    savings_pct = (1.0 - (total_parquet_bytes / raw_size_bytes)) * 100.0

    throughput_mb_s = raw_mb / t_total if t_total > 0 else 0
    throughput_sessions_s = total_sessions_count / t_total if t_total > 0 else 0

    print("\n" + "=" * 75)
    print(" RISULTATI DEL BENCHMARK FINALE ")
    print("=" * 75)
    print(f"{'Metrica':<35} | {'Valore':<35}")
    print("-" * 75)
    print(f"{'Dimensione JSON iniziale':<35} | {raw_mb:.2f} MB ({raw_size_bytes:,} bytes)")
    print(f"{'Dimensione sessions.parquet':<35} | {sessions_mb:.2f} MB ({size_sessions_bytes:,} bytes)")
    print(f"{'Dimensione events.parquet':<35} | {events_mb:.2f} MB ({size_events_bytes:,} bytes)")
    print(f"{'Dimensione totale Parquet':<35} | {total_parquet_mb:.2f} MB ({total_parquet_bytes:,} bytes)")
    print("-" * 75)
    print(f"{'Rapporto Compressione (Sessioni)':<35} | {ratio_sessions:.2f}x (volte piu compatto)")
    print(f"{'Rapporto Compressione Totale':<35} | {ratio_total:.2f}x (volte piu compatto)")
    print(f"{'Risparmio Spazio Disco (Savings)':<35} | {savings_pct:.2f} %")
    print("-" * 75)
    print(f"{'Sessioni totali elaborate':<35} | {total_sessions_count:,}")
    print(f"{'Eventi singoli indicizzati':<35} | {total_events_count:,}")
    print(f"{'TEMPO TOTALE PIPELINE':<35} | {t_total:.2f} secondi")
    print("-" * 75)
    print(f"{'Throughput Elaborazione Dati':<35} | {throughput_mb_s:.2f} MB/s")
    print(f"{'Throughput Sessioni':<35} | {throughput_sessions_s:,.1f} sessioni/s")
    print("=" * 75)
    print("Pipeline completata con successo!\n")


if __name__ == "__main__":
    default_input = "timemap_v1/public/sample_1000.json"
    default_output = "timemap_v1/backend/data"

    input_file = sys.argv[1] if len(sys.argv) > 1 else default_input
    output_dir = sys.argv[2] if len(sys.argv) > 2 else default_output

    run_pipeline(input_file, output_dir)
