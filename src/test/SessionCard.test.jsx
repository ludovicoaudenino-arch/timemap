// d3 ships untranspiled ESM and jest's transformIgnorePatterns skips
// node_modules; utilities.js only needs one locale helper from it.
jest.mock("d3", () => ({ timeFormatDefaultLocale: () => {} }));

import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import SessionCard, { orderFields } from "../components/controls/SessionCard";
import { buildSession } from "../common/cowrie";

import bySession from "../../public/sample_1000.json";
import eventSchema from "../../public/cowrie_event_schema.json";

const sessionIds = Object.keys(bySession);
const sessions = sessionIds.map((id) => buildSession(id, bySession[id]));

const withEventId = (eventid) =>
  sessions.find((s) => s.eventIds.includes(eventid));

function renderSession(session) {
  return render(<SessionCard session={session} eventSchema={eventSchema} />);
}

/** The rendered section for one eventid, as a queryable scope. */
function section(container, eventid) {
  const heading = [...container.querySelectorAll(".session-log-eventid")].find(
    (node) => node.textContent === eventid
  );
  return heading ? heading.closest(".session-log") : null;
}

describe("orderFields", () => {
  it("puts timestamp first and Cowrie's own message last", () => {
    const event = {
      eventid: "cowrie.session.connect",
      src_port: 1,
      message: "m",
      timestamp: "t",
      dst_ip: "d",
    };
    const { fields } = orderFields(event, eventSchema[event.eventid]);

    expect(fields[0]).toBe("timestamp");
    expect(fields[fields.length - 1]).toBe("message");
  });

  it("drops the envelope fields the card header already prints", () => {
    const event = {
      eventid: "cowrie.login.failed",
      session: "s",
      sensor: "honeypot",
      uuid: "u",
      src_ip: "1.2.3.4",
      protocol: "ssh",
      username: "root",
      timestamp: "t",
    };
    const { fields } = orderFields(event, eventSchema[event.eventid]);

    expect(fields).toEqual(["timestamp", "username"]);
  });

  it("reports the schema fields the log did not carry", () => {
    const event = { eventid: "cowrie.login.failed", username: "root" };
    const { absent } = orderFields(event, eventSchema[event.eventid]);

    expect(absent).toEqual(
      expect.arrayContaining(["password", "fingerprint", "key", "type"])
    );
  });

  it("still prints fields the log carries but the schema does not declare", () => {
    const event = { eventid: "cowrie.session.closed", duration: "0.0" };
    const { fields } = orderFields(event, eventSchema[event.eventid]);

    expect(fields).toContain("duration");
  });
});

