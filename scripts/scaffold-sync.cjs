#!/usr/bin/env node
'use strict';

// scaffold-sync — verifies parity and synchronizes localized scaffold packages with the canonical English base.
// Rules and constraints:
//   - Prohibition 16: clean zone, no project-specific traces.
//   - Prohibition 18: English-only in code and messages.
//   - Compares templates/_scaffold/<lang> against templates/_scaffold/en for missing files, anchor parity, and heading trees.

const fs = require('node:fs');
const path = require('node:path');

/** Walks directory recursively and returns array of relative paths with normalized forward slashes. */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else results.push(full);
  }
  return results;
}

/** Extracts all machine anchors from markdown text, e.g. <!-- k:name --> */
function extractAnchors(text) {
  const matches = [...text.matchAll(/<!--\s*k:([a-zA-Z0-9_.-]+)\s*-->/g)];
  return matches.map((m) => ({ key: m[1], index: m.index }));
}

/** Extracts all markdown headings (#, ##, ###, etc.) with level, title, and line number. */
function extractHeadings(text) {
  const lines = text.split(/\r?\n/);
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      headings.push({ level: match[1].length, title: match[2].trim(), line: i + 1 });
    }
  }
  return headings;
}

/** Compares a single target scaffold file against canonical English base file. */
function compareFiles(enPath, targetPath, rel) {
  const discrepancies = [];
  if (!fs.existsSync(targetPath)) {
    discrepancies.push({
      rel,
      type: 'missing-file',
      expected: 'file exists',
      found: 'file missing',
    });
    return discrepancies;
  }

  const enContent = fs.readFileSync(enPath, 'utf8');
  const targetContent = fs.readFileSync(targetPath, 'utf8');

  if (rel.endsWith('.md')) {
    // 1. Anchors parity
    const enAnchors = extractAnchors(enContent);
    const targetAnchors = extractAnchors(targetContent);
    const enKeys = enAnchors.map((a) => a.key);
    const targetKeys = targetAnchors.map((a) => a.key);

    for (const k of enKeys) {
      if (!targetKeys.includes(k)) {
        discrepancies.push({
          rel,
          type: 'missing-anchor',
          expected: `anchor <!-- k:${k} -->`,
          found: 'anchor missing',
        });
      }
    }
    for (const k of targetKeys) {
      if (!enKeys.includes(k)) {
        discrepancies.push({
          rel,
          type: 'extra-anchor',
          expected: 'no extraneous anchor',
          found: `unexpected anchor <!-- k:${k} -->`,
        });
      }
    }

    // 2. Headings parity (counts by level 1..4)
    const enHeadings = extractHeadings(enContent);
    const targetHeadings = extractHeadings(targetContent);
    for (let lvl = 1; lvl <= 4; lvl++) {
      const enCount = enHeadings.filter((h) => h.level === lvl).length;
      const targetCount = targetHeadings.filter((h) => h.level === lvl).length;
      if (enCount !== targetCount) {
        discrepancies.push({
          rel,
          type: 'heading-count-mismatch',
          expected: `${lvl > 1 ? '#'.repeat(lvl) : '#'} heading count: ${enCount}`,
          found: `heading count: ${targetCount}`,
        });
      }
    }
  } else if (rel.endsWith('.json')) {
    // 3. JSON key structure parity
    try {
      const enJson = JSON.parse(enContent);
      const targetJson = JSON.parse(targetContent);
      const diffKeys = (a, b, prefix = '') => {
        if (typeof a !== 'object' || a === null) return;
        for (const k of Object.keys(a)) {
          const fullKey = prefix ? `${prefix}.${k}` : k;
          if (!(k in b)) {
            discrepancies.push({
              rel,
              type: 'missing-json-key',
              expected: `key ${fullKey}`,
              found: 'key missing',
            });
          } else if (typeof a[k] === 'object' && a[k] !== null && typeof b[k] === 'object' && b[k] !== null && !Array.isArray(a[k])) {
            diffKeys(a[k], b[k], fullKey);
          }
        }
      };
      diffKeys(enJson, targetJson);
    } catch (e) {
      discrepancies.push({
        rel,
        type: 'invalid-json',
        expected: 'valid JSON',
        found: `parse error: ${e.message}`,
      });
    }
  }

  return discrepancies;
}

