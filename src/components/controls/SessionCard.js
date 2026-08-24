import React, { useState } from "react";
import {
  OUTCOME_COLORS,
  OUTCOME_LABELS,
  SESSION_OUTCOME,
} from "../../common/cowrie";

/** Auth attempts shown before the list is truncated. */
const AUTH_PREVIEW = 5;
const AUTH_TRUNCATE_ABOVE = 8;

const COPY = {
  connection: "Connessione",
  auth: "Autenticazione",
  commands: "Comandi",
  payloads: "Payload",
  closure: "Chiusura",
  other: "Altri eventi",
  source: "Sorgente",
  ports: "Porte",
  client: "Client SSH",
  duration: "Durata",
  noCredentials: "credenziali non rilevate",
  showAll: "mostra tutti i %n tentativi",
  showLess: "mostra meno",
  url: "URL",
  download: "Download",
  upload: "Upload",
  loginAttempts: "%n login",
  loginSuccess: "%n riuscito",
  commandsBadge: "%n comandi",
  payloadsBadge: "%n payload",
  eventsBadge: "%n eventi",
  malware: "MALWARE RILEVATO",
  noLogin: "nessun login",
};

function fmtTime(datetime) {
  if (!(datetime instanceof Date)) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(datetime.getHours())}:${pad(datetime.getMinutes())}:${pad(
    datetime.getSeconds()
  )}`;
}

function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return "—";
  }
  if (seconds < 60) return `${Number(seconds).toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function tpl(str, n) {
  return str.replace("%n", n);
}

function badgeVariantFor(outcome) {
  if (outcome === SESSION_OUTCOME.MALWARE) return "danger";
  if (outcome === SESSION_OUTCOME.INTERACTIVE) return "warning";
  if (outcome === SESSION_OUTCOME.AUTHENTICATED) return "success";
  return "neutral";
}

const Badge = ({ variant = "neutral", children }) => (
  <span className={`session-badge session-badge--${variant}`}>{children}</span>
);

const Row = ({ datetime, children, className = "" }) => (
  <div className={`session-row ${className}`}>
    <span className="session-row-time">{fmtTime(datetime)}</span>
    <span className="session-row-body">{children}</span>
  </div>
);

const Phase = ({ id, label, count, isOpen, onToggle, children }) => (
  <div className={`session-phase ${isOpen ? "open" : ""}`}>
    <button
      type="button"
      className="session-phase-toggle"
      onClick={() => onToggle(id)}
      aria-expanded={isOpen}
    >
      <span className="session-phase-caret">{isOpen ? "▾" : "▸"}</span>
      <span className="session-phase-label">{label}</span>
      {count !== undefined && (
        <span className="session-phase-count">{count}</span>
      )}
    </button>
    {isOpen && <div className="session-phase-body">{children}</div>}
  </div>
);

/**
 * Credential attempts. Bots try dozens of pairs per session, so long lists are
 * collapsed to a preview until the analyst asks for the rest.
 */
const AuthPhase = ({ attempts }) => {
  const [showAll, setShowAll] = useState(false);
  const isTruncated = attempts.length > AUTH_TRUNCATE_ABOVE && !showAll;
  const shown = isTruncated ? attempts.slice(0, AUTH_PREVIEW) : attempts;

  return (
    <>
      {shown.map((attempt, idx) => (
        <Row
          key={`auth-${idx}`}
          datetime={attempt.datetime}
          className={attempt.success ? "success" : "failure"}
        >
          <span className="session-cred-mark">
            {attempt.success ? "✓" : "✗"}
          </span>
          {attempt.username === null && attempt.password === null ? (
            <em>{COPY.noCredentials}</em>
          ) : (
            <code className="session-cred">
              {attempt.username || "∅"}
              <span className="session-cred-sep">:</span>
              {attempt.password || "∅"}
            </code>
          )}
        </Row>
      ))}
      {attempts.length > AUTH_TRUNCATE_ABOVE && (
        <button
          type="button"
          className="session-more"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? COPY.showLess : tpl(COPY.showAll, attempts.length)}
        </button>
      )}
    </>
  );
};

/**
 * The chronological story of one Cowrie attack session: summary badges always
 * visible, each phase of the attack expandable underneath.
 */
