# Schema Dati e Specifiche API (TimeMap Cowrie)

Questo documento descrive formalmente l'architettura dei dati, lo schema dei file Parquet e la specifica degli endpoint FastAPI adottati nel progetto TimeMap.

---

## 1. Schema Archiviazione Parquet

I dati grezzi di Cowrie sono convertiti in due tabelle Parquet compresse con algoritmo `zstd`, ottimizzate per interrogazioni colonnari ultra-rapide (~30 ms per 10.000 record tramite DuckDB).

### 1.1 `sessions.parquet` (Tabella Master delle Sessioni)

Ogni riga corrisponde a una singola sessione di attacco identificata univocamente da `session_id`.

| Campo | Tipo Parquet / DuckDB | Nullable | Descrizione |
|---|---|---|---|
| `session_id` | `VARCHAR` | No | Chiave primaria univoca della sessione (es. `"965d0f763089"`) |
| `src_ip` | `VARCHAR` | Sì | Indirizzo IP di origine dell'attaccante |
| `src_port` | `INT64` | Sì | Porta sorgente della connessione |
| `dst_ip` | `VARCHAR` | Sì | Indirizzo IP del sensore honeypot |
| `dst_port` | `INT64` | Sì | Porta di destinazione sul sensore (es. 2222 per SSH, 2223 per Telnet) |
| `protocol` | `VARCHAR` | Sì | Protocollo di rete utilizzato (`ssh`, `telnet`) |
| `sensor` | `VARCHAR` | Sì | Identificativo del sensore Cowrie |
| `location` | `VARCHAR` | Sì | Denominazione geografica (Città, Nazione) |
| `latitude` | `DOUBLE` | Sì | Latitudine geografica reale (se assente `NULL`, mai inventata a 0.0) |
| `longitude` | `DOUBLE` | Sì | Longitudine geografica reale (se assente `NULL`) |
| `start_time` | `TIMESTAMPTZ` | No | Timestamp di inizio sessione in UTC |
| `end_time` | `TIMESTAMPTZ` | No | Timestamp di fine sessione in UTC |
| `duration_sec` | `DOUBLE` | No | Durata totale della sessione in secondi |
| `associations` | `LIST(VARCHAR)` | No | Elenco nativo degli eventid Cowrie verificatisi nella sessione |
| `event_count` | `INT64` | No | Numero totale di eventi elementari registrati nella sessione |

### 1.2 `events.parquet` (Dettaglio Eventi Elementari)

Contiene la sequenza cronologica completa di tutti gli eventi grezzi registrati durante le sessioni.

| Campo | Tipo Parquet / DuckDB | Nullable | Descrizione |
|---|---|---|---|
| `session_id` | `VARCHAR` | No | Chiave esterna che mappa sulla sessione corrispondente |
| `seq` | `INT64` | No | Ordine progressivo dell'evento all'interno della sessione (1, 2, 3...) |
| `timestamp` | `TIMESTAMPTZ` | No | Timestamp dell'evento elementare in UTC |
| `eventid` | `VARCHAR` | No | Tipologia evento nativa Cowrie (es. `cowrie.session.connect`, `cowrie.login.failed`) |
| `message` | `VARCHAR` | Sì | Messaggio formattato human-readable generato da Cowrie |
| `data_json` | `VARCHAR` | No | Payload JSON integrale e grezzo contenente tutti i campi specifici dell'evento |

---

## 2. Specifiche API REST (FastAPI + DuckDB)

Tutte le risposte utilizzano timestamp formattati nello standard ISO-8601 UTC (`YYYY-MM-DDTHH:mm:ss.000Z`).

### 2.1 `GET /api/events`
Restituisce le sessioni di attacco modellate nella forma di dominio nativa di TimeMap.

- **Parametri Query:**
  - `filter` (opzionale, `str`): filtra le sessioni che contengono uno specifico eventid (es. `cowrie.login.failed`).
  - `from_date` (opzionale, `str`): timestamp ISO di inizio intervallo (es. `2026-04-01T00:00:00Z`).
  - `to_date` (opzionale, `str`): timestamp ISO di fine intervallo (es. `2026-08-01T00:00:00Z`).
  - `limit` (opzionale, `int`, default `5000`): numero massimo di sessioni restituite.
- **Sicurezza:** tutte le clausole SQL sono parametrizzate con segnaposto `?` nativi per impedire SQL injection.
- **Schema Risposta (Array di Oggetti):**
  ```json
  [
    {
      "id": "965d0f763089",
      "civId": "965d0f763089",
      "src_ip": "51.158.205.203",
      "src_port": 61000,
      "dst_ip": "207.154.234.112",
      "dst_port": 2222,
      "protocol": "ssh",
      "location": "Haarlem, The Netherlands",
      "latitude": "52.3874",
      "longitude": "4.64622",
      "date": "2026-04-02",
      "time": "16:46:21",
      "time_precision": "second",
      "time_display": "2026-04-02T16:46:21.000Z",
      "description": "965d0f763089 51.158.205.203 > 207.154.234.112 ssh",
      "type": "ssh",
      "category": "ssh",
      "category_full": "ssh",
      "colour": "#3fb950",
      "associations": [
        "cowrie.session.closed",
        "cowrie.session.connect"
      ],
      "duration_sec": 0.0,
      "event_count": 2,
      "session": {
        "id": "965d0f763089",
        "srcIp": "51.158.205.203",
        "srcPort": 61000,
        "dstIp": "207.154.234.112",
        "dstPort": 2222,
        "protocol": "ssh",
        "location": "Haarlem, The Netherlands",
        "latitude": "52.3874",
        "longitude": "4.64622",
        "startTimestamp": "2026-04-02T16:46:21.000Z",
        "endTimestamp": "2026-04-02T16:46:21.000Z",
        "durationSec": 0.0,
        "eventIds": ["cowrie.session.closed", "cowrie.session.connect"],
        "eventCount": 2,
        "events": [],
        "groups": []
      }
    }
  ]
  ```

### 2.2 `GET /api/sessions/{session_id}/events`
Restituisce on-demand la lista ordinata dei log grezzi appartenenti alla singola sessione richiesta per popolare la `SessionCard` nel frontend.

- **Parametri URL:**
  - `session_id` (`str`): identificativo della sessione (es. `965d0f763089`).
- **Schema Risposta (Array di Oggetti):**
  ```json
  [
    {
      "timestamp": "2026-04-02T16:46:21.000Z",
      "eventid": "cowrie.session.connect",
      "message": "New connection: 51.158.205.203:61000 (207.154.234.112:2222) [session: 965d0f763089]",
      "data_json": "{\"eventid\": \"cowrie.session.connect\", \"timestamp\": \"2026-04-02T16:46:21.144883Z\", ...}"
    },
    {
      "timestamp": "2026-04-02T16:46:21.000Z",
      "eventid": "cowrie.session.closed",
      "message": "Connection lost after 0.0 seconds",
      "data_json": "{\"eventid\": \"cowrie.session.closed\", \"timestamp\": \"2026-04-02T16:46:21.149201Z\", ...}"
    }
  ]
  ```
