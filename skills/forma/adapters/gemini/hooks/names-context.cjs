#!/usr/bin/env node
'use strict';

/**
 * names-context.cjs - the PreInvocation reminder of names for Antigravity (AGENTS.md section 1, prohibition 20).
 * Intercepts the human's prompt (or recent transcript user input); when protocol codes are mentioned,
 * resolves human names via .forma/i18n/names.cjs and injects them via systemMessage.
 *
 * Fail-open: any error or invalid input outputs { injectSteps: [] } and exits 0.
 */

const fs = require('node:fs');
const path = require('node:path');

function findRoot(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, '.forma', 'i18n', 'names.cjs'))) return dir;
    if (fs.existsSync(path.join(dir, 'skills', 'forma', 'core', 'i18n', 'names.cjs'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  dir = path.resolve(__dirname);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.forma', 'i18n', 'names.cjs'))) return dir;
    if (fs.existsSync(path.join(dir, 'skills', 'forma', 'core', 'i18n', 'names.cjs'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.resolve(start || process.cwd());
}

function loadModules(root) {
  const p1 = path.join(root, '.forma', 'i18n');
  if (fs.existsSync(path.join(p1, 'names.cjs')) && fs.existsSync(path.join(p1, 'index.cjs'))) {
    return { names: require(path.join(p1, 'names.cjs')), i18n: require(path.join(p1, 'index.cjs')) };
  }
  const p2 = path.join(root, 'skills', 'forma', 'core', 'i18n');
  if (fs.existsSync(path.join(p2, 'names.cjs')) && fs.existsSync(path.join(p2, 'index.cjs'))) {
    return { names: require(path.join(p2, 'names.cjs')), i18n: require(path.join(p2, 'index.cjs')) };
  }
  return null;
}

function main() {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    inputData += chunk;
  });

  process.stdin.on('end', () => {
    let steps = [];

    try {
      if (inputData.trim()) {
        const payload = JSON.parse(inputData);
        let candidateDir = process.cwd();
        if (Array.isArray(payload.workspacePaths) && payload.workspacePaths.length > 0) {
          candidateDir = payload.workspacePaths[0];
        }
        const root = findRoot(candidateDir);

        let textToCheck = '';
        if (typeof payload.prompt === 'string') {
          textToCheck += payload.prompt + ' ';
        }
        if (typeof payload.userPrompt === 'string') {
          textToCheck += payload.userPrompt + ' ';
        }

        if (!textToCheck.trim() && payload.transcriptPath && fs.existsSync(payload.transcriptPath)) {
          try {
            const lines = fs.readFileSync(payload.transcriptPath, 'utf8').trim().split('\n');
            const lastLines = lines.slice(-5);
            for (const line of lastLines) {
              try {
                const obj = JSON.parse(line);
                if (obj.source === 'USER_EXPLICIT' || obj.type === 'USER_INPUT') {
                  if (typeof obj.content === 'string') {
                    textToCheck += obj.content + ' ';
                  }
                }
              } catch {}
            }
          } catch {}
        }

        textToCheck = textToCheck.trim();
        if (textToCheck) {
          const mod = loadModules(root);
          if (mod) {
            const { names, i18n } = mod;
            const lang = i18n.projectLang(root);
            const hits = names.scan(root, textToCheck, lang);
            if (Array.isArray(hits) && hits.length > 0) {
              const tag = i18n.message('names.tag', {}, lang);
              const header = i18n.message('names.header', {}, lang);
              const lines = hits.slice(0, 8).map((h) => '- ' + h.render);
              const block = tag + ' ' + header + '\n' + lines.join('\n');
              steps = [{ systemMessage: block }];
            }
          }
        }
      }
    } catch {
      // Fail-open: on any error, return empty injectSteps
      steps = [];
    }

    process.stdout.write(JSON.stringify({ injectSteps: steps }) + '\n');
    process.exit(0);
  });
}

try {
  main();
} catch {
  process.stdout.write(JSON.stringify({ injectSteps: [] }) + '\n');
  process.exit(0);
}
