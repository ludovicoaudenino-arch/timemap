/**
 * Cowrie honeypot domain logic.
 *
 * The exported events carry their Cowrie semantics inside prose strings
 * (`description` / `comments`) rather than as structured fields — e.g.
 *
 *   description: "Tentativo di login fallito con credenziali 'admin':'admin' da 128.199.103.139"
 *   comments:    "Credenziali tentate: admin:admin | Session ID: 554f134a88e0"
 *
 * This module is the single place where those strings are parsed back into
 * fields, and the only place that knows about Cowrie eventids. If the export
 * ever gains real structured fields, `parseCowrieEvent` is the one function
 * that needs to change.
 */

export const COWRIE_EVENT = {
  SESSION_CONNECT: "cowrie.session.connect",
  SESSION_CLOSED: "cowrie.session.closed",
  SESSION_PARAMS: "cowrie.session.params",
  CLIENT_VERSION: "cowrie.client.version",
  CLIENT_KEX: "cowrie.client.kex",
  LOGIN_FAILED: "cowrie.login.failed",
  LOGIN_SUCCESS: "cowrie.login.success",
  COMMAND_INPUT: "cowrie.command.input",
  FILE_DOWNLOAD: "cowrie.session.file_download",
  FILE_UPLOAD: "cowrie.session.file_upload",
  LOG_CLOSED: "cowrie.log.closed",
};

const HANDSHAKE_EVENTS = [
  COWRIE_EVENT.SESSION_CONNECT,
  COWRIE_EVENT.SESSION_PARAMS,
  COWRIE_EVENT.CLIENT_KEX,
];

export const SESSION_OUTCOME = {
  MALWARE: "malware",
  INTERACTIVE: "interactive",
  AUTHENTICATED: "authenticated",
  RECON: "recon",
};

/** Colours mirror the per-event `colour` already present in the export. */
export const OUTCOME_COLORS = {
  [SESSION_OUTCOME.MALWARE]: "#9b59b6",
  [SESSION_OUTCOME.INTERACTIVE]: "#f39c12",
  [SESSION_OUTCOME.AUTHENTICATED]: "#2ecc71",
  [SESSION_OUTCOME.RECON]: "#3498db",
};

/** Paint order on the timeline: higher value renders on top. */
export const OUTCOME_ORDER = {
  [SESSION_OUTCOME.RECON]: 0,
  [SESSION_OUTCOME.AUTHENTICATED]: 1,
  [SESSION_OUTCOME.INTERACTIVE]: 2,
  [SESSION_OUTCOME.MALWARE]: 3,
};

export const OUTCOME_LABELS = {
  [SESSION_OUTCOME.MALWARE]: "Malware rilevato",
  [SESSION_OUTCOME.INTERACTIVE]: "Shell interattiva",
  [SESSION_OUTCOME.AUTHENTICATED]: "Accesso riuscito",
  [SESSION_OUTCOME.RECON]: "Ricognizione",
};

const UNGROUPED_PREFIX = "__ungrouped__";

const RE_SESSION_ID = /Session ID:\s*([0-9a-zA-Z_-]+)/;
const RE_IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;
const RE_PORTS = /Porte:\s*(\d+)\s*->\s*(\d+)/;
const RE_DURATION = /Durata:\s*([\d.]+)\s*second/i;
const RE_CLIENT = /Client SSH:\s*([^|]+)/;
const RE_SAVED_PATH = /Salvato in:\s*([^|]*)/;
const RE_URL = /URL:\s*([^|]*)/;
// Credentials are `user:pass`; the password may itself be empty or contain
// most characters, but never a `|` (the comments field separator).
const RE_CREDENTIALS = /Credenziali(?:\s+tentate)?:\s*([^:|]*):([^|]*)/;
// Preferred source for commands: the description has no trailing separator,
// so the command text survives verbatim even when it contains `|` or `:`.
const RE_COMMAND_DESC = /Comando eseguito dal bot:\s*([\s\S]*)$/;
const RE_COMMAND_COMMENT = /Comando:\s*([\s\S]*?)(?:\s*\|\s*Session ID:.*)?$/;

function trimOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function matchGroup(re, text, group = 1) {
  const m = re.exec(text);
  return m ? trimOrNull(m[group]) : null;
}

function toInt(value) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