const SessionCard = ({ session }) => {
  const { phases, stats, outcome } = session;

  // Open the phases that carry the finding: payloads and commands are what an
  // analyst reaches for; a pure brute-force session opens on its credentials.
  const [openPhases, setOpenPhases] = useState(() => {
    const open = new Set(["connection"]);
    if (stats.payloadCount > 0) open.add("payloads");
    if (stats.commandCount > 0) open.add("commands");
    if (
      stats.payloadCount === 0 &&
      stats.commandCount === 0 &&
      stats.loginAttempts > 0
    ) {
      open.add("auth");
    }
    return open;
  });

  const toggle = (id) =>
    setOpenPhases((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const isOpen = (id) => openPhases.has(id);

  return (
    <div
      className="session-card"
      style={{ borderLeftColor: OUTCOME_COLORS[outcome] }}
    >
      <div className="session-card-header">
        <div className="session-card-title">
          <code className="session-id">{session.id}</code>
          <span className="session-ip">{session.srcIp || "—"}</span>
        </div>
        <div className="session-card-subtitle">
          {session.location || "—"}
          <span className="session-dot">·</span>
          {fmtTime(session.startDatetime)}
          <span className="session-dot">·</span>
          {fmtDuration(session.durationSec)}
        </div>
        <div className="session-badges">
          <Badge>{tpl(COPY.eventsBadge, stats.eventCount)}</Badge>
          {stats.loginAttempts > 0 ? (
            <Badge variant={stats.loginSuccess > 0 ? "success" : "warning"}>
              {tpl(COPY.loginAttempts, stats.loginAttempts)}
              {stats.loginSuccess > 0
                ? ` · ${tpl(COPY.loginSuccess, stats.loginSuccess)}`
                : ""}
            </Badge>
          ) : (
            <Badge>{COPY.noLogin}</Badge>
          )}
          {stats.commandCount > 0 && (
            <Badge variant="warning">
              {tpl(COPY.commandsBadge, stats.commandCount)}
            </Badge>
          )}
          {stats.payloadCount > 0 && (
            <Badge variant="danger">
              {tpl(COPY.payloadsBadge, stats.payloadCount)}
            </Badge>
          )}
          <Badge variant={badgeVariantFor(outcome)}>
            {outcome === SESSION_OUTCOME.MALWARE
              ? COPY.malware
              : OUTCOME_LABELS[outcome]}
          </Badge>
        </div>
      </div>

      <div className="session-phases">
        <Phase
          id="connection"
          label={`1. ${COPY.connection}`}
          isOpen={isOpen("connection")}
          onToggle={toggle}
        >
          <Row datetime={session.startDatetime}>
            {COPY.source}: <code>{session.srcIp || "—"}</code>
            {session.srcPort !== null && session.dstPort !== null && (
              <>
                {" · "}
                {COPY.ports}:{" "}
                <code>
                  {session.srcPort} → {session.dstPort}
                </code>
              </>
            )}
          </Row>
          {session.location && <Row datetime={null}>{session.location}</Row>}
          {phases.fingerprint.map((fp, idx) => (
            <Row key={`fp-${idx}`} datetime={fp.datetime}>
              {COPY.client}: <code>{fp.clientVersion || "—"}</code>
            </Row>
          ))}
        </Phase>

        {phases.auth.length > 0 && (
          <Phase
            id="auth"
            label={`2. ${COPY.auth}`}
            count={phases.auth.length}
            isOpen={isOpen("auth")}
            onToggle={toggle}
          >
            <AuthPhase attempts={phases.auth} />
          </Phase>
        )}

        {phases.commands.length > 0 && (
          <Phase
            id="commands"
            label={`3. ${COPY.commands}`}
            count={phases.commands.length}
            isOpen={isOpen("commands")}
            onToggle={toggle}
          >
            {phases.commands.map((cmd, idx) => (
              <div className="session-row" key={`cmd-${idx}`}>
                <span className="session-row-time">
                  {fmtTime(cmd.datetime)}
                </span>
                <pre className="session-command">{cmd.command || "—"}</pre>
              </div>
            ))}
          </Phase>
        )}

        {phases.payloads.length > 0 && (
          <Phase
            id="payloads"
            label={`4. ${COPY.payloads}`}
            count={phases.payloads.length}
            isOpen={isOpen("payloads")}
            onToggle={toggle}
          >
            {phases.payloads.map((payload, idx) => (
              <Row
                key={`payload-${idx}`}
                datetime={payload.datetime}
                className="payload"
              >
                <span className="session-payload-dir">
                  {payload.direction === "download" ? "⬇" : "⬆"}{" "}
                  {payload.direction === "download"
                    ? COPY.download
                    : COPY.upload}
                </span>
                {payload.url && (
                  <div className="session-payload-line">
                    {COPY.url}: <code>{payload.url}</code>
                  </div>
                )}
                {payload.shasum && (
                  <div className="session-payload-line">
                    <code className="session-shasum" title={payload.savedPath}>
                      {payload.shasum}
                    </code>
                  </div>
                )}
              </Row>
            ))}
          </Phase>
        )}

        {phases.closure && (
          <Phase
            id="closure"
            label={`5. ${COPY.closure}`}
            isOpen={isOpen("closure")}
            onToggle={toggle}
          >
            <Row datetime={phases.closure.datetime}>
              {COPY.duration}: {fmtDuration(session.durationSec)}
            </Row>
          </Phase>
        )}

        {phases.other.length > 0 && (
          <Phase
            id="other"
            label={COPY.other}
            count={phases.other.length}
            isOpen={isOpen("other")}
            onToggle={toggle}
          >
            {phases.other.map((item, idx) => (
              <Row key={`other-${idx}`} datetime={item.datetime}>
                <code className="session-raw-type">{item.event.type}</code>
              </Row>
            ))}
          </Phase>
        )}
      </div>
    </div>
  );
};

export default SessionCard;
