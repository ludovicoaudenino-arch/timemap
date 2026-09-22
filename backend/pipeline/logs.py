"""
Lettura dei log grezzi di Cowrie.

Cowrie scrive un file NDJSON -- un evento JSON per riga -- e lo ruota ogni
notte: `cowrie.json` e' la giornata in corso, `cowrie.json.AAAA-MM-GG` quelle
gia' chiuse, eventualmente compresse in `.gz`.

Due avvertenze che valgono per l'intera pipeline:

1. Il nome del file NON dice quale giornata contiene. Se la rotazione salta,
   gli eventi del giorno prima finiscono nel file del giorno dopo: nei log di
   questa tesi il 1 maggio 2026 sta dentro `cowrie.json.2026-05-02`. La data di
   un evento si legge solo dal suo campo `timestamp`; il nome del file serve
   soltanto a metterli in ordine.
2. Le righe si leggono una alla volta e non si accumulano: la cartella pesa
   qualche gigabyte.
"""

import gzip
import io
import json
import os
import re
from datetime import datetime

# `cowrie.json` (giornata in corso) e i ruotati `cowrie.json.AAAA-MM-GG[.gz]`.
LOG_NAME = re.compile(r"^cowrie\.json(?:\.(\d{4}-\d{2}-\d{2}))?(?:\.gz)?$")

# Estrazione veloce dell'IP sorgente, per il giro di ricognizione che precede
# la geolocalizzazione: su milioni di righe evita di costruire un dizionario
# per ognuna.
SRC_IP = re.compile(r'"src_ip"\s*:\s*"([^"]+)"')


def discover(log_dir):
    """I file di log della cartella, in ordine cronologico.

    I ruotati si ordinano per la data nel nome, la giornata in corso va in
    fondo perche' e' la piu' recente.
    """
    found = []
    for name in os.listdir(log_dir):
        match = LOG_NAME.match(name)
        if match is None:
            continue
        # I ruotati hanno la data nel nome, il file aperto no: ordinandolo con
        # una chiave piu' alta di qualsiasi data resta ultimo.
        day = match.group(1) or "9999-99-99"
        found.append((day, os.path.join(log_dir, name)))

    return [path for _, path in sorted(found)]


def open_log(path):
    if path.endswith(".gz"):
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8", errors="replace")
    return io.open(path, encoding="utf-8", errors="replace")


def parse_timestamp(value):
    """Il timestamp ISO di Cowrie come datetime consapevole del fuso."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def iter_events(paths, on_progress=None):
    """Genera gli eventi dei file indicati, uno alla volta.

    Le righe illeggibili vengono saltate e contate: un log troncato a meta'
    dall'ultima rotazione non deve fermare l'importazione. I conteggi restano
    in `iter_events.stats` una volta esaurito il generatore.
    """
    stats = {"lines": 0, "events": 0, "unparsable": 0, "files": 0}

    for path in paths:
        stats["files"] += 1
        with open_log(path) as handle:
            for line in handle:
                line = line.strip()
                stats["lines"] += 1
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except ValueError:
                    stats["unparsable"] += 1
                    continue
                if not isinstance(event, dict):
                    stats["unparsable"] += 1
                    continue
                stats["events"] += 1
                yield event

                if on_progress is not None and stats["events"] % 500000 == 0:
                    on_progress(stats)

    iter_events.stats = stats


def distinct_source_ips(paths, on_progress=None):
    """Gli IP sorgente distinti presenti nei file, senza costruire gli eventi.

    Serve alla geolocalizzazione: gli indirizzi da risolvere si conoscono prima
    di cominciare a scrivere, cosi' ogni sessione nasce gia' con le sue
    coordinate.
    """
    ips = set()
    lines = 0

    for path in paths:
        with open_log(path) as handle:
            for line in handle:
                lines += 1
                match = SRC_IP.search(line)
                if match:
                    ips.add(match.group(1))
                if on_progress is not None and lines % 1000000 == 0:
                    on_progress(lines, len(ips))

    return ips
