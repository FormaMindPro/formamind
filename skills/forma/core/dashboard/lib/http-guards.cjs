'use strict';
/**
 * Host/Origin/path guards for the local dashboard server - pure functions over a port, no state.
 * Each answers one way a browser can be driven at a loopback server by a page it never asked about.
 */

const path = require('path');

// The names this server's own addresses use. Anything else in Host is somebody else's name.
const selfHosts = (port) => ['127.0.0.1', 'localhost', '[::1]'].map((h) => h + ':' + port);
const selfOrigins = (port) => selfHosts(port).map((h) => 'http://' + h);

/**
 * DNS rebinding: a page whose hostname re-points at 127.0.0.1 becomes "same-origin" in the browser's
 * eyes, but the rebound hostname still carries itself in Host - a Host this server never printed is
 * refused. A missing Host header is refused too: every browser sends one.
 */
function hostAllowed(hostHeader, port) {
  if (!hostHeader) return false;
  return selfHosts(port).includes(hostHeader.toLowerCase());
}

/**
 * Browsers set Origin on every cross-site POST, while curl and tests send none - so an absent header
 * passes (same-origin GET included), and a present one must be one of this server's own origins.
 */
function originAllowed(originHeader, port) {
  if (!originHeader) return true;
  return selfOrigins(port).includes(originHeader.toLowerCase());
}

/**
 * `path.join` normalizes `..` away, so a string prefix lets a sibling directory through
 * (`/graphs/../../living-old/x` starts with the base string once joined); the relative form
 * has no such edge - a path outside the base always starts with `..` or is absolute.
 */
function pathUnder(base, filePath) {
  const rel = path.relative(base, filePath);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = { selfHosts, selfOrigins, hostAllowed, originAllowed, pathUnder };
