import { createSelector } from "reselect";
import { buildSessions, OUTCOME_ORDER } from "../common/cowrie";
import { eventMatchesAssociations } from "./helpers";

const getEvents = (state) => state.domain.events;
const getActiveFilters = (state) => state.app.associations.filters;
const getActiveCategories = (state) => state.app.associations.categories;
const getTimeRange = (state) => state.app.timeline.range;
const getSelectedSessionId = (state) => state.app.selectedSessionId;

/**
 * All attack sessions, built from the *complete* event domain rather than
 * from `selectEvents`. Filtering happens at session level below, so that an
 * expanded session always tells the whole story of the attack even when the
 * user has narrowed the view down to, say, the Malware category.
 */
export const selectSessions = createSelector([getEvents], buildSessions);

/**
 * Sessions to draw on the timeline: those overlapping the visible time range
 * and containing at least one event that survives the active filters.
 */
export const selectVisibleSessions = createSelector(
  [selectSessions, getActiveFilters, getActiveCategories, getTimeRange],
  (sessions, activeFilters, activeCategories, timeRange) => {
    const [from, to] = timeRange;
    return sessions.filter((session) => {
      // interval intersection: a session is visible if any part of it is
      const overlapsRange =
        session.endDatetime >= from && session.startDatetime <= to;
      if (!overlapsRange) return false;
      if (activeFilters.length === 0 && activeCategories.length === 0)
        return true;
      return session.events.some((event) =>
        eventMatchesAssociations(event, activeFilters, activeCategories)
      );
    });
  }
);

/**
 * Visible sessions in paint order: least severe first, so that malware and
 * interactive sessions end up drawn on top of the recon noise.
 */
export const selectSessionsInPaintOrder = createSelector(
  [selectVisibleSessions],
  (sessions) =>
    [...sessions].sort(
      (a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome]
    )
);

/**
 * Lightweight projection of the visible sessions for the timeline SVG.
 * `Timeline` hashes its whole props object on every update (drag, zoom), so
 * the full session graph — 119 sessions each holding its events — must not
 * travel through those props: it roughly doubles the per-frame hashing cost.
 * The atom only needs what it draws and tooltips; selection is resolved by id.
 */
export const selectSessionMarkers = createSelector(
  [selectSessionsInPaintOrder],
  (sessions) =>
    sessions.map((session) => ({
      id: session.id,
      startDatetime: session.startDatetime,
      outcome: session.outcome,
      eventCount: session.stats.eventCount,
      loginAttempts: session.stats.loginAttempts,
      srcIp: session.srcIp,
      location: session.location,
      durationSec: session.durationSec,
      // Markers.js reads these to decide circle-vs-bar for the selection ring
      latitude: session.latitude,
      longitude: session.longitude,
    }))
);

/** The selected session, in the same lightweight shape as the markers. */
export const selectSelectedSessionMarker = createSelector(
  [selectSessionMarkers, getSelectedSessionId],
  (markers, selectedSessionId) => {
    if (!selectedSessionId) return null;
    return markers.find((m) => m.id === selectedSessionId) || null;
  }
);

export const selectSessionCountInTimeRange = createSelector(
  [selectVisibleSessions],
  (sessions) => sessions.length
);

export const selectSelectedSession = createSelector(
  [selectSessions, getSelectedSessionId],
  (sessions, selectedSessionId) => {
    if (!selectedSessionId) return null;
    return sessions.find((session) => session.id === selectedSessionId) || null;
  }
);
