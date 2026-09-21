module.exports = {
  title: 'Cowrie Honeypot',
  display_title: 'Cowrie Honeypot\nAttack Sessions',
  SERVER_ROOT: '',
  // Punto di giunzione: interroga l'API del backend FastAPI (/api/events)
  // anziché scaricare file JSON statici grezzi.
  EVENTS_EXT: '/api/events',
  ASSOCIATIONS_EXT: '/associations.json',
  // Field list per Cowrie eventid; drives the ordering of the session card.
  EVENT_SCHEMA_EXT: '/cowrie_event_schema.json',
  SOURCES_EXT: null,
  SITES_EXT: '',
  SHAPES_EXT: '',
  DATE_FMT: 'YYYY-MM-DD',
  TIME_FMT: 'HH:mm:ss',
  store: {
    app: {
      map: {
        anchor: [30.0, 10.0],
        startZoom: 2
      },
      timeline: {
        // The dataset spans 2026-04-02 → 2026-07-29; open on the whole of it.
        range: ['2026-04-01T00:00:00', '2026-08-01T00:00:00'],
        dimensions: {
          // Track labels are full Cowrie eventids, so the y axis needs room.
          marginLeft: 80
        }
      }
    },
    ui: {
      style: {
        categories: {}
      }
    },
    features: {
      COLOR_BY_ASSOCIATION: true,
      USE_ASSOCIATIONS: true,
      USE_CATEGORIES: false,
      USE_FULLSCREEN: true,
      USE_SEARCH: true,
      USE_SOURCES: false,
      USE_COVER: false,
      GRAPH_NONLOCATED: false,
      HIGHLIGHT_GROUPS: false,
      // One marker / dot / card per Cowrie session_id. The events fetched from
      // EVENTS_EXT are session records, so this only tells the UI to phrase
      // itself in sessions and to render the native Cowrie SessionCard.
      SESSION_AGGREGATION: true
    }
  }
}
