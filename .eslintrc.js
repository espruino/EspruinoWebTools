module.exports = {
  extends: ["eslint:recommended"],
  env: {
    browser: true,
    node: true,
    es6: true,
  },

  parserOptions: {
    ecmaVersion: 8,
  },

  globals: {
  },

  rules: {
    "no-undef": "warn",
    "no-extra-semi": "warn",
    "no-redeclare": "warn",
    "no-var": "off",
    "no-unused-vars": ["warn", { args: "none" }],
    "no-control-regex": "off",
    "brace-style": ["warn", "1tbs", { "allowSingleLine": true }]
  },
};
