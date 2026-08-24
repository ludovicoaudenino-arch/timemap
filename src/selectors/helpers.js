/**
 * Some handy helpers
 */
import { ASSOCIATION_MODES } from "../common/constants";
import { createFilterPathString } from "../common/utilities";

/**
 * Given an event and a time range,
 * returns true/false if the event falls within timeRange
 */
export function isTimeRangedIn(event, timeRange) {
  const eventTime = event.datetime;
  return timeRange[0] < eventTime && eventTime < timeRange[1];
}

/**
 * Whether an event survives the currently active filters, i.e. it belongs to
 * at least one active FILTER association (or no filter is active at all).
 */
export function isEventInActiveFilters(event, activeFilters) {
  if (activeFilters.length === 0) return true;
  if (!event.associations) return false;
  return event.associations
    .filter((a) => a.mode === ASSOCIATION_MODES.FILTER)
    .some((association) =>
      activeFilters.includes(createFilterPathString(association))
    );
}

/**
 * Whether an event survives the currently active categories, i.e. it belongs
 * to at least one active CATEGORY association (or no category is active).
 */
export function isEventInActiveCategories(event, activeCategories) {
  if (activeCategories.length === 0) return true;
  if (!event.associations) return false;
  return event.associations
    .filter((a) => a.mode === ASSOCIATION_MODES.CATEGORY)
    .some((association) => activeCategories.includes(association.title));
}

/**
 * Whether an event survives both association-based filters at once. Shared by
 * the per-event and the per-session selectors so the two cannot diverge.
 */
export function eventMatchesAssociations(
  event,
  activeFilters,
  activeCategories
) {
  return (
    isEventInActiveFilters(event, activeFilters) &&
    isEventInActiveCategories(event, activeCategories)
  );
}

/**
 * Shuffles array in place. ES6 version
 * @param {Array} a items An array containing the items.
 * https://stackoverflow.com/questions/6274339/how-can-i-shuffle-an-array
 */
export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
