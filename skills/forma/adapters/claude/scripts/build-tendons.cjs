#!/usr/bin/env node
// The tendons: the layer of links between the three graphs.
//
// The skeleton - the engine (`.forma/manual/`), the muscles - the project (`project/`), the tendons - the experience
// (`.devtool/features/done/`). A tendon fastens by two ends: to the rule the lesson
// put to work, and to the matter where it happened. Without the bone end a lesson is
// a diary, without the muscle end - a theory; both degeneracies are useless for transfer.
//
// The fastenings are not extracted by a model: they are already written in the cards as prose. Here
// only names are matched, so a run costs nothing and repeats as many
// times as one likes.
//
// We hold to the cards themselves, not to the experience graph: the graph is one of the images
// of the cards, it may lag, while the cards on disk are always fresh.
//
//   node .claude/scripts/build-tendons.cjs [--out <file>]
//
// Printed labels come from the core dictionary: English key in code, ru value as data.
'use strict';

const fs = require('fs');
const path = require('path');
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');
const { makeCli } = require('../../.forma/dashboard/lib/cli.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const MANUAL = path.join(ROOT, '.forma/living', 'graphs', 'manual', 'graph.json');
const PROJECT = path.join(ROOT, '.forma/living', 'graphs', 'project', 'graph.json');
// The engine graph - an optional input:
// no file, or no description/capabilities in it - the "engine -> rule" section
// is simply empty, no reason to stop the cards' tendons.
const ENGINE = path.join(ROOT, '.forma/living', 'graphs', 'engine', 'graph.json');
const CARDS_DIR = path.join(ROOT, '.devtool', 'features', 'done');
const LAW = path.join(ROOT, 'AGENTS.md');
// The same law in ru: the engine graph was built from this corpus, and the node names
// were taken from it too - so the matching must be against it, not against the English original.
const LAW_RU = path.join(ROOT, '.forma/manual', 'PROTOCOL.md');

const OUT = makeCli().value('out', path.join(ROOT, '.forma/living', 'graphs', 'tendons.json'));

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// --- the law's prohibitions -------------------------------------------------------------
// A card writes "prohibition 7", while the graph node is named by the full wording. The numbers
// come from the law itself, not from memory: the list there is numbered and that is its address.
function prohibitions() {
  const out = new Map();   // a number -> a wording
  let text, marker;
  try { text = fs.readFileSync(LAW_RU, 'utf8'); marker = '\u041d\u0435\u043b\u044c\u0437\u044f'; }
  catch { text = null; }
  if (!text || !text.includes(marker)) {
    try { text = fs.readFileSync(LAW, 'utf8'); marker = '## 5. Prohibitions'; }
    catch { return out; }
  }
  const block = text.split(marker)[1];
  if (!block) return out;
  for (const line of block.split(/\r?\n/)) {
    const m = /^(\d+)\.\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    out.set(Number(m[1]), m[2]);
    if (Number(m[1]) === 15) break;
  }
  return out;
}

// --- the node name's synonyms --------------------------------------------------------
// A literal match undercounts by half: the node is named "Kitting (Kit)", while
// the card writes `Kit`. The synonyms are derived from the name itself, not invented.
function aliases(label) {
  const out = new Set();
  const en = /\(([A-Z][A-Za-z]+)\)/.exec(label);
  if (en) {
    out.add('`' + en[1] + '`');        // how the cards name the node
    out.add(en[1].toLowerCase() + '.md');  // and how its role file is named
  }
  // The name without the bracketed qualifier: "The cycle cache (§9)" -> "The cycle cache".
  const bare = label.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (bare && bare !== label && bare.length >= 6) out.add(bare);
  return [...out];
}

// The whole word, not a piece of another word. \b boundaries do not work for ru
// (they count Cyrillic as non-letters), so the neighbouring characters are examined directly.
const LETTER = /[\p{L}\p{N}_]/u;
function mentions(text, needle) {
  if (!needle || needle.length < 4) return 0;
  let n = 0, i = 0;
  while ((i = text.indexOf(needle, i)) !== -1) {
    const before = text[i - 1] || ' ';
    const after = text[i + needle.length] || ' ';
    const openWord = LETTER.test(needle[0]);
    const closeWord = LETTER.test(needle[needle.length - 1]);
    if ((!openWord || !LETTER.test(before)) && (!closeWord || !LETTER.test(after))) n++;
    i += needle.length;
  }
  return n;
}

function loadCards() {
  return fs.readdirSync(CARDS_DIR).filter((f) => f.endsWith('.md'))
    .map((f) => ({
      file: '.devtool/features/done/' + f,
      code: (/^(card-\d+)/.exec(f) || [])[1] || f.replace(/\.md$/, ''),
      text: fs.readFileSync(path.join(CARDS_DIR, f), 'utf8'),
    }));
}

// The project's files named in a card - the muscle end. A project graph node
// is bound to its source_file, and by it we hold on.
function projectFileIndex(project) {
  const projectFiles = new Map();
  for (const n of project.nodes) {
    if (!n.source_file) continue;
    if (!projectFiles.has(n.source_file)) projectFiles.set(n.source_file, []);
    projectFiles.get(n.source_file).push(n.id);
  }
  return projectFiles;
}

// The engine graph's concepts: a node's name and its synonyms found in the cards' text.
function matchBones(manual, cards, toBone, boneHits) {
  for (const node of manual.nodes) {
    const label = node.label || '';
    if (label.length < 6) continue;
    const needles = [label, ...aliases(label)];
    for (const c of cards) {
      let weight = 0;
      const via = [];
      for (const nd of needles) {
        const k = mentions(c.text, nd);
        if (k) { weight += k; via.push(nd); }
      }
      if (weight) {
        toBone.push({ card: c.code, file: c.file, node: node.id, label, weight, via });
        boneHits.set(node.id, (boneHits.get(node.id) || 0) + weight);
      }
    }
  }
}

// A prohibition - a bone of its own, not anyone's node. Picking an owner among the graph's
// concepts by common words gave plausible garbage: prohibition 8 hung on "Intent
// is kitted by the human", prohibition 14 - on "The same tier does not mean one
// agent". A confident wrong link is worse than its absence. A prohibition has a number and
// a wording; that is enough to be a bone by itself.
function matchProhibitions(proh, cards, toBone, boneHits) {
  for (const [num, wording] of proh) {
    const needle = msg('tendons.zapret_needle', { num });
    const id = msg('tendons.zapret_id', { num });
    for (const c of cards) {
      const k = mentions(c.text.toLowerCase(), needle);
      if (!k) continue;
      toBone.push({ card: c.code, file: c.file, node: id,
                    label: msg('tendons.prohibition_label', { num, wording }),
                    weight: k, via: [needle], prohibition: num });
      boneHits.set(id, (boneHits.get(id) || 0) + k);
    }
  }
}

// --- engine -> rule: "implements the rule" (by the node's description, not by the code) -----------------
// The matching text - the description+capabilities of a file node,
// not the source code: a match by meaning, the same places logic as matchBones/matchProhibitions,
// but the source - the engine's files, not the cards.
function engineFiles(engine) {
  if (!engine) return [];
  return engine.nodes.filter((n) => n.type === 'file' && (n.description || (n.capabilities && n.capabilities.length)));
}

function matchEngineBones(engine, manual, proh, toBoneEngine) {
  const files = engineFiles(engine);
  if (!files.length) return;
  for (const node of manual.nodes) {
    const label = node.label || '';
    if (label.length < 6) continue;
    const needles = [label, ...aliases(label)];
    for (const f of files) {
      const text = [f.description || '', ...(f.capabilities || [])].join(' ');
      let weight = 0;
      const via = [];
      for (const nd of needles) {
        const k = mentions(text, nd);
        if (k) { weight += k; via.push(nd); }
      }
      if (weight) toBoneEngine.push({ file: f.source_file, node: node.id, label, weight, via, relation: 'implements_rule' });
    }
  }
  for (const [num, wording] of proh) {
    const needle = msg('tendons.zapret_needle', { num });
    const id = msg('tendons.zapret_id', { num });
    for (const f of files) {
      const text = [f.description || '', ...(f.capabilities || [])].join(' ').toLowerCase();
      const k = mentions(text, needle);
      if (!k) continue;
      toBoneEngine.push({ file: f.source_file, node: id, label: msg('tendons.prohibition_label', { num, wording }),
                           weight: k, via: [needle], prohibition: num, relation: 'implements_rule' });
    }
  }
}

function matchMuscles(cards, projectFiles) {
  const toMuscle = [];
  for (const c of cards) {
    for (const [src, ids] of projectFiles) {
      if (!c.text.includes(src)) continue;
      toMuscle.push({ card: c.code, file: c.file, source_file: src, nodes: ids });
    }
    // A goal - also a muscle end, and it is named outright.
    for (const m of c.text.matchAll(/goal-(\d+)/g)) {
      toMuscle.push({ card: c.code, file: c.file, source_file: 'goal-' + m[1], nodes: [] });
    }
  }
  return toMuscle;
}

function countBothEnds(toBone, toMuscle) {
  const byCard = new Map();
  const ends = (card) => byCard.get(card) || byCard.set(card, { bone: 0, muscle: 0 }).get(card);
  for (const t of toBone) ends(t.card).bone++;
  for (const t of toMuscle) ends(t.card).muscle++;
  return [...byCard.values()].filter((v) => v.bone && v.muscle).length;
}

// How many different cards touched a rule is more honest than how many times it
// was named: one card mentioning `Kit` thirty times put it to work once.
function cardsPerRule(toBone) {
  const sets = new Map();
  for (const t of toBone) {
    if (!sets.has(t.node)) sets.set(t.node, new Set());
    sets.get(t.node).add(t.card);
  }
  return new Map([...sets].map(([id, set]) => [id, set.size]));
}

// The concepts are the law itself. The documents (AGENTS.md, PROJECT.md) are the addresses where
// it lies; mentioning them does not say the rule was put to work.
function wearTables(manual, toBone, boneHits) {
  const kind = new Map(manual.nodes.map((n) => [n.id, n.file_type]));
  const label = new Map(manual.nodes.map((n) => [n.id, n.label]));
  // The prohibitions - bones without a node in the graph: their name comes with the fastening itself.
  for (const t of toBone) if (!label.has(t.node)) label.set(t.node, t.label);
  const cardsPer = cardsPerRule(toBone);
  return {
    wear: [...boneHits.entries()]
      .filter(([id]) => kind.get(id) !== 'document')   // the prohibitions enter here too: they have no type
      .map(([id, weight]) => ({ node: id, label: label.get(id) || id, weight, cards: cardsPer.get(id) || 0 }))
      .sort((a, b) => b.cards - a.cards || b.weight - a.weight),
    addresses: [...boneHits.entries()]
      .filter(([id]) => kind.get(id) === 'document')
      .map(([id, weight]) => ({ node: id, label: label.get(id) || id, weight }))
      .sort((a, b) => b.weight - a.weight),
  };
}

// The final file: the three corpora, the counters, the rules' wear, the bare concepts and the fastenings themselves.
function assembleReport(src, links) {
  const { toBone, toMuscle, boneHits, toBoneEngine } = links;
  const { manual, project, cards, proh, engine } = src;
  const engFiles = engineFiles(engine);
  // A rule no card ever touched. That is not its verdict: either it is flawless, or it was never
  // tested, and what tells one from the other is whether the cards entered this area at all.
  // Only a concept counts as bare: a document is never "unworked".
  const bare = manual.nodes
    .filter((n) => n.file_type !== 'document' && !boneHits.has(n.id))
    .map((n) => n.label);
  return {
    built: new Date().toISOString(),
    corpora: {
      bone: { source: '.forma/manual/', nodes: manual.nodes.length },
      tendon: { source: '.devtool/features/done/', cards: cards.length },
      muscle: { source: 'project/', nodes: project.nodes.length },
    },
    totals: {
      toBone: toBone.length,
      toMuscle: toMuscle.length,
      cardsWithBothEnds: countBothEnds(toBone, toMuscle),
      cardsTotal: cards.length,
      bonesTouched: manual.nodes.filter((n) => n.file_type !== 'document' && boneHits.has(n.id)).length,
      prohibitionsTotal: proh.size,
      prohibitionsTouched: [...boneHits.keys()].filter((id) => new RegExp('^(?:' + require('../../.forma/i18n/index.cjs').alt('id.prohibition') + ')').test(id)).length,
      bonesBare: bare.length,
      conceptsTotal: manual.nodes.filter((n) => n.file_type !== 'document').length,
    },
    ...wearTables(manual, toBone, boneHits),
    bare,
    toBone,
    toMuscle,
    engine: {
      source: '.forma/living/graphs/engine/graph.json',
      filesTotal: engine ? engine.nodes.filter((n) => n.type === 'file').length : 0,
      filesWithMeaning: engFiles.length,
      rulesImplemented: new Set(toBoneEngine.map((t) => t.node)).size,
    },
    toBoneEngine,
  };
}

function printSummary(out) {
  const t = out.totals;
  console.log(msg('tendons.built', { file: path.relative(ROOT, OUT) }));
  console.log(msg('tendons.ends', { bone: t.toBone, muscle: t.toMuscle }));
  console.log(msg('tendons.cards_both_ends', { count: t.cardsWithBothEnds, total: out.corpora.tendon.cards }));
  console.log(msg('tendons.concepts_worked', { count: t.bonesTouched, total: t.conceptsTotal, bare: t.bonesBare }));
  console.log(msg('tendons.prohibitions_worked', { count: t.prohibitionsTouched, total: t.prohibitionsTotal }));
  console.log(msg('tendons.tightest') + out.wear.slice(0, 3).map((w) => w.label.slice(0, 32) + ' (' + w.cards + ')').join(' · '));
  const e = out.engine;
  if (e.filesWithMeaning) {
    console.log(msg('tendons.engine_rule_line', { files: e.filesWithMeaning, total: e.filesTotal, rules: e.rulesImplemented, edges: out.toBoneEngine.length }));
  } else {
    console.log(msg('tendons.engine_rule_empty'));
  }
}

function loadEngine() {
  try { return readJson(ENGINE); } catch { return null; }
}

function main() {
  const src = { manual: readJson(MANUAL), project: readJson(PROJECT), proh: prohibitions(), cards: loadCards(), engine: loadEngine() };
  const toBone = [];     // a card -> an engine rule
  const boneHits = new Map();
  matchBones(src.manual, src.cards, toBone, boneHits);
  matchProhibitions(src.proh, src.cards, toBone, boneHits);
  const toMuscle = matchMuscles(src.cards, projectFileIndex(src.project));   // a card -> a project file
  const toBoneEngine = [];   // an engine file -> a rule ("implements the rule")
  matchEngineBones(src.engine, src.manual, src.proh, toBoneEngine);

  const out = assembleReport(src, { toBone, toMuscle, boneHits, toBoneEngine });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  printSummary(out);
}

main();
