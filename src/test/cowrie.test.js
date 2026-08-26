// d3 ships untranspiled ESM and jest's transformIgnorePatterns skips
// node_modules; utilities.js only needs one locale helper from it.
jest.mock("d3", () => ({ timeFormatDefaultLocale: () => {} }));

import {
  buildSession,
  deriveStage,
  isSessionKeyedExport,
  sessionsToEvents,
  STAGE_ID_PREFIX,
} from "../common/cowrie";
import { validateDomain } from "../reducers/validate/validators";
import { selectEvents, selectTimelineEvents } from "../selectors";
import { ASSOCIATION_MODES } from "../common/constants";

import bySession from "../../public/sample_1000.json";
import rawAssociations from "../../public/associations.json";

/** Run the real export through the real validation pipeline. */
function loadDomain() {
  return validateDomain(
    {
      events: sessionsToEvents(bySession),
      associations: JSON.parse(JSON.stringify(rawAssociations)),
      sites: [],
      sources: {},
      regions: [],
      shapes: [],
      notifications: [],
    },
    {}
  );
}

function makeState(domain, appOverrides = {}) {
  const datetimes = domain.events.map((e) => e.datetime);
  return {
    domain,
    app: {
      associations: { filters: [], categories: [] },
      shapes: [],
      timeline: {
        range: [
          new Date(Math.min(...datetimes) - 1000),
          new Date(Math.max(...datetimes) + 1000),
        ],
      },
      ...appOverrides,
    },
    ui: { eventRadius: 8 },
    features: {},
  };
}

const domain = loadDomain();
const categoryTitles = rawAssociations
  .filter((a) => a.mode === ASSOCIATION_MODES.CATEGORY)
  .map((a) => a.title);

describe("isSessionKeyedExport", () => {
  it("recognises the Cowrie export and rejects a plain events array", () => {
    expect(isSessionKeyedExport(bySession)).toBe(true);
    expect(isSessionKeyedExport([{ id: "a" }])).toBe(false);
    expect(isSessionKeyedExport(null)).toBe(false);
  });
});

describe("buildSession", () => {
  const record = bySession["d51b6dc387a5"];

  it("keeps every raw event, grouped by eventid", () => {
    const session = buildSession("d51b6dc387a5", record);
    const grouped = session.groups.reduce((n, g) => n + g.events.length, 0);

    expect(session.events).toHaveLength(record.events.length);
    expect(grouped).toBe(record.events.length);
    expect(new Set(session.eventIds).size).toBe(session.groups.length);
  });

  it("lays the groups out in Cowrie handshake-to-teardown order", () => {
    const session = buildSession("d51b6dc387a5", record);
    expect(session.eventIds[0]).toBe("cowrie.session.connect");
    expect(session.eventIds.indexOf("cowrie.login.success")).toBeLessThan(
      session.eventIds.indexOf("cowrie.command.input")
    );
  });

  it("takes the envelope and the connect tuple off the raw events", () => {
    const session = buildSession("d51b6dc387a5", record);
    const connect = record.events.find(
      (e) => e.eventid === "cowrie.session.connect"
    );

    expect(session.srcIp).toBe(record.src_ip);
    expect(session.srcPort).toBe(connect.src_port);
    expect(session.dstIp).toBe(connect.dst_ip);
    expect(session.dstPort).toBe(connect.dst_port);
    expect(session.protocol).toBe(connect.protocol);
    expect(session.sensor).toBe(connect.sensor);
  });

  it("reads duration off cowrie.session.closed, string or float", () => {
    // "0.1690380573272705" as a float, "0.0" as a string: both are numbers here
    Object.keys(bySession)
      .slice(0, 200)
      .forEach((id) => {
        const session = buildSession(id, bySession[id]);
        const closed = bySession[id].events.find(
          (e) => e.eventid === "cowrie.session.closed"
        );
        if (closed) expect(session.durationSec).toBe(Number(closed.duration));
      });
  });

  it("drops a record with no dated event rather than emitting a broken one", () => {
    expect(buildSession("x", { events: [] })).toBeNull();
    expect(buildSession("x", {})).toBeNull();
    expect(
      buildSession("x", { events: [{ eventid: "a", timestamp: "nope" }] })
    ).toBeNull();
  });
});

describe("deriveStage", () => {
  const cases = [
    [["cowrie.session.connect"], "cowrie.session.connect"],
    [["cowrie.session.connect", "cowrie.login.failed"], "cowrie.login.failed"],
    [["cowrie.login.failed", "cowrie.login.success"], "cowrie.login.success"],
    [["cowrie.login.success", "cowrie.command.failed"], "cowrie.command.input"],
    [
      ["cowrie.command.input", "cowrie.direct-tcpip.data"],
      "cowrie.direct-tcpip.request",
    ],
    [
      ["cowrie.command.input", "cowrie.session.file_upload"],
      "cowrie.session.file_download",
    ],
  ];

  it.each(cases)("%j lands on %s", (eventIds, expected) => {
    expect(deriveStage(eventIds)).toBe(expected);
  });

  it("names every stage after a category declared in associations.json", () => {
    const stages = new Set(
      Object.keys(bySession).map((id) => buildSession(id, bySession[id]).stage)
    );
    stages.forEach((stage) => expect(categoryTitles).toContain(stage));
  });
});

