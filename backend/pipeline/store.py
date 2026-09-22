"""
Scrittura dei Parquet, una partizione per giornata.

La struttura e':

    data/sessions/date=2026-04-02/part.parquet
    data/events/date=2026-04-02/part.parquet

Le partizioni sono il motivo per cui il dataset puo' crescere: importare i log
di domani scrive una cartella in piu' e lascia intatte le altre, e DuckDB le
legge tutte insieme con un solo `read_parquet` sul pattern. Le query che
filtrano per data leggono inoltre solo le partizioni che servono.

Una sessione appartiene alla giornata in cui e' cominciata, anche se si chiude
dopo la mezzanotte: e' la stessa convenzione usata dalle query del backend, che
filtrano su `start_time`.
"""

import os
import shutil

import pyarrow as pa
import pyarrow.parquet as pq

TIMESTAMP = pa.timestamp("us", tz="UTC")

SESSION_SCHEMA = pa.schema([
    ("session_id", pa.string()),
    ("src_ip", pa.string()),
    ("src_port", pa.int64()),
    ("dst_ip", pa.string()),
    ("dst_port", pa.int64()),
    ("protocol", pa.string()),
    ("sensor", pa.string()),
    ("location", pa.string()),
    ("latitude", pa.float64()),
    ("longitude", pa.float64()),
    ("start_time", TIMESTAMP),
    ("end_time", TIMESTAMP),
    ("duration_sec", pa.float64()),
    ("associations", pa.list_(pa.string())),
    ("event_count", pa.int64()),
])

EVENT_SCHEMA = pa.schema([
    ("session_id", pa.string()),
    ("seq", pa.int64()),
    ("timestamp", TIMESTAMP),
    ("eventid", pa.string()),
    ("message", pa.string()),
    ("data_json", pa.string()),
])

COMPRESSION = "zstd"


class PartitionedWriter:
    """Accumula righe e le scrive nella partizione della loro giornata."""

    def __init__(self, root, schema, batch_size=50000):
        self.root = root
        self.schema = schema
        self.batch_size = batch_size
        self.writers = {}
        self.buffers = {}
        self.counts = {}

    def partition_dir(self, day):
        return os.path.join(self.root, f"date={day}")

    def reset_day(self, day):
        """Cancella la partizione di una giornata prima di riscriverla."""
        target = self.partition_dir(day)
        if os.path.isdir(target):
            shutil.rmtree(target)

    def add(self, day, rows):
        if not rows:
            return
        buffer = self.buffers.setdefault(day, [])
        buffer.extend(rows)
        self.counts[day] = self.counts.get(day, 0) + len(rows)
        if len(buffer) >= self.batch_size:
            self._flush(day)

    def _flush(self, day):
        rows = self.buffers.get(day)
        if not rows:
            return

        table = pa.Table.from_pylist(rows, schema=self.schema)
        writer = self.writers.get(day)
        if writer is None:
            target = self.partition_dir(day)
            os.makedirs(target, exist_ok=True)
            writer = pq.ParquetWriter(
                os.path.join(target, "part.parquet"),
                self.schema,
                compression=COMPRESSION,
            )
            self.writers[day] = writer

        writer.write_table(table)
        self.buffers[day] = []

    def close(self):
        for day in list(self.buffers):
            self._flush(day)
        for writer in self.writers.values():
            writer.close()
        self.writers = {}

    def bytes_written(self):
        total = 0
        for day in self.counts:
            path = os.path.join(self.partition_dir(day), "part.parquet")
            if os.path.exists(path):
                total += os.path.getsize(path)
        return total
