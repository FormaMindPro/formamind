'use strict';
// The dashboard's default port - one place. serve.js starts the free-port search from it,
// ensure-running.js falls back to it without server.json, the session-start hook takes it for a link.
// A module without side effects: require does not start a server.
const DEFAULT_PORT = 5050;

module.exports = { DEFAULT_PORT };
