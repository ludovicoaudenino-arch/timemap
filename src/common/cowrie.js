/**
 * Cowrie honeypot domain logic.
 *
 * The dataset in `public/` is keyed by Cowrie's `session` id:
 *
 *   {
 *     "d51b6dc387a5": {
 *       "src_ip": "34.39.58.191",
 *       "location": "London, United Kingdom",
 *       "latitude": "51.5134", "longitude": "-0.0890675",
 *       "events": [ { "eventid": "cowrie.session.connect", ... }, ... ]
 *     }
 *   }
 *
 * This module turns each of those records into a single timemap domain event,
 * so that one marker on the map and one dot on the timeline is one attack
 * session. The raw Cowrie events travel along untouched under `event.session`,
 * and `SessionCard` renders them field by field.
 *
 * Nothing here renames, translates or summarises Cowrie data: the only derived
 * value is `stage`, and even that is named after the Cowrie eventid that marks
 * how far the session got, because timemap needs exactly one category per
 * event to place it on a timeline track.
 */
import dayjs from "dayjs";

const DATE_FMT = process.env.DATE_FMT || "MM/DD/YYYY";
const TIME_FMT = process.env.TIME_FMT || "HH:mm";

/** Prefix keeping CATEGORY association ids distinct from the FILTER ids. */
export const STAGE_ID_PREFIX = "stage:";

function some(set, predicate) {
  for (const value of set) if (predicate(value)) return true;
  return false;
}

/**
 * Timeline tracks, most advanced first. The title in associations.json is the
 * bare eventid; `test` decides which track a session belongs to.
 */
export const SESSION_STAGES = [
  {
    id: "cowrie.session.file_download",
    test: (ids) =>
      ids.has("cowrie.session.file_download") ||
      ids.has("cowrie.session.file_download.failed") ||
      ids.has("cowrie.session.file_upload"),
  },
  {
    id: "cowrie.direct-tcpip.request",
    test: (ids) => some(ids, (id) => id.startsWith("cowrie.direct-tcpip.")),
  },
  {
    id: "cowrie.command.input",
    test: (ids) => some(ids, (id) => id.startsWith("cowrie.command.")),
  },
  {
    id: "cowrie.login.success",
    test: (ids) => ids.has("cowrie.login.success"),
  },
  {
    id: "cowrie.login.failed",
    test: (ids) => ids.has("cowrie.login.failed"),
  },
  {
    id: "cowrie.session.connect",
    test: () => true,
  },
];

/** Marker colour per track. */
export const STAGE_COLORS = {
  "cowrie.session.file_download": "#d64550",
  "cowrie.direct-tcpip.request": "#a970c9",
  "cowrie.command.input": "#e8973a",
  "cowrie.login.success": "#3fb950",
  "cowrie.login.failed": "#d9b23a",
  "cowrie.session.connect": "#4a9edd",
};

/**
 * Order the card lays its sections out in: the Cowrie handshake / auth / shell
 * / exfiltration sequence. Eventids not listed are appended after these, in
 * first-seen order.
 */
export const EVENTID_ORDER = [
  "cowrie.session.connect",
  "cowrie.client.version",
  "cowrie.client.kex",
  "cowrie.client.fingerprint",
  "cowrie.client.size",
  "cowrie.client.var",
  "cowrie.client.malformed_packet",
  "cowrie.login.failed",
  "cowrie.login.success",
  "cowrie.session.params",
  "cowrie.command.input",
  "cowrie.command.failed",
  "cowrie.command.success",
  "cowrie.command.chpasswd",
  "cowrie.session.input",
  "cowrie.session.file_download",
  "cowrie.session.file_download.failed",
  "cowrie.session.file_upload",
  "cowrie.direct-tcpip.request",
  "cowrie.direct-tcpip.data",
  "cowrie.direct-tcpip.tunnel",
  "cowrie.direct-tcpip.redirect",
  "cowrie.direct-tcpip.ja4",
  "cowrie.direct-tcpip.ja4h",
  "cowrie.telnet.option",
  "cowrie.telnet.exploit_attempt",
  "cowrie.telnet.exploit_success",
  "cowrie.telnet.error",
  "cowrie.proxy.backend_connected",
  "cowrie.proxy.backend_disconnected",
  "cowrie.proxy.backend_connect_error",
  "cowrie.proxy.client_disconnect",
  "cowrie.proxy.ssh",
  "cowrie.reversedns.connect",
  "cowrie.reversedns.forward",
  "cowrie.virustotal.scanfile",
  "cowrie.virustotal.scanurl",
  "cowrie.urlhaus.submitted",
  "cowrie.greynoise.result",
  "cowrie.abuseipdb.started",
  "cowrie.abuseipdb.reportedip",
  "cowrie.abuseipdb.reportfail",
  "cowrie.abuseipdb.ratelimited",
  "cowrie.abuseipdb.wakeup",
  "cowrie.log.open",
  "cowrie.log.closed",
  "cowrie.session.closed",
];

/**
 * Fields Cowrie repeats on every event of a session. The card prints them once
 * in the header rather than on every row; nothing is dropped.
 */
