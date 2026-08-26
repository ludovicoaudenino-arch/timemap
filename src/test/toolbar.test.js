// d3 ships untranspiled ESM and jest's transformIgnorePatterns skips
// node_modules; utilities.js only needs one locale helper from it.
jest.mock("d3", () => ({ timeFormatDefaultLocale: () => {} }));

import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Provider } from "react-redux";

import store from "../store/";
import Toolbar from "../components/Toolbar";
import { setInitialCategories, updateDomain } from "../actions";
import { sessionsToEvents } from "../common/cowrie";
import { getActiveCategories, getActiveFilters } from "../selectors";

import bySession from "../../public/sample_1000.json";
import associations from "../../public/associations.json";

const CATEGORY_TAB = "Categories";
const FILTER_TAB = "Filters";

const methods = {
  onTitle: jest.fn(),
  onSelectFilter: (filters) =>
    store.dispatch({
      type: "TOGGLE_ASSOCIATIONS",
      association: "filters",
      value: filters,
    }),
  onCategoryFilter: (categories) =>
    store.dispatch({
      type: "TOGGLE_ASSOCIATIONS",
      association: "categories",
      value: categories,
    }),
  onShapeFilter: jest.fn(),
  onSelectNarrative: jest.fn(),
};

/** Load the real Cowrie export through the real domain pipeline. */
beforeAll(() => {
  const domain = {
    events: sessionsToEvents(bySession),
    associations: JSON.parse(JSON.stringify(associations)),
    sites: [],
    sources: {},
    regions: [],
    shapes: [],
    notifications: [],
  };
  store.dispatch(updateDomain({ domain, features: store.getState().features }));
  store.dispatch(setInitialCategories(domain.associations));
});

function renderToolbar() {
  return render(
    <Provider store={store}>
      <Toolbar isNarrative={false} methods={methods} />
    </Provider>
  );
}

function openTab(name) {
  fireEvent.click(screen.getByText(name));
}

describe("the toolbar", () => {
  it("offers both a category and a filter tab", () => {
    renderToolbar();
    expect(screen.getByText(CATEGORY_TAB)).toBeInTheDocument();
    expect(screen.getByText(FILTER_TAB)).toBeInTheDocument();
  });

  it("lists the timeline tracks by their Cowrie eventid", () => {
    const { container } = renderToolbar();
    openTab(CATEGORY_TAB);
    const panel = container.querySelector(".react-innertabpanel");

    [
      "cowrie.session.connect",
      "cowrie.login.failed",
      "cowrie.login.success",
      "cowrie.command.input",
      "cowrie.direct-tcpip.request",
      "cowrie.session.file_download",
    ].forEach((eventid) =>
      expect(within(panel).getByText(eventid)).toBeInTheDocument()
    );
  });

  it("starts with every category active and turns one off on click", () => {
    renderToolbar();
    openTab(CATEGORY_TAB);

    expect(getActiveCategories(store.getState())).toContain(
      "cowrie.login.success"
    );
    fireEvent.click(
      screen
        .getByText("cowrie.login.success")
        .parentElement.querySelector("button")
    );
    expect(getActiveCategories(store.getState())).not.toContain(
      "cowrie.login.success"
    );
  });

  it("lays the filters out as the Cowrie eventid namespace tree", () => {
    const { container } = renderToolbar();
    openTab(FILTER_TAB);
    const panel = container.querySelector(".react-innertabpanel");

    // top level: the segment after `cowrie.`
    ["session", "client", "login", "command", "direct-tcpip", "log"].forEach(
      (segment) => expect(within(panel).getByText(segment)).toBeInTheDocument()
    );
    // leaves: the segment after that. Leaf names repeat across namespaces
    // (`session/connect` and `reversedns/connect`), so assert on unique ones.
    ["kex", "file_download", "file_upload", "chpasswd", "ja4h"].forEach(
      (leaf) => expect(within(panel).getByText(leaf)).toBeInTheDocument()
    );
  });

  it("activates a filter by its full Cowrie path", () => {
    renderToolbar();
    openTab(FILTER_TAB);

    expect(getActiveFilters(store.getState())).toEqual([]);
    const row = screen.getByText("file_upload").closest(".filter-filter");
    fireEvent.click(within(row).getByRole("button"));

    expect(getActiveFilters(store.getState())).toContain("session/file_upload");
  });
});
