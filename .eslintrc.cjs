/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "prefer-let"],
  root: true,

  // Report unused `eslint-disable` comments.
  reportUnusedDisableDirectives: true,
  // Tell ESLint not to ignore dot-files, which are ignored by default.
  ignorePatterns: ["!.*.js", "!.*.mjs", "!.*.cjs"],

  rules: {
    "prefer-const": "off",
    "prefer-let/prefer-let": "error",
  },
};
