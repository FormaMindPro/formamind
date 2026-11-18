'use strict';

/**
 * queue-digest - reports aging and size of queues (human acceptance in review vs Core closing in done)
 */

const fs = require('fs');
const path = require('path');
const { boardDir, zone } = require('../../dashboard/lib/card.cjs');

function parseTaskFields(text) {
  const m = String(text).replace(/\r\n/g, '\n').match(/^## Task\s*\n\s*(\d+ [·•] .+)$/m);
  if (!m) return null;
  const parts = m[1].split('|').map((s) => s.trim());
  return parts.length >= 5 ? parts : null;
}

function run({ root, info }) {
  if (!info) return [];
  const board = boardDir(root);
  if (!fs.existsSync(board)) return [];

  let humanCount = 0;
  let oldestMs = 0;
  const now = Date.now();

  for (const f of fs.readdirSync(board)) {
    if (!f.endsWith('.md')) continue;
    const p = path.join(board, f);
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    const statusMatch = text.match(/^status:\s*"?([^"\n]*)"?/m);
    if (!statusMatch || statusMatch[1].trim() !== 'review') continue;

    const fields = parseTaskFields(text);
    const nextField = fields ? fields[4] : '';
    const isHuman = /^human\b/i.test(nextField);

    if (isHuman) {
      humanCount++;
      const modMatch = text.match(/^modified:\s*"([^"]+)"/m);
      if (modMatch) {
        const modDate = new Date(modMatch[1]).getTime();
        const age = now - modDate;
        if (age > oldestMs) oldestMs = age;
      }
    }
  }

  if (humanCount > 0) {
    const days = Math.floor(oldestMs / (1000 * 60 * 60 * 24));
    const ageStr = days > 0 ? `oldest ${days}d` : 'today';
    info.push(`human queue: ${humanCount} card(s) awaiting acceptance (${ageStr})`);
  }

  return [];
}

module.exports = { id: 'queue-digest', since: '0.0.35', run };