describe("SessionCard", () => {
  it("renders 200 real sessions without blowing up", () => {
    sessions.slice(0, 200).forEach((session) => {
      const { unmount } = renderSession(session);
      unmount();
    });
  });

  it("heads the card with the session envelope", () => {
    const session = withEventId("cowrie.session.file_download");
    const { container } = renderSession(session);
    const header = container.querySelector(".session-card-header");

    expect(within(header).getByText(session.id)).toBeInTheDocument();
    expect(within(header).getByText(session.srcIp)).toBeInTheDocument();
    expect(within(header).getByText(session.location)).toBeInTheDocument();
    expect(
      within(header).getByText(session.startTimestamp)
    ).toBeInTheDocument();
    expect(within(header).getByText("src_ip")).toBeInTheDocument();
    expect(within(header).getByText("duration")).toBeInTheDocument();
  });

  it("opens one section per eventid, titled with that eventid", () => {
    const session = withEventId("cowrie.session.file_download");
    const { container } = renderSession(session);

    const headings = [
      ...container.querySelectorAll(".session-log-eventid"),
    ].map((n) => n.textContent);
    expect(headings).toEqual(session.eventIds);
  });

  it("prints cowrie.session.connect with its exact tuple", () => {
    const session = withEventId("cowrie.session.connect");
    const raw = session.events.find(
      (e) => e.eventid === "cowrie.session.connect"
    );
    const { container } = renderSession(session);
    const scope = within(section(container, "cowrie.session.connect"));

    expect(scope.getByText("src_port")).toBeInTheDocument();
    expect(scope.getByText(String(raw.src_port))).toBeInTheDocument();
    expect(scope.getByText(raw.dst_ip)).toBeInTheDocument();
    expect(scope.getByText(String(raw.dst_port))).toBeInTheDocument();
  });

  it("prints the key exchange parameters as logged", () => {
    const session = withEventId("cowrie.client.kex");
    const raw = session.events.find((e) => e.eventid === "cowrie.client.kex");
    const { container } = renderSession(session);
    const scope = within(section(container, "cowrie.client.kex"));

    ["hassh", "kexAlgs", "keyAlgs", "encCS", "macCS", "compCS"].forEach(
      (field) => expect(scope.getByText(field)).toBeInTheDocument()
    );
    expect(scope.getByText(raw.hassh)).toBeInTheDocument();
    // arrays are listed element by element, not collapsed into prose
    raw.kexAlgs.forEach((alg) =>
      expect(scope.getAllByText(alg).length).toBeGreaterThan(0)
    );
  });

  it("lists every login attempt with its own credentials", () => {
    const session = sessions.find((s) => {
      const group = s.groups.find((g) => g.eventid === "cowrie.login.failed");
      return group && group.events.length > 1;
    });
    const attempts = session.groups.find(
      (g) => g.eventid === "cowrie.login.failed"
    ).events;
    const { container } = renderSession(session);
    const scope = within(section(container, "cowrie.login.failed"));

    attempts.forEach((attempt) => {
      expect(scope.getByText(attempt.timestamp)).toBeInTheDocument();
      if (attempt.username) {
        expect(scope.getAllByText(attempt.username).length).toBeGreaterThan(0);
      }
    });
  });

  it("prints command input verbatim, however long", () => {
    const session = sessions.find((s) =>
      s.events.some(
        (e) => e.eventid === "cowrie.command.input" && e.input.length > 200
      )
    );
    const raw = session.events.find(
      (e) => e.eventid === "cowrie.command.input" && e.input.length > 200
    );
    const { container } = renderSession(session);
    const scope = within(section(container, "cowrie.command.input"));

    expect(scope.getAllByText(raw.input).length).toBeGreaterThan(0);
  });

  it("prints the download hash, outfile and destination", () => {
    const session = withEventId("cowrie.session.file_download");
    const raw = session.events.find(
      (e) => e.eventid === "cowrie.session.file_download"
    );
    const { container } = renderSession(session);
    const scope = within(section(container, "cowrie.session.file_download"));

    expect(scope.getByText("shasum")).toBeInTheDocument();
    expect(scope.getAllByText(raw.shasum).length).toBeGreaterThan(0);
    expect(scope.getAllByText(raw.outfile).length).toBeGreaterThan(0);
    if (raw.destfile) {
      expect(scope.getAllByText(raw.destfile).length).toBeGreaterThan(0);
    }
  });

  it("prints the tty log record", () => {
    const session = withEventId("cowrie.log.closed");
    const raw = session.events.find((e) => e.eventid === "cowrie.log.closed");
    const { container } = renderSession(session);
    const scope = within(section(container, "cowrie.log.closed"));

    expect(scope.getByText("ttylog")).toBeInTheDocument();
    expect(scope.getAllByText(raw.ttylog).length).toBeGreaterThan(0);
    expect(scope.getByText(String(raw.size))).toBeInTheDocument();
  });

  it("closes the session with its exact duration", () => {
    const session = withEventId("cowrie.session.closed");
    const raw = session.events.find(
      (e) => e.eventid === "cowrie.session.closed"
    );
    const { container } = renderSession(session);
    const scope = within(section(container, "cowrie.session.closed"));

    expect(scope.getByText("duration")).toBeInTheDocument();
    expect(scope.getByText(String(raw.duration))).toBeInTheDocument();
  });

  it("collapses and reopens a section on click", () => {
    const session = withEventId("cowrie.session.connect");
    const { container } = renderSession(session);
    const scope = section(container, "cowrie.session.connect");
    const head = scope.querySelector(".session-log-head");

    expect(scope.querySelector(".session-log-body")).toBeInTheDocument();
    fireEvent.click(head);
    expect(scope.querySelector(".session-log-body")).not.toBeInTheDocument();
    fireEvent.click(head);
    expect(scope.querySelector(".session-log-body")).toBeInTheDocument();
  });

  it("labels rows with Cowrie field names only", () => {
    const session = withEventId("cowrie.session.file_download");
    const { container } = renderSession(session);
    const schemaFields = new Set(
      Object.values(eventSchema).flatMap((fields) => fields)
    );
    // fields the export carries that the schema does not declare
    const extra = new Set(["duration", "filename", "location", "id"]);

    [...container.querySelectorAll(".session-log-entry .session-field-key")]
      .map((node) => node.textContent)
      .forEach((name) => {
        expect(schemaFields.has(name) || extra.has(name)).toBe(true);
      });
  });

  it("renders nothing at all without a session", () => {
    const { container } = render(<SessionCard session={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