export const ENVELOPE_FIELDS = [
  "eventid",
  "session",
  "sensor",
  "uuid",
  "src_ip",
  "protocol",
];

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** Where in `EVENTID_ORDER` an eventid sits; unknown ids sort last. */
function orderOf(eventid) {
  const idx = EVENTID_ORDER.indexOf(eventid);
  return idx === -1 ? EVENTID_ORDER.length : idx;
}

/** The track a session belongs to, named after a Cowrie eventid. */
export function deriveStage(eventIds) {
  const ids = eventIds instanceof Set ? eventIds : new Set(eventIds);
  return SESSION_STAGES.find((s) => s.test(ids)).id;
}

/**
 * Reconstruct one attack session from its raw Cowrie events.
 *
 * @param {string} id the Cowrie `session` key
 * @param {object} record `{ src_ip, location, latitude, longitude, events }`
 * @returns {object|null} the session, or null if it holds no dated event
 */
export function buildSession(id, record) {
  if (!record || !Array.isArray(record.events)) return null;

  const events = record.events
    .filter((e) => e && e.eventid)
    .map((e) => ({ ...e, datetime: new Date(e.timestamp) }))
    .filter((e) => isValidDate(e.datetime))
    .sort((a, b) => a.datetime - b.datetime);

  if (events.length === 0) return null;

  // One group per eventid, groups in card order, each group chronological.
  const byEventId = new Map();
  events.forEach((event) => {
    if (!byEventId.has(event.eventid)) byEventId.set(event.eventid, []);
    byEventId.get(event.eventid).push(event);
  });

  const groups = [...byEventId.entries()]
    .map(([eventid, groupEvents]) => ({ eventid, events: groupEvents }))
    .sort((a, b) => orderOf(a.eventid) - orderOf(b.eventid));

  const first = events[0];
  const last = events[events.length - 1];
  const connects = byEventId.get("cowrie.session.connect");
  const closes = byEventId.get("cowrie.session.closed");
  const connect = connects ? connects[0] : {};
  const closed = closes ? closes[0] : {};

  const closedDuration = toNumberOrNull(closed.duration);

  return {
    id,
    srcIp: record.src_ip || first.src_ip || null,
    location: record.location || null,
    latitude: record.latitude || null,
    longitude: record.longitude || null,

    // Envelope: constant across the session, printed once in the card header.
    sensor: first.sensor || null,
    uuid: first.uuid || null,
    protocol: first.protocol || null,
    srcPort: connect.src_port === undefined ? null : connect.src_port,
    dstIp: connect.dst_ip || null,
    dstPort: connect.dst_port === undefined ? null : connect.dst_port,

    startTimestamp: first.timestamp,
    endTimestamp: last.timestamp,
    startDatetime: first.datetime,
    endDatetime: last.datetime,
    durationSec:
      closedDuration !== null
        ? closedDuration
        : (last.datetime - first.datetime) / 1000,

    events,
    groups,
    eventIds: groups.map((g) => g.eventid),
    eventCount: events.length,
    stage: deriveStage(new Set(byEventId.keys())),
  };
}

/**
 * Turn a session into the timemap domain event that carries it. Everything
 * timemap needs (date, coordinates, category, associations) is derived here;
 * the session itself rides along under `session`.
 */
export function sessionToEvent(session) {
  const { stage } = session;

  return {
    // `validateDomain` reassigns `id` to the array index, so the Cowrie
    // session key also lives in `civId`, which nothing downstream rewrites.
    id: session.id,
    civId: session.id,
    description: [
      session.id,
      session.srcPort !== null
        ? `${session.srcIp}:${session.srcPort}`
        : session.srcIp,
      session.dstIp !== null && session.dstPort !== null
        ? `> ${session.dstIp}:${session.dstPort}`
        : null,
      session.protocol,
    ]
      .filter(Boolean)
      .join(" "),
    date: dayjs(session.startDatetime).format(DATE_FMT),
    time: dayjs(session.startDatetime).format(TIME_FMT),
    time_precision: "second",
    time_display: session.startTimestamp,

    location: session.location || "",
    latitude: session.latitude || "",
    longitude: session.longitude || "",

    // `type` and `category` hold Cowrie eventids, never a translated label.
    type: stage,
    category: stage,
    category_full: stage,
    // CATEGORY association for the track, plus one FILTER association per
    // eventid the session actually contains.
    associations: [`${STAGE_ID_PREFIX}${stage}`, ...session.eventIds],
    sources: [],
    comments: "",
    shape: "",
    colour: STAGE_COLORS[stage],

    session,
  };
}

/**
 * Whether a fetched payload is the session-keyed Cowrie export rather than a
 * plain timemap events array.
 */
export function isSessionKeyedExport(payload) {
  return (
    !!payload &&
    !Array.isArray(payload) &&
    typeof payload === "object" &&
    Object.values(payload).some((v) => v && Array.isArray(v.events))
  );
}

/**
 * Convert the whole `cowrie_by_session.json` / `sample_1000.json` export into
 * timemap domain events, one per session, sorted by start time.
 */
export function sessionsToEvents(bySession) {
  if (!bySession || typeof bySession !== "object") return [];

  const events = [];
  Object.keys(bySession).forEach((id) => {
    const session = buildSession(id, bySession[id]);
    if (session) events.push(sessionToEvent(session));
  });

  events.sort((a, b) => a.session.startDatetime - b.session.startDatetime);
  return events;
}
