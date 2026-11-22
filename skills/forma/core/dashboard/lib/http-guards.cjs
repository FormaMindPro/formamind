'use strict';
/**
 * Host/Origin/path guards for the local dashboard server - pure functions over a port, no state.
 * Each answers one way a browser can be driven at a loopback server by a page it never asked about.
 */

const path = require('path');
const crypto = require('crypto');

// The names this server's own addresses use. Anything else in Host is somebody else's name.
const selfHosts = (port) => ['127.0.0.1', 'localhost', '[::1]'].map((h) => h + ':' + port);
const selfOrigins = (port) => selfHosts(port).map((h) => 'http://' + h);

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** A bind address that stays on this machine (`FORMA_DASH_HOST` is the only one chosen by hand). */
function isLoopbackHost(host) {
  return LOOPBACK_NAMES.has(String(host || '').toLowerCase());
}

/** Node's socket address for loopback: 127.x, ::1, or the IPv4-mapped ::ffff:127.x. */
function isLoopbackAddr(addr) {
  const a = String(addr || '').toLowerCase();
  return a === '::1' || a.startsWith('127.') || a.startsWith('::ffff:127.');
}

/**
 * A missing token means loopback mode (no token exists there). A present one is compared in
 * constant time: a length leak is as good as a prefix leak to a patient client.
 */
function tokenOk(got, token) {
  if (!token) return true;
  if (typeof got !== 'string' || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The token a request carries: `?t=` or the cookie `GET /` turns it into. */
function tokenOf(req, cookieName) {
  const fromQuery = new URL(req.url, 'http://x').searchParams.get('t');
  if (fromQuery) return fromQuery;
  for (const part of String(req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== cookieName) continue;
    try { return decodeURIComponent(part.slice(at + 1).trim()); } catch { return ''; }
  }
  return '';
}

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

module.exports = {
  selfHosts, selfOrigins, hostAllowed, originAllowed, pathUnder,
  isLoopbackHost, isLoopbackAddr, tokenOk, tokenOf,
};
