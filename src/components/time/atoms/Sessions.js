import React, { useState } from "react";
import { OUTCOME_COLORS, OUTCOME_LABELS } from "../../../common/cowrie";

const MIN_RADIUS_FACTOR = 0.8;
const MAX_RADIUS_FACTOR = 2.4;

/**
 * Radius grows with the number of events in the session, but logarithmically:
 * a one-event probe stays small, a 15-event intrusion stays on screen.
 */
export function getSessionRadius(session, eventRadius) {
  const scaled = eventRadius * (0.7 + 0.3 * Math.log(session.eventCount + 1));
  return Math.min(
    Math.max(scaled, eventRadius * MIN_RADIUS_FACTOR),
    eventRadius * MAX_RADIUS_FACTOR
  );
}

function describe(session) {
  const { srcIp, outcome, location, durationSec } = session;
  return [
    session.id,
    srcIp,
    location,
    `${session.eventCount} eventi`,
    `${session.loginAttempts} login`,
    `${Number(durationSec).toFixed(1)}s`,
    OUTCOME_LABELS[outcome].toUpperCase(),
  ]
    .filter(Boolean)
    .join(" · ");
}

const SessionMarker = ({ session, x, y, radius, colour, onSelect }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <g
      className={`timeline-session ${isHovered ? "hovered" : ""}`}
      onClick={() => onSelect(session.id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <title>{describe(session)}</title>
      <circle
        className="session-marker"
        cx={x}
        cy={y}
        r={radius}
        fill={colour}
        fillOpacity={isHovered ? 0.95 : 0.75}
      />
    </g>
  );
};

/**
 * Renders one marker per Cowrie attack session instead of one per event.
 * Sessions arrive already sorted by outcome severity, so the more dangerous
 * ones paint last and stay visible where markers overlap.
 */
const TimelineSessions = ({
  sessions,
  getDatetimeX,
  getY,
  onSelectSession,
  eventRadius,
}) => (
  <g clipPath="url(#clip)">
    {sessions.map((session) => (
      <SessionMarker
        key={session.id}
        session={session}
        x={getDatetimeX(session.startDatetime)}
        y={getY(session)}
        radius={getSessionRadius(session, eventRadius)}
        colour={OUTCOME_COLORS[session.outcome]}
        onSelect={onSelectSession}
      />
    ))}
  </g>
);

export default TimelineSessions;
