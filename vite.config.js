import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Load the active config (defaults to config.js)
const configFile = process.env.CONFIG || "./config.js";
const appConfig = require(path.resolve(__dirname, configFile));

// Build definitions for process.env (supports both destructuring and direct property access)
const envDefines = {
  "process.env.NODE_ENV": JSON.stringify(
    process.env.NODE_ENV || "development"
  ),
  "process.env": JSON.stringify(appConfig),
};
for (const key in appConfig) {
  envDefines[`process.env.${key}`] = JSON.stringify(appConfig[key]);
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^~/, replacement: "" }],
  },
  server: {
    port: 8080,
    open: false,
  },
  define: envDefines,
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/setupTests.js"],
  },
});