function toFloat(value) {
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

/**
 * Extract the structured Cowrie fields hidden in an event's prose.
 * Never throws: every field independently falls back to null.
 *
 * @param {object} event a validated domain event
 * @returns {object} the parsed fields
 */
export function parseCowrieEvent(event) {
  const description =
    typeof event.description === "string" ? event.description : "";
  const comments = typeof event.comments === "string" ? event.comments : "";
  const both = `${description} | ${comments}`;

  const credentials = RE_CREDENTIALS.exec(comments);
  const ports = RE_PORTS.exec(comments);

  let command = matchGroup(RE_COMMAND_DESC, description);
  if (command === null) command = matchGroup(RE_COMMAND_COMMENT, comments);

  const savedPath = matchGroup(RE_SAVED_PATH, comments);

  return {
    sessionId: trimOrNull(event.civId) || matchGroup(RE_SESSION_ID, comments),
    srcIp: matchGroup(RE_IPV4, both),
    srcPort: ports ? toInt(ports[1]) : null,
    dstPort: ports ? toInt(ports[2]) : null,
    username: credentials ? trimOrNull(credentials[1]) : null,
    password: credentials ? trimOrNull(credentials[2]) : null,
    command,
    url: matchGroup(RE_URL, comments),
    savedPath,
    // Cowrie names downloaded artefacts after their sha256.
    shasum: savedPath
      ? savedPath.split("/").filter(Boolean).pop() || null
      : null,
    durationSec: toFloat(matchGroup(RE_DURATION, comments)),
    clientVersion: matchGroup(RE_CLIENT, comments),
  };
}

/**
 * Classify a session by how far the attacker got. Ordered most severe first.
 */
export function deriveOutcome(stats) {
  if (stats.payloadCount > 0) return SESSION_OUTCOME.MALWARE;
  if (stats.commandCount > 0) return SESSION_OUTCOME.INTERACTIVE;
  if (stats.loginSuccess > 0) return SESSION_OUTCOME.AUTHENTICATED;
  return SESSION_OUTCOME.RECON;
}

function emptyPhases() {
  return {
    handshake: [],
    fingerprint: [],
    auth: [],
    commands: [],
    payloads: [],
    closure: null,
    other: [],
  };
}

function buildSession(id, events) {
  const sorted = [...events].sort((a, b) => a.datetime - b.datetime);
  const phases = emptyPhases();

  let srcIp = null;
  let srcPort = null;
  let dstPort = null;
  let clientVersion = null;
  let closureDuration = null;

  sorted.forEach((event) => {
    const parsed = parseCowrieEvent(event);
    const at = event.datetime;

    if (parsed.srcIp && !srcIp) srcIp = parsed.srcIp;
    if (parsed.srcPort !== null && srcPort === null) srcPort = parsed.srcPort;
    if (parsed.dstPort !== null && dstPort === null) dstPort = parsed.dstPort;
    if (parsed.clientVersion && !clientVersion)
      clientVersion = parsed.clientVersion;

    switch (event.type) {
      case COWRIE_EVENT.LOGIN_FAILED:
      case COWRIE_EVENT.LOGIN_SUCCESS:
        phases.auth.push({
          datetime: at,
          username: parsed.username,
          password: parsed.password,
          success: event.type === COWRIE_EVENT.LOGIN_SUCCESS,
          event,
        });
        break;

      case COWRIE_EVENT.COMMAND_INPUT:
        phases.commands.push({ datetime: at, command: parsed.command, event });
        break;

      case COWRIE_EVENT.FILE_DOWNLOAD:
      case COWRIE_EVENT.FILE_UPLOAD:
        phases.payloads.push({
          datetime: at,
          direction:
            event.type === COWRIE_EVENT.FILE_DOWNLOAD ? "download" : "upload",
          url: parsed.url,
          shasum: parsed.shasum,
          savedPath: parsed.savedPath,
          event,
        });
        break;

      case COWRIE_EVENT.CLIENT_VERSION:
        phases.fingerprint.push({
          datetime: at,
          clientVersion: parsed.clientVersion,
          event,
        });
        break;

      case COWRIE_EVENT.SESSION_CLOSED:
        closureDuration = parsed.durationSec;
        phases.closure = {
          datetime: at,
          durationSec: parsed.durationSec,
          event,
        };
        break;

      default:
        if (HANDSHAKE_EVENTS.includes(event.type)) {
          phases.handshake.push({ datetime: at, event });
        } else {
          phases.other.push({ datetime: at, event });
        }
    }
  });

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const startDatetime = first.datetime;
  const endDatetime = last.datetime;

  const stats = {
    eventCount: sorted.length,
    loginAttempts: phases.auth.length,
    loginFailed: phases.auth.filter((a) => !a.success).length,
    loginSuccess: phases.auth.filter((a) => a.success).length,
    commandCount: phases.commands.length,
    payloadCount: phases.payloads.length,
  };
  stats.hasMalware = stats.payloadCount > 0;

  // The geo of a session is the geo of its events: Cowrie resolves it from the
  // source IP, so every event in a session shares it.
  const located = sorted.find((e) => e.latitude && e.longitude) || first;

  return {
    id,
    startDatetime,
    endDatetime,
    durationSec:
      closureDuration !== null
        ? closureDuration
        : (endDatetime - startDatetime) / 1000,
    srcIp,
    srcPort,
    dstPort,
    location: located.location || null,
    latitude: located.latitude,
    longitude: located.longitude,
    clientVersion,
    events: sorted,
    phases,
    stats,
    outcome: deriveOutcome(stats),
  };
}

/**
 * Group flat Cowrie events into attack sessions, keyed by `civId`
 * (Cowrie's `session`). Events without one become single-event sessions so
 * that nothing silently disappears from the visualisation.
 *
 * @param {Array<object>} events validated domain events (need `datetime`)
 * @returns {Array<object>} sessions sorted by start time
 */
export function buildSessions(events) {
  if (!Array.isArray(events)) return [];

  const grouped = new Map();

  events.forEach((event, idx) => {
    if (!event || !event.datetime) return;
    const id =
      trimOrNull(event.civId) ||
      matchGroup(RE_SESSION_ID, event.comments || "") ||
      `${UNGROUPED_PREFIX}${idx}`;

    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(event);
  });

  const sessions = [];
  grouped.forEach((sessionEvents, id) => {
    sessions.push(buildSession(id, sessionEvents));
  });

  sessions.sort((a, b) => a.startDatetime - b.startDatetime);
  return sessions;
}
