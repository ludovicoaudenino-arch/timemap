// d3 ships untranspiled ESM and jest's transformIgnorePatterns skips
// node_modules; utilities.js only needs one locale helper from it.
jest.mock("d3", () => ({ timeFormatDefaultLocale: () => {} }));

import { validateDomain } from "../reducers/validate/validators";
import { buildSessions, parseCowrieEvent } from "../common/cowrie";
import {
  selectVisibleSessions,
  selectSessionsInPaintOrder,
  selectSelectedSession,
} from "../selectors/sessions";

import rawEvents from "../../public/events.json";
import rawAssociations from "../../public/associations.json";

/** Run the real export through the real validation pipeline. */
function loadDomain() {
  return validateDomain(
    {
      events: JSON.parse(JSON.stringify(rawEvents)),
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

function makeState(domain, overrides = {}) {
  const datetimes = domain.events.map((e) => e.datetime);
  return {
    domain,
    app: {
      selectedSessionId: null,
      associations: { filters: [], categories: [] },
      timeline: {
        range: [
          new Date(Math.min(...datetimes) - 1000),
          new Date(Math.max(...datetimes) + 1000),
        ],
      },
      ...overrides,
    },
  };
}

const domain = loadDomain();

describe("parseCowrieEvent", () => {
  it("pulls credentials out of the prose", () => {
    const parsed = parseCowrieEvent({
      description:
        "Tentativo di login fallito con credenziali 'admin':'admin' da 128.199.103.139",
      comments: "Credenziali tentate: admin:admin | Session ID: 554f134a88e0",
      civId: "554f134a88e0",
    });
    expect(parsed.username).toBe("admin");
    expect(parsed.password).toBe("admin");
    expect(parsed.srcIp).toBe("128.199.103.139");
    expect(parsed.sessionId).toBe("554f134a88e0");
  });

  it("keeps a command verbatim even when it contains pipes and colons", () => {
    const command = 'cat /etc/passwd | grep root; echo "a:b"';
    const parsed = parseCowrieEvent({
      description: `Comando eseguito dal bot: ${command}`,
      comments: `Comando: ${command} | Session ID: abc123`,
    });
    expect(parsed.command).toBe(command);
  });

  it("reads ports, duration, client version and shasum", () => {
    expect(
      parseCowrieEvent({ comments: "Porte: 61000 -> 2222 | Session ID: x" })
    ).toMatchObject({ srcPort: 61000, dstPort: 2222 });
    expect(
      parseCowrieEvent({ comments: "Durata: 12.4 secondi | Session ID: x" })
        .durationSec
    ).toBe(12.4);
    expect(
      parseCowrieEvent({ comments: "Client SSH: SSH-2.0-Go | Session ID: x" })
        .clientVersion
    ).toBe("SSH-2.0-Go");
    expect(
      parseCowrieEvent({
        comments:
          "URL:  | Salvato in: var/lib/cowrie/downloads/8a68d1c0 | Session ID: x",
      }).shasum
    ).toBe("8a68d1c0");
  });

  it("returns nulls instead of throwing on an empty event", () => {
    const parsed = parseCowrieEvent({});
    expect(parsed.username).toBeNull();
    expect(parsed.srcIp).toBeNull();
    expect(parsed.command).toBeNull();
  });
});

describe("buildSessions on the real export", () => {
  const sessions = buildSessions(domain.events);

  it("groups every event into a session, losing none", () => {
    const covered = sessions.reduce((acc, s) => acc + s.events.length, 0);
    expect(covered).toBe(domain.events.length);
    expect(sessions.length).toBeLessThan(domain.events.length);
  });

  it("gives every session a source IP and a location", () => {
    expect(sessions.filter((s) => !s.srcIp)).toHaveLength(0);
    expect(sessions.filter((s) => !s.location)).toHaveLength(0);
  });

  it("returns sessions sorted by start time", () => {
    const starts = sessions.map((s) => s.startDatetime.getTime());
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("parses every credential attempt and every command", () => {
    const auth = sessions.flatMap((s) => s.phases.auth);
    const commands = sessions.flatMap((s) => s.phases.commands);
    expect(auth.length).toBeGreaterThan(0);
    expect(auth.filter((a) => !a.username)).toHaveLength(0);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.filter((c) => !c.command)).toHaveLength(0);
  });

  it("flags sessions that dropped a payload as malware", () => {
    const malware = sessions.filter((s) => s.outcome === "malware");
    expect(malware.length).toBeGreaterThan(0);
    malware.forEach((s) => {
      expect(s.stats.payloadCount).toBeGreaterThan(0);
      expect(s.stats.hasMalware).toBe(true);
    });
    const withDownload = sessions.filter((s) =>
      s.phases.payloads.some((p) => p.direction === "download")
    );
    withDownload.forEach((s) => {
      expect(s.outcome).toBe("malware");
      expect(
        s.phases.payloads.some((p) => p.direction === "download" && p.shasum)
      ).toBe(true);
    });
  });

  it("keeps every event's phase accounted for", () => {
    sessions.forEach((s) => {
      const { phases } = s;
      const placed =
        phases.handshake.length +
        phases.fingerprint.length +
        phases.auth.length +
        phases.commands.length +
        phases.payloads.length +
        phases.other.length +
        (phases.closure ? 1 : 0);
      expect(placed).toBe(s.events.length);
    });
  });
});

describe("session selectors", () => {
  it("shows every session when nothing is filtered", () => {
    const state = makeState(domain);
    expect(selectVisibleSessions(state)).toHaveLength(
      buildSessions(domain.events).length
    );
  });

  it("keeps a filtered session's full chronology intact", () => {
    const state = makeState(domain, {
      associations: { filters: [], categories: ["Malware"] },
    });
    const visible = selectVisibleSessions(state);
    expect(visible.length).toBeGreaterThan(0);
    // narrowed to Malware, but the sessions still carry their logins/commands
    visible.forEach((session) => {
      expect(session.stats.payloadCount).toBeGreaterThan(0);
      expect(session.events.length).toBeGreaterThan(session.stats.payloadCount);
    });
  });

  it("drops sessions that fall outside the time range", () => {
    const all = selectVisibleSessions(makeState(domain));
    const cutoff = all[Math.floor(all.length / 2)].startDatetime;
    const state = makeState(domain, {
      timeline: {
        range: [cutoff, new Date(cutoff.getTime() + 60 * 60 * 1000)],
      },
    });
    const visible = selectVisibleSessions(state);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(all.length);
  });

  it("paints the most severe sessions last so they stay visible", () => {
    const ordered = selectSessionsInPaintOrder(makeState(domain));
    const rank = { recon: 0, authenticated: 1, interactive: 2, malware: 3 };
    const ranks = ordered.map((s) => rank[s.outcome]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("resolves the selected session by id", () => {
    const some = buildSessions(domain.events)[0];
    const state = makeState(domain, { selectedSessionId: some.id });
    expect(selectSelectedSession(state).id).toBe(some.id);
    expect(selectSelectedSession(makeState(domain))).toBeNull();
  });
});
