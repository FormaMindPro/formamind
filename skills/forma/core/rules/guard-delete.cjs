'use strict';

/**
 * guard-delete.cjs - a cross-platform module protecting protected files and directories.
 * Implements AGENTS.md §2 (Prohibition 1).
 * Checks delete/move commands (POSIX sh, Windows CMD, PowerShell)
 * and direct file references against .forma/rules/protected-paths.json.
 *
 * A one-time unlock by the code phrase ("Disable sensory", named in AGENTS.md §2):
 * the .delete-unlock marker in .forma/ or .agents/.state/ is consumed on the first hit.
 */

const fs = require('fs');
const path = require('path');
const i18n = require('../i18n/index.cjs');
const tr = (code, params) => i18n.message(code, params, 'ru');

const REGISTRY_PATH = path.join(__dirname, 'protected-paths.json');

function loadProtectedConfig() {
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    }
  } catch {}
  return {
    protectedRoots: ['.claude', '.agents', '.codex', '.devtool', '.forma', 'VARS'],
    protectedFiles: ['AGENTS.md', 'CLAUDE.md', 'PROJECT.md', 'GOAL.md', 'gemini-8.md', 'CODEX-8.md'],
    protectedPatterns: ['^\\.(claude|agents|codex|devtool|forma)(/|\\\\|$)', '(^|/|\\\\)AGENTS\\.md$'],
  };
}

const config = loadProtectedConfig();
const PATTERNS = config.protectedPatterns.map((p) => new RegExp(p, 'i'));

/**
 * Is the path protected
 */
function isProtectedPath(targetPath, root) {
  if (!targetPath) return false;
  let norm = targetPath.trim().replace(/^['"]|['"]$/g, '');
  if (root && path.isAbsolute(norm)) {
    norm = path.relative(root, norm);
  }
  norm = norm.replace(/\\/g, '/').replace(/^\.\//, '');

  // 1. The regex-pattern check
  for (const rx of PATTERNS) {
    if (rx.test(norm)) return true;
  }

  // 2. The roots-and-names check
  const parts = norm.split('/');
  const first = parts[0];
  const last = parts[parts.length - 1];

  for (const r of config.protectedRoots) {
    if (first.toLowerCase() === r.toLowerCase()) return true;
  }
  for (const f of config.protectedFiles) {
    if (last.toLowerCase() === f.toLowerCase()) return true;
  }

  // 3. Any file named GOAL.md
  if (/^goal\.md$/i.test(last)) return true;

  return false;
}

/**
 * The one-time unlock marker check (the code phrase of AGENTS.md §2)
 */
function getUnlockMarkerPaths(root) {
  const r = root || process.cwd();
  return [
    path.join(r, '.forma', '.delete-unlock'),
    path.join(r, '.agents', '.state', '.delete-unlock'),
    path.join(r, '.claude', 'hooks', '.delete-unlock'),
  ];
}

function isUnlockActive(root) {
  return getUnlockMarkerPaths(root).some((p) => fs.existsSync(p));
}

function unlockDeletion(root) {
  const p = path.join(root || process.cwd(), '.forma', '.delete-unlock');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'unlocked by phrase: ' + tr('guard.code_phrase') + '\n' + new Date().toISOString());
  return p;
}

function consumeUnlock(root) {
  let consumed = false;
  for (const p of getUnlockMarkerPaths(root)) {
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
        consumed = true;
      } catch {}
    }
  }
  return consumed;
}

/**
 * Parsing a command line for destructive operations
 */
function checkCommand(commandLine, root) {
  if (!commandLine || typeof commandLine !== 'string') return { blocked: false };

  const cmd = commandLine.trim();

  // Delete/move command regexes (they must not match hyphens inside names like card-move.cjs)
  const isDeleteCmd =
    /(^|[;&|\s])(rm|rmdir|unlink|del|erase|rd|Remove-Item|ri)(\.exe)?(\s|$)/i.test(cmd) ||
    /\bfind\s+.*-delete\b/i.test(cmd) ||
    /\bgit\s+clean\b/i.test(cmd) ||
    /(^|[;&|\s])(mv|move|Move-Item|mi)(\.exe)?(\s|$)/i.test(cmd);

  if (!isDeleteCmd) return { blocked: false };

  // Extracting candidate paths/tokens from the command
  const tokens = cmd
    .split(/[ \t;|&'"<>`()]+/)
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith('-') && !/^(rm|rmdir|unlink|del|erase|rd|Remove-Item|ri|mv|move|Move-Item|mi|find|git|clean|powershell|cmd|bash|sh|exec)$/i.test(t));

  for (const tok of tokens) {
    if (isProtectedPath(tok, root)) {
      if (consumeUnlock(root)) {
        return { blocked: false, unblockedByPhrase: true, target: tok };
      }
      return {
        blocked: true,
        target: tok,
        reason: tr('guard.reason_path', { tok }),
      };
    }

    // The dangerous recursive masks check (e.g. `.*`, `*`, `project/*`)
    if (/^(\.\*|\*|\.\/\*|\.\/|\.)$/.test(tok) && /\b(-r|-rf|--recursive|-recurse|\/s)\b/i.test(cmd)) {
      if (consumeUnlock(root)) {
        return { blocked: false, unblockedByPhrase: true, target: tok };
      }
      return {
        blocked: true,
        target: tok,
        reason: tr('guard.reason_recursive', { tok }),
      };
    }
  }

  // git clean without paths wipes the whole repository
  if (/\bgit\s+clean\b/i.test(cmd) && /\b(-[a-z]*x|-f|-d)\b/i.test(cmd)) {
    if (consumeUnlock(root)) {
      return { blocked: false, unblockedByPhrase: true, target: 'git clean' };
    }
    return {
      blocked: true,
      target: 'git clean',
      reason: tr('guard.reason_git_clean'),
    };
  }

  return { blocked: false };
}

/**
 * Handling in a PreToolUse hook context
 */
function runGuard({ toolName, args, root }) {
  if (!toolName) return { decision: 'allow' };

  if (toolName === 'run_command' && args && args.CommandLine) {
    const res = checkCommand(args.CommandLine, root);
    if (res.blocked) {
      return { decision: 'deny', reason: res.reason };
    }
  }

  return { decision: 'allow' };
}

module.exports = {
  isProtectedPath,
  isUnlockActive,
  unlockDeletion,
  consumeUnlock,
  checkCommand,
  runGuard,
  loadProtectedConfig,
};
