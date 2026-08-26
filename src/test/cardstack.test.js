// d3 ships untranspiled ESM and jest's transformIgnorePatterns skips
// node_modules; utilities.js only needs one locale helper from it.
jest.mock("d3", () => ({ timeFormatDefaultLocale: () => {} }));

import React from "react";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Provider } from "react-redux";

import store from "../store/";
import CardStack from "../components/controls/CardStack";
import { updateDomain, updateSelected } from "../actions";
import { selectEventCountInTimeRange } from "../selectors";
import { sessionsToEvents } from "../common/cowrie";

import bySession from "../../public/sample_1000.json";
import associations from "../../public/associations.json";
import eventSchema from "../../public/cowrie_event_schema.json";

/**
 * The whole selection path, as the map and the timeline drive it: a domain
 * event is one Cowrie session, selecting it opens that session's raw log.
 */
beforeAll(() => {
  const domain = {
    events: sessionsToEvents(bySession),
    associations: JSON.parse(JSON.stringify(associations)),
    sites: [],
    sources: {},
    regions: [],
    shapes: [],
    eventSchema,
    notifications: [],
  };
  store.dispatch(updateDomain({ domain, features: store.getState().features }));
});

const events = () => store.getState().domain.events;
const bySessionId = (id) => events().find((e) => e.civId === id);

function renderStack() {
  return render(
    <Provider store={store}>
      <CardStack onToggleCardstack={() => {}} />
    </Provider>
  );
}

describe("the configured defaults", () => {
  it("open on a time range that actually contains the sessions", () => {
    // config.js sets app.timeline.range; the sample spans 2026-04-06 to
    // 2026-06-06, so an unchanged range must not open on an empty timeline.
    expect(selectEventCountInTimeRange(store.getState())).toBeGreaterThan(0);
  });
});

describe("the card stack in session mode", () => {
  it("shows nothing until a session is selected", () => {
    store.dispatch(updateSelected([]));
    const { container } = renderStack();
    expect(container.querySelector(".session-card")).not.toBeInTheDocument();
  });

  it("opens the selected session as raw Cowrie log", () => {
    const event = bySessionId("d51b6dc387a5");
    store.dispatch(updateSelected([event]));
    const { container } = renderStack();

    expect(screen.getByText("1 attack session")).toBeInTheDocument();

    const card = container.querySelector(".session-card");
    expect(within(card).getByText("d51b6dc387a5")).toBeInTheDocument();

    const headings = [...card.querySelectorAll(".session-log-eventid")].map(
      (n) => n.textContent
    );
    expect(headings).toEqual(event.session.eventIds);
  });

  it("orders each section's fields with the fetched Cowrie schema", () => {
    const event = bySessionId("d51b6dc387a5");
    store.dispatch(updateSelected([event]));
    const { container } = renderStack();

    const connect = [...container.querySelectorAll(".session-log")].find(
      (node) =>
        node.querySelector(".session-log-eventid").textContent ===
        "cowrie.session.connect"
    );
    const keys = [...connect.querySelectorAll(".session-field-key")].map(
      (n) => n.textContent
    );

    // cowrie_event_schema.json declares src_port, dst_ip, dst_port in that order
    expect(keys).toEqual([
      "timestamp",
      "src_port",
      "dst_ip",
      "dst_port",
      "message",
    ]);
  });

  it("ignores a leftover timeline projection in the selection", () => {
    // `selectTimelineEvents` hands the timeline events without their session;
    // one slipping into `app.selected` must not take the card stack down.
    const event = bySessionId("d51b6dc387a5");
    const { session, ...projection } = event;
    store.dispatch(updateSelected([projection, event]));
    const { container } = renderStack();

    expect(container.querySelectorAll(".session-card")).toHaveLength(1);
    expect(screen.getByText("1 attack session")).toBeInTheDocument();
  });

  it("stacks one card per session when a map location holds several", () => {
    const two = events().slice(0, 2);
    store.dispatch(updateSelected(two));
    const { container } = renderStack();

    expect(screen.getByText("2 attack sessions")).toBeInTheDocument();
    expect(container.querySelectorAll(".session-card")).toHaveLength(2);
    two.forEach((event) =>
      expect(screen.getByText(event.civId)).toBeInTheDocument()
    );
  });
});
