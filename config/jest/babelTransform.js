"use strict";

const babelJest = require("babel-jest");

// The root babel config lives in package.json, which Babel treats as a
// file-relative config: it never reaches files under node_modules. d3 v7 and
// its sub-packages ship untranspiled ESM, so jest needs the preset applied to
// them too (see `transformIgnorePatterns`, which lets those packages through).
// Declaring the preset here — the way create-react-app does — makes the
// transform independent of where the file being compiled lives.
module.exports = babelJest.createTransformer({
  presets: [
    // `runtime: "automatic"` mirrors config/webpack.config.js, so components
    // that use JSX without importing React compile the same way under test.
    [require.resolve("babel-preset-react-app"), { runtime: "automatic" }],
  ],
  babelrc: false,
  configFile: false,
});
