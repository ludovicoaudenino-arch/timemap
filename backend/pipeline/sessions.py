"""
Ricostruzione delle sessioni di attacco a partire dagli eventi grezzi.

Cowrie registra eventi, non sessioni: una riga per la connessione, una per
ogni tentativo di password, una per ogni comando. L'unita' di analisi della
tesi e' pero' la sessione -- una visita, dal `cowrie.session.connect` al
`cowrie.session.closed` -- perche' e' quella che corrisponde a un incident di
Timemap: un momento, un luogo, una fonte che lo documenta.

Gli eventi arrivano in ordine cronologico, quindi le sessioni aperte
contemporaneamente sono poche e la memoria resta bassa anche su un dataset di
gigabyte: ognuna viene chiusa e consegnata non appena arriva il suo evento di
chiusura.
"""

import json

from .logs import parse_timestamp

# Lo stadio piu' avanzato raggiunto dall'attaccante. L'ordine e' quello di
# SESSION_STAGES in src/common/cowrie.js e di STAGE_SQL in backend/app.py:
# i tre punti devono classificare allo stesso modo.
STAGE_ORDER = [
    ("cowrie.session.file_download", ("cowrie.session.file_download",
                                      "cowrie.session.file_download.failed",
                                      "cowrie.session.file_upload"), None),
    ("cowrie.direct-tcpip.request", (), "cowrie.direct-tcpip."),
    ("cowrie.command.input", (), "cowrie.command."),
    ("cowrie.login.success", ("cowrie.login.success",), None),
    ("cowrie.login.failed", ("cowrie.login.failed",), None),
]


def derive_stage(event_ids):
    """Lo stadio della sessione, dato l'insieme dei suoi eventid."""
    for stage, exact, prefix in STAGE_ORDER:
        if any(eventid in event_ids for eventid in exact):
            return stage
        if prefix and any(eventid.startswith(prefix) for eventid in event_ids):
            return stage
    return "cowrie.session.connect"


class Sessionizer:
    """Accumula gli eventi per sessione e restituisce le sessioni concluse."""

    def __init__(self, geo_cache):
        self.geo_cache = geo_cache
        self.open = {}
        self.without_session = 0
        self.without_timestamp = 0
        self.unresolved_ips = set()

    def add(self, event):
        """Incorpora un evento. Restituisce la sessione se si e' appena chiusa."""
        session_id = event.get("session")
        if not session_id:
            self.without_session += 1
            return None

        timestamp = parse_timestamp(event.get("timestamp"))
        if timestamp is None:
            self.without_timestamp += 1
            return None

        bucket = self.open.get(session_id)
        if bucket is None:
            bucket = []
            self.open[session_id] = bucket
        bucket.append((timestamp, event))

        if event.get("eventid") == "cowrie.session.closed":
            return self._build(session_id, self.open.pop(session_id))
        return None

    def flush(self):
        """Le sessioni rimaste aperte: l'ultimo file di log finisce a meta'."""
        for session_id in list(self.open):
            yield self._build(session_id, self.open.pop(session_id))

    def _build(self, session_id, entries):
        entries.sort(key=lambda item: item[0])
        first_dt, first_event = entries[0]
        last_dt = entries[-1][0]

        connect = {}
        closed = {}
        event_ids = set()
        for _, event in entries:
            eventid = event.get("eventid")
            if eventid:
                event_ids.add(eventid)
            if eventid == "cowrie.session.connect" and not connect:
                connect = event
            elif eventid == "cowrie.session.closed":
                closed = event

        duration = _to_float(closed.get("duration"))
        if duration is None:
            duration = (last_dt - first_dt).total_seconds()

        src_ip = first_event.get("src_ip") or connect.get("src_ip")
        location = self.geo_cache.get(src_ip) if src_ip else None
        if src_ip and location is None:
            self.unresolved_ips.add(src_ip)

        session_row = {
            "session_id": str(session_id),
            "src_ip": src_ip,
            "src_port": _to_int(connect.get("src_port")),
            "dst_ip": connect.get("dst_ip"),
            "dst_port": _to_int(connect.get("dst_port")),
            "protocol": first_event.get("protocol") or connect.get("protocol"),
            "sensor": first_event.get("sensor"),
            "location": location.get("location") if location else None,
            "latitude": _to_float(location.get("latitude")) if location else None,
            "longitude": _to_float(location.get("longitude")) if location else None,
            "start_time": first_dt,
            "end_time": last_dt,
            "duration_sec": duration,
            "associations": sorted(event_ids),
            "event_count": len(entries),
        }

        event_rows = []
        for seq, (timestamp, event) in enumerate(entries, start=1):
            message = event.get("message")
            if isinstance(message, (list, dict)):
                message = json.dumps(message)
            elif message is not None:
                message = str(message)

            event_rows.append({
                "session_id": str(session_id),
                "seq": seq,
                "timestamp": timestamp,
                "eventid": event.get("eventid"),
                "message": message,
                "data_json": json.dumps(event),
            })

        return session_row, event_rows


def _to_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