/** Compares a target language directory against the canonical English scaffold directory. */
function checkLanguage(scaffoldRoot, targetLang) {
  const enDir = path.join(scaffoldRoot, 'en');
  const targetDir = path.join(scaffoldRoot, targetLang);
  const discrepancies = [];

  if (!fs.existsSync(enDir)) {
    throw new Error(`Canonical English scaffold not found at ${enDir}`);
  }
  if (!fs.existsSync(targetDir)) {
    discrepancies.push({
      rel: targetLang,
      type: 'missing-language-dir',
      expected: `directory ${targetDir} exists`,
      found: 'directory missing',
    });
    return { lang: targetLang, pass: false, discrepancies };
  }

  const enFiles = walk(enDir).map((f) => path.relative(enDir, f).replace(/\\/g, '/')).sort();
  const targetFiles = walk(targetDir).map((f) => path.relative(targetDir, f).replace(/\\/g, '/')).sort();

  // Check missing files and compare contents
  for (const rel of enFiles) {
    if (!targetFiles.includes(rel)) {
      discrepancies.push({
        rel,
        type: 'missing-file',
        expected: `file templates/_scaffold/${targetLang}/${rel}`,
        found: 'file missing',
      });
    } else {
      const diffs = compareFiles(path.join(enDir, rel), path.join(targetDir, rel), rel);
      discrepancies.push(...diffs);
    }
  }

  // Check unexpected extraneous files in target
  for (const rel of targetFiles) {
    if (!enFiles.includes(rel)) {
      discrepancies.push({
        rel,
        type: 'extra-file',
        expected: 'file present in en canonical scaffold',
        found: `unexpected file in ${targetLang}: ${rel}`,
      });
    }
  }

  return {
    lang: targetLang,
    pass: discrepancies.length === 0,
    filesChecked: enFiles.length,
    discrepancies,
  };
}

/** Lists available target languages (directories under scaffoldRoot other than 'en'). */
function listTargetLanguages(scaffoldRoot) {
  if (!fs.existsSync(scaffoldRoot)) return [];
  return fs.readdirSync(scaffoldRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'en' && !e.name.startsWith('.') && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
}

/** CLI entry point. */
function main(argv = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..');
  let scaffoldRoot = path.join(root, 'templates', '_scaffold');
  let targetLang = null;
  let jsonOutput = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scaffold-dir' && argv[i + 1]) scaffoldRoot = path.resolve(argv[++i]);
    else if (a === '--lang' && argv[i + 1]) targetLang = argv[++i];
    else if (a === '--json') jsonOutput = true;
    else if (a === '--help' || a === '-h') {
      console.log(`scaffold-sync — verify parity and drift across localized scaffold packages

Usage:
  node scripts/scaffold-sync.cjs [--check] [--lang <code>] [--scaffold-dir <dir>] [--json]

Options:
  --check              Verify all target languages against canonical 'en' (default)
  --lang <code>        Check specific language (e.g. 'ru')
  --scaffold-dir <dir> Override templates/_scaffold directory
  --json               Output machine-readable JSON
`);
      return 0;
    }
  }

  const langs = targetLang ? [targetLang] : listTargetLanguages(scaffoldRoot);
  if (langs.length === 0) {
    if (jsonOutput) console.log(JSON.stringify({ pass: true, langs: [], message: 'No target languages found' }));
    else console.log('scaffold-sync: no target languages found to compare against en');
    return 0;
  }

  const results = langs.map((l) => checkLanguage(scaffoldRoot, l));
  const allPass = results.every((r) => r.pass);
  const totalDiscrepancies = results.reduce((acc, r) => acc + r.discrepancies.length, 0);

  if (jsonOutput) {
    console.log(JSON.stringify({ pass: allPass, totalDiscrepancies, results }, null, 2));
    return allPass ? 0 : 1;
  }

  if (allPass) {
    console.log(`scaffold-sync: all target language(s) [${langs.join(', ')}] in 100% parity with en (${results[0]?.filesChecked || 0} files checked)`);
    return 0;
  }

  console.error(`scaffold-sync: found ${totalDiscrepancies} discrepancy(ies) across ${langs.length} language(s):`);
  for (const r of results) {
    if (r.pass) continue;
    console.error(`  [${r.lang}] (${r.discrepancies.length} issue(s)):`);
    for (const d of r.discrepancies) {
      console.error(`    - ${d.rel} [${d.type}]: expected: ${d.expected} — found: ${d.found}`);
    }
  }
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  walk,
  extractAnchors,
  extractHeadings,
  compareFiles,
  checkLanguage,
  listTargetLanguages,
  main,
};