describe("sessionsToEvents", () => {
  it("emits exactly one domain event per session, in time order", () => {
    const events = sessionsToEvents(bySession);
    expect(events).toHaveLength(Object.keys(bySession).length);
    expect(new Set(events.map((e) => e.civId)).size).toBe(events.length);

    const times = events.map((e) => e.session.startDatetime.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("associates a session with its stage and with each eventid it contains", () => {
    const events = sessionsToEvents(bySession);
    const event = events.find((e) => e.civId === "d51b6dc387a5");

    expect(event.associations).toContain(`${STAGE_ID_PREFIX}${event.category}`);
    event.session.eventIds.forEach((eventid) =>
      expect(event.associations).toContain(eventid)
    );
  });
});

describe("the validated domain", () => {
  it("keeps every session and reports no discarded events", () => {
    expect(domain.events).toHaveLength(Object.keys(bySession).length);
    const discarded = domain.notifications.filter((n) =>
      n.message.includes("invalid events")
    );
    expect(discarded).toEqual([]);
  });

  it("resolves each session's associations into real association objects", () => {
    const event = domain.events.find((e) => e.civId === "d51b6dc387a5");
    const modes = event.associations.map((a) => a.mode);

    expect(modes.filter((m) => m === ASSOCIATION_MODES.CATEGORY)).toHaveLength(
      1
    );
    expect(
      modes.filter((m) => m === ASSOCIATION_MODES.FILTER).length
    ).toBeGreaterThan(0);
  });

  it("gives every session a coordinate the map can project", () => {
    domain.events.forEach((event) => {
      expect(Number.isNaN(parseFloat(event.latitude))).toBe(false);
      expect(Number.isNaN(parseFloat(event.longitude))).toBe(false);
    });
  });

  it("parses date and time back to the session's own start second", () => {
    // `date`/`time` follow DATE_FMT/TIME_FMT, which stop at whole seconds; the
    // card reads `startTimestamp` when microseconds matter.
    domain.events.forEach((event) => {
      const start = event.session.startDatetime.getTime();
      expect(event.datetime.getTime()).toBe(start - (start % 1000));
    });
  });
});

describe("selectTimelineEvents", () => {
  const state = makeState(domain);

  it("drops the session payload the timeline never draws", () => {
    selectTimelineEvents(state).forEach((event) => {
      if (!event) return;
      expect(event.session).toBeUndefined();
      expect(event.category).toBeTruthy();
      expect(event.associations.length).toBeGreaterThan(0);
    });
  });

  it("keeps ids that resolve back to the full domain event", () => {
    // Layout.handleSelect looks the clicked projection up by id so the card
    // stack gets the session back
    selectTimelineEvents(state)
      .filter(Boolean)
      .forEach((projection) => {
        const full = domain.events.find((e) => e.id === projection.id);
        expect(full).toBeDefined();
        expect(full.session).toBeDefined();
      });
  });
});

describe("categories and filters", () => {
  const count = (state) => selectEvents(state).filter(Boolean).length;

  it("shows every session when nothing is toggled", () => {
    expect(count(makeState(domain))).toBe(domain.events.length);
  });

  it("narrows to one track when a single category is active", () => {
    const state = makeState(domain, {
      associations: {
        filters: [],
        categories: ["cowrie.session.file_download"],
      },
      shapes: [],
    });
    const shown = selectEvents(state).filter(Boolean);

    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(domain.events.length);
    shown.forEach((event) =>
      expect(event.category).toBe("cowrie.session.file_download")
    );
  });

  it("keeps only the sessions containing an eventid when its filter is active", () => {
    const state = makeState(domain, {
      associations: { filters: ["login/success"], categories: [] },
      shapes: [],
    });
    const shown = selectEvents(state).filter(Boolean);

    const expected = domain.events.filter((e) =>
      e.session.eventIds.includes("cowrie.login.success")
    );
    expect(shown).toHaveLength(expected.length);
    expect(expected.length).toBeGreaterThan(0);
  });

  it("keeps the two filter dimensions independent", () => {
    // a track that by construction never carries cowrie.session.file_download
    const state = makeState(domain, {
      associations: {
        filters: ["session/file_download"],
        categories: ["cowrie.login.failed"],
      },
      shapes: [],
    });
    expect(selectEvents(state).filter(Boolean)).toHaveLength(0);
  });
});
