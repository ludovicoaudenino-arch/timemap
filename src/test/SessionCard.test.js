// d3 ships untranspiled ESM and jest's transformIgnorePatterns skips
// node_modules; utilities.js only needs one locale helper from it.
jest.mock("d3", () => ({ timeFormatDefaultLocale: () => {} }));

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

import SessionCard from "../components/controls/SessionCard";
import { validateDomain } from "../reducers/validate/validators";
import { buildSessions } from "../common/cowrie";

import rawEvents from "../../public/events.json";
import rawAssociations from "../../public/associations.json";

const domain = validateDomain(
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

const sessions = buildSessions(domain.events);
const malwareSession = sessions.find((s) => s.outcome === "malware");

describe("SessionCard", () => {
  it("renders every real session without blowing up", () => {
    sessions.forEach((session) => {
      const { unmount } = render(<SessionCard session={session} />);
      unmount();
    });
  });

  it("summarises a malware session in its badges", () => {
    render(<SessionCard session={malwareSession} />);
    expect(screen.getByText(malwareSession.id)).toBeInTheDocument();
    // the IP shows both in the header and in the connection phase
    expect(screen.getAllByText(malwareSession.srcIp).length).toBeGreaterThan(0);
    expect(screen.getByText("MALWARE RILEVATO")).toBeInTheDocument();
    expect(
      screen.getByText(`${malwareSession.stats.eventCount} eventi`)
    ).toBeInTheDocument();
  });

  it("opens on the phases that carry the finding", () => {
    const { container } = render(<SessionCard session={malwareSession} />);
    // commands and payloads are expanded by default for a malware session
    expect(container.querySelector(".session-command")).toBeInTheDocument();
    expect(container.querySelector(".session-shasum").textContent).toBe(
      malwareSession.phases.payloads.find((p) => p.shasum).shasum
    );
  });

  it("shows the full command text of the intruder", () => {
    const { container } = render(<SessionCard session={malwareSession} />);
    const expected = malwareSession.phases.commands[0].command;
    expect(container.querySelector(".session-command").textContent).toBe(
      expected
    );
  });

  it("lists credentials with success markers once auth is expanded", () => {
    const authSession = sessions.find(
      (s) => s.stats.loginSuccess > 0 && s.stats.loginAttempts > 0
    );
    const { container } = render(<SessionCard session={authSession} />);
    // a session with no commands or payloads opens on auth already
    if (!container.querySelector(".session-cred")) {
      fireEvent.click(screen.getByText(/Autenticazione/));
    }

    const creds = container.querySelectorAll(".session-cred");
    expect(creds.length).toBeGreaterThan(0);
    const successful = authSession.phases.auth.find((a) => a.success);
    expect(
      container.querySelector(".session-row.success .session-cred").textContent
    ).toBe(`${successful.username}:${successful.password}`);
  });

  it("truncates long credential lists behind a toggle", () => {
    const bruteForce = sessions
      .filter((s) => s.stats.loginAttempts > 8)
      .sort((a, b) => b.stats.loginAttempts - a.stats.loginAttempts)[0];
    if (!bruteForce) return; // this export may not contain one

    const { container } = render(<SessionCard session={bruteForce} />);
    if (!container.querySelector(".session-cred")) {
      fireEvent.click(screen.getByText(/Autenticazione/));
    }
    expect(container.querySelectorAll(".session-cred").length).toBeLessThan(
      bruteForce.stats.loginAttempts
    );

    fireEvent.click(screen.getByText(/mostra tutti/));
    expect(container.querySelectorAll(".session-cred").length).toBe(
      bruteForce.stats.loginAttempts
    );
  });

  it("collapses a phase when its header is clicked", () => {
    const { container } = render(<SessionCard session={malwareSession} />);
    expect(container.querySelector(".session-command")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Comandi/));
    expect(container.querySelector(".session-command")).not.toBeInTheDocument();
  });
});
