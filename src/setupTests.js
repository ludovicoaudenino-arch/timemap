import "@testing-library/jest-dom";
import { vi } from "vitest";

// Make jest available globally as alias to Vitest's vi
globalThis.jest = vi;

// Load appConfig (from CONFIG env or config.js) and proxy process.env so nested objects work
const configFile = process.env.CONFIG || "./config.js";
let appConfig = {};
try {
  // eslint-disable-next-line
  appConfig = require("../" + configFile);
} catch (e) {
  try {
    appConfig = require("./config.js");
  } catch (err) {
    // fallback empty
  }
}

const envProxy = new Proxy(process.env, {
  get(target, prop) {
    if (prop in appConfig) {
      return appConfig[prop];
    }
    return target[prop];
  },
});

Object.defineProperty(globalThis, "process", {
  value: new Proxy(process, {
    get(target, prop) {
      if (prop === "env") return envProxy;
      return target[prop];
    },
  }),
  configurable: true,
});

// Mock window.matchMedia if in jsdom
if (typeof window !== "undefined") {
  window.matchMedia =
    window.matchMedia ||
    function () {
      return {
        matches: false,
        addListener: function () {},
        removeListener: function () {},
      };
    };
}
