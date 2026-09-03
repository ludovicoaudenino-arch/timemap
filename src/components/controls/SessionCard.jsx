import React, { useState } from "react";
import { ENVELOPE_FIELDS, STAGE_COLORS } from "../../common/cowrie";

/**
 * One Cowrie attack session, rendered as raw log.
 *
 * There is deliberately no naturalised copy in here: every section is titled
 * with its Cowrie `eventid`, every row is labelled with the Cowrie field name,
 * and every value is printed exactly as it appears in the log. The only text
 * this component owns are the field names themselves.
 *
 * Field order per section comes from `public/cowrie_event_schema.json`:
 * `timestamp` first, then the fields that schema declares for the eventid,
 * then `message` (Cowrie's own rendering of the others) last, then any field
 * present in the log but absent from the schema. Schema fields that the log
 * did not carry are listed, by name, at the foot of the entry.
 */

/** Printed once in the header instead of on every row. */
const HEADER_FIELDS = new Set([...ENVELOPE_FIELDS, "datetime"]);

const ABSENT_TITLE =
  "campi dichiarati da cowrie_event_schema.json e non presenti in questo evento";

function isPresent(event, key) {
  return Object.prototype.hasOwnProperty.call(event, key);
}

/**
 * The fields to print for one raw Cowrie event, in display order.
 *
 * @param {object} event a raw Cowrie event
 * @param {Array<string>} schemaFields `cowrie_event_schema.json[eventid]`
 * @returns {{ fields: Array<string>, absent: Array<string> }}
 */
export function orderFields(event, schemaFields = []) {
  const declared = schemaFields.filter((key) => !HEADER_FIELDS.has(key));
  const logged = Object.keys(event).filter((key) => !HEADER_FIELDS.has(key));

  const specific = declared.filter(
    (key) => key !== "timestamp" && key !== "message"
  );
  const undeclared = logged.filter(
    (key) => !declared.includes(key) && key !== "timestamp" && key !== "message"
  );

  const ordered = [
    ...(isPresent(event, "timestamp") ? ["timestamp"] : []),
    ...specific,
    ...undeclared,
    ...(isPresent(event, "message") ? ["message"] : []),
  ];

  return {
    fields: ordered.filter((key) => isPresent(event, key)),
    absent: ordered.filter((key) => !isPresent(event, key)),
  };
}

/** Print a Cowrie value verbatim; only its container shape is interpreted. */
const Value = ({ value }) => {
  if (value === null) return <code className="session-value null">null</code>;

  if (Array.isArray(value)) {
    if (value.length === 0)
      return <code className="session-value empty">[]</code>;
    return (
      <span className="session-value-list">
        {value.map((item, idx) => (
          <code className="session-value" key={idx}>
            {typeof item === "object" ? JSON.stringify(item) : String(item)}
          </code>
        ))}
      </span>
    );
  }

  if (typeof value === "object") {
    return <code className="session-value">{JSON.stringify(value)}</code>;
  }

  return <code className="session-value">{String(value)}</code>;
};

const Field = ({ name, value }) => (
  <div className="session-field">
    <dt className="session-field-key">{name}</dt>
    <dd className="session-field-value">
      <Value value={value} />
    </dd>
  </div>
);

/** One occurrence of an eventid inside the session. */
const LogEntry = ({ event, index, total, schemaFields }) => {
  const { fields, absent } = orderFields(event, schemaFields);

  return (
    <div className="session-log-entry">
      {total > 1 && <div className="session-log-entry-index">{index + 1}</div>}
      <dl className="session-fields">
        {fields.map((name) => (
          <Field key={name} name={name} value={event[name]} />
        ))}
      </dl>
      {absent.length > 0 && (
        <div className="session-fields-absent" title={ABSENT_TITLE}>
          {absent.join(" · ")}
        </div>
      )}
    </div>
  );
};

/** All occurrences of one eventid, under a heading naming that eventid. */
const LogSection = ({ eventid, events, schemaFields }) => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <section className={`session-log ${isOpen ? "open" : ""}`}>
      <button
        type="button"
        className="session-log-head"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span className="session-log-caret">{isOpen ? "▾" : "▸"}</span>
        <code className="session-log-eventid">{eventid}</code>
        <span className="session-log-count">{events.length}</span>
      </button>
      {isOpen && (
        <div className="session-log-body">
          {events.map((event, idx) => (
            <LogEntry
              key={`${event.timestamp}-${idx}`}
              event={event}
              index={idx}
              total={events.length}
              schemaFields={schemaFields}
            />
          ))}
        </div>
      )}
    </section>
  );
};

const SessionCard = ({ session, eventSchema = {} }) => {
  if (!session) return null;

  // Constant across every event of the session, so it is printed once here.
  const envelope = [
    ["src_ip", session.srcIp],
    ["src_port", session.srcPort],
    ["dst_ip", session.dstIp],
    ["dst_port", session.dstPort],
    ["protocol", session.protocol],
    ["location", session.location],
    ["latitude", session.latitude],
    ["longitude", session.longitude],
    ["timestamp", session.startTimestamp],
    ["duration", session.durationSec],
    ["sensor", session.sensor],
    ["uuid", session.uuid],
  ];

  return (
    <div
      className="session-card"
      style={{ borderLeftColor: STAGE_COLORS[session.stage] }}
    >
      <div className="session-card-header">
        <div className="session-card-id">
          <span className="session-field-key">session</span>
          <code className="session-id">{session.id}</code>
        </div>
        <dl className="session-fields session-envelope">
          {envelope.map(([name, value]) =>
            value === null || value === undefined || value === "" ? null : (
              <Field key={name} name={name} value={value} />
            )
          )}
        </dl>
        <div className="session-eventid-index">
          {session.groups.map((group) => (
            <span className="session-eventid-chip" key={group.eventid}>
              <code>{group.eventid}</code>
              <b>{group.events.length}</b>
            </span>
          ))}
        </div>
      </div>

      <div className="session-logs">
        {session.groups.map((group) => (
          <LogSection
            key={group.eventid}
            eventid={group.eventid}
            events={group.events}
            schemaFields={eventSchema[group.eventid]}
          />
        ))}
      </div>
    </div>
  );
};

export default SessionCard;
