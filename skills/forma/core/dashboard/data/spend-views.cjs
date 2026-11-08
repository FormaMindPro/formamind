'use strict';

/**
 * The spend slices over a set of cards: by the nodes and "the economy" - what the work cost and what is known
 * about it at all. The functions are pure: the cards and the instruction weight come from outside, no files are read here.
 *
 * The main rule: next to every figure goes its COVERAGE. 26 attempts recorded over 138 cards - and without that
 * note the dashboard would confidently say "`Spec` is cheap" where the truth is that `Spec` barely recorded
 * anything. A number without coverage is more dangerous than the absence of a number: decisions are made by it.
 */

const { UNKNOWN } = require('../lib/engines.cjs');
const { NODE_ORDER } = require('./nodes.cjs');

const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

// ---- by the nodes -------------------------------------------------------------------------------

function newNodeAcc(node) {
  return {
    node, tokensTotal: 0, costUsdTotal: 0, attemptCount: 0, externalAttemptCount: 0, cardIds: new Set(),
    secondsTotal: 0, withSeconds: 0, cacheReadTotal: 0, workTotal: 0, withCacheRead: 0,
    cacheReadUnknown: 0, tokensUnknown: 0,
  };
}

function addAttempt(n, z, cardId) {
  n.tokensTotal += z.tokens || 0;
  if (z.tokensUnknown) n.tokensUnknown += 1;
  n.costUsdTotal += z.costUsd;
  n.attemptCount += 1;
  if (z.costUsd > 0 || z.provider) n.externalAttemptCount += 1;
  // Only what is recorded is summed. An attempt without the field is not counted as an attempt with zero -
  // else the average drifts down and the incompleteness of the record looks like the node's cheapness.
  if (z.seconds != null) { n.secondsTotal += z.seconds; n.withSeconds += 1; }
  if (z.cacheRead != null) { n.cacheReadTotal += z.cacheRead; n.workTotal += z.work; n.withCacheRead += 1; }
  if (z.cacheReadUnknown) n.cacheReadUnknown += 1;
  n.cardIds.add(cardId);
}

function foldNodes(cards) {
  const byNodeMap = {};
  for (const c of cards) {
    for (const z of c.attempts) {
      const n = byNodeMap[z.node] || (byNodeMap[z.node] = newNodeAcc(z.node));
      addAttempt(n, z, c.id);
    }
  }
  return Object.values(byNodeMap);
}

function compareNodes(a, b) {
  const ia = NODE_ORDER.indexOf(a.node), ib = NODE_ORDER.indexOf(b.node);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.node.localeCompare(b.node, 'ru');
}

function nodeRow(n, w) {
  const step = w.stepWeight(n.node);
  const known = n.attemptCount - n.tokensUnknown;
  return {
    node: n.node,
    tokensTotal: n.tokensTotal,
    costUsdTotal: Number(n.costUsdTotal.toFixed(6)),
    attemptCount: n.attemptCount,
    externalAttemptCount: n.externalAttemptCount,
    cardCount: n.cardIds.size,
    secondsTotal: n.secondsTotal,
    withSeconds: n.withSeconds,
    cacheReadTotal: n.cacheReadTotal,
    workTotal: n.workTotal,
    withCacheRead: n.withCacheRead,
    // The attempts where the cache-read was named unknown: a figure of its own, not zero and not a blank (ECONOMY.md, "The `unknown` marker").
    cacheReadUnknown: n.cacheReadUnknown,
    // The attempts with `unknown tokens` - among the attempts, but not in the sum and not in the average.
    tokensUnknown: n.tokensUnknown,
    // The averages - over the attempts where the field is recorded, not over all the node's attempts.
    avgTokens: known ? Math.round(n.tokensTotal / known) : null,
    avgSeconds: n.withSeconds ? Math.round(n.secondsTotal / n.withSeconds) : null,
    // The instruction share: how much of the tokens went to loading the law and the role, not to the work.
    instructionShare: n.withCacheRead && (n.cacheReadTotal + n.workTotal)
      ? Number((n.cacheReadTotal / (n.cacheReadTotal + n.workTotal)).toFixed(3))
      : null,
    // The weight of the law and the role per ONE step of a call (an estimate by the files, not by the metadata).
    instructionPerStep: w.instrWeight === null ? UNKNOWN : (step ? step.perStep : null),
    // The agent's steps on average per attempt: the cache-read divided by the step's weight. An upper estimate:
    // the engine's own system prompt is also part of the real input, so the real step weight is larger and the steps fewer.
    avgSteps: !w.weightKnown ? UNKNOWN : (n.withCacheRead && step
      ? w.stepsOf(Math.round(n.cacheReadTotal / n.withCacheRead), step.perStep)
      : null),
  };
}

/** The slice by the nodes: which of the five spent how many tokens/money and on how many attempts/cards. */
function nodeSpend(cards, w) {
  return foldNodes(cards).map((n) => nodeRow(n, w)).sort(compareNodes);
}

// ---- the economy --------------------------------------------------------------------------------

/**
 * The blind spots - the cards where work was done but the spend not recorded: they explain the gap between
 * "done" and "counted". `backlog` is not included here: no work has happened there yet.
 */
function blindSpotsOf(cards) {
  return cards
    .filter((c) => c.attempts.length === 0 && c.status && c.status !== 'backlog')
    .map((c) => ({ id: c.id, title: c.title, status: c.status, epic: c.epic, done: c.done }));
}

function coverageOf(cards, allAttempts, blindSpotCount) {
  return {
    cardsTotal: cards.length,
    cardsWithAttempts: cards.filter((c) => c.attempts.length > 0).length,
    // The cards where work happened (not backlog) - the denominator the share is honestly counted by.
    cardsWorked: cards.filter((c) => c.status && c.status !== 'backlog').length,
    attemptsTotal: allAttempts.length,
    attemptsWithSeconds: allAttempts.filter((z) => z.seconds != null).length,
    attemptsWithCacheRead: allAttempts.filter((z) => z.cacheRead != null).length,
    attemptsCacheReadUnknown: allAttempts.filter((z) => z.cacheReadUnknown).length,
    attemptsTokensUnknown: allAttempts.filter((z) => z.tokensUnknown).length,
    blindSpotCount,
    attemptsWithService: allAttempts.filter((z) => (z.services || []).length).length,
  };
}

function totalsOf(allAttempts) {
  const withSeconds = allAttempts.filter((z) => z.seconds != null);
  const withCacheRead = allAttempts.filter((z) => z.cacheRead != null);
  const totals = {
    tokens: sum(allAttempts, (z) => z.tokens),
    seconds: sum(withSeconds, (z) => z.seconds),
    costUsd: Number(sum(allAttempts, (z) => z.costUsd).toFixed(6)),
    cacheRead: sum(withCacheRead, (z) => z.cacheRead),
    work: sum(withCacheRead, (z) => z.work),
  };
  // The instruction share over the whole project - only if there is something to count it by.
  totals.instructionShare = totals.cacheRead + totals.work
    ? Number((totals.cacheRead / (totals.cacheRead + totals.work)).toFixed(3))
    : null;
  return totals;
}

/** The costliest cards - where to look for what to optimize. */
function topCardsOf(attemptsCards) {
  return [...attemptsCards]
    .sort((a, b) => b.tokensTotal - a.tokensTotal)
    .slice(0, 12)
    .map((c) => ({
      id: c.id, title: c.title, status: c.status, epic: c.epic,
      tokens: c.tokensTotal,
      attempts: c.attempts.length,
      seconds: sum(c.attempts.filter((z) => z.seconds != null), (z) => z.seconds),
      nodes: [...new Set(c.attempts.map((z) => z.node))],
    }));
}

/**
 * The efficiency - "tokens per closed card" by dates: the only scale where one can see whether the benefit
 * grows or not. The benefit is a CLOSED CARD, not the tokens spent on it.
 *
 * Two caveats, both recorded in the display too:
 *  1. The closing date is `closedDate` (the board or `Core` writes it); without it - the date of the LAST
 *     ATTEMPT, and then it is approximate: the day the work ended, not the day the decision was made.
 *  2. The cards with zero tokens are excluded. Zero here means "no numbers recorded in the attempts",
 *     not "cost nothing": including them, bad accounting would look like growing efficiency.
 */
function efficiencyByDate(closedWithSpend) {
  const byDateMap = {};
  for (const c of closedWithSpend) {
    const last = c.closedDate || c.attempts.map((z) => z.date).sort().pop();
    if (!byDateMap[last]) byDateMap[last] = { date: last, cards: 0, tokens: 0, attempts: 0, exact: 0 };
    if (c.closedDate) byDateMap[last].exact += 1;
    byDateMap[last].cards += 1;
    byDateMap[last].tokens += c.tokensTotal;
    byDateMap[last].attempts += c.attempts.length;
  }
  return Object.values(byDateMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, perCard: Math.round(d.tokens / d.cards) }));
}

function efficiencyOf(attemptsCards) {
  const closedWithSpend = attemptsCards.filter((c) => c.status === 'done' && c.tokensTotal > 0);
  const efficiency = {
    byDate: efficiencyByDate(closedWithSpend),
    cardsCounted: closedWithSpend.length,
    // How many closed cards with attempts were dropped because of zeros - without this, "counted over 5 cards"
    // is indistinguishable from "counted over all the closed ones".
    cardsDroppedZero: attemptsCards.filter((c) => c.status === 'done' && !c.tokensTotal).length,
    // How many cards were attributed to the EXACT closing date; until anyone writes a closing line, this is zero.
    cardsWithClosedDate: closedWithSpend.filter((c) => c.closedDate).length,
    tokensTotal: sum(closedWithSpend, (c) => c.tokensTotal),
  };
  efficiency.perCard = efficiency.cardsCounted
    ? Math.round(efficiency.tokensTotal / efficiency.cardsCounted)
    : null;
  return efficiency;
}

/**
 * The external services. A group is a "service + unit" pair, not one service: one provider may count in different
 * units (credits per generation, minutes per render), and summing them into one number yields a quantity
 * that does not exist. Both record forms: a segment inside a node's attempt and a separate `Service,` line.
 */
function serviceEvents(allAttempts, cards) {
  return [
    ...allAttempts.flatMap((z) => (z.services || []).map((sv) => ({ ...sv, date: z.date, cardId: z.cardId }))),
    ...cards.flatMap((c) => (c.serviceLines || []).map((sv) => ({ ...sv, cardId: c.id }))),
  ];
}

function foldServices(events) {
  const byServiceMap = {};
  for (const sv of events) {
    const key = `${sv.service}|${sv.unit.toLowerCase()}`;
    if (!byServiceMap[key]) {
      byServiceMap[key] = {
        service: sv.service, unit: sv.unit, amount: 0, calls: 0,
        operations: {}, cardIds: new Set(), firstDate: sv.date, lastDate: sv.date,
      };
    }
    const g = byServiceMap[key];
    g.amount += sv.amount;
    g.calls += 1;
    g.operations[sv.operation] = (g.operations[sv.operation] || 0) + sv.amount;
    g.cardIds.add(sv.cardId);
    if (sv.date < g.firstDate) g.firstDate = sv.date;
    if (sv.date > g.lastDate) g.lastDate = sv.date;
  }
  return Object.values(byServiceMap);
}

function byServiceOf(allAttempts, cards) {
  return foldServices(serviceEvents(allAttempts, cards))
    .map((g) => ({
      service: g.service,
      unit: g.unit,
      amount: g.amount,
      calls: g.calls,
      cardCount: g.cardIds.size,
      firstDate: g.firstDate,
      lastDate: g.lastDate,
      // The costliest operations - where the service leaks the most.
      operations: Object.entries(g.operations)
        .map(([operation, amount]) => ({ operation, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 8),
    }))
    .sort((a, b) => b.amount - a.amount);
}

function byDateOf(allAttempts) {
  const byDateMap = {};
  for (const z of allAttempts) {
    if (!byDateMap[z.date]) byDateMap[z.date] = { date: z.date, tokens: 0, seconds: 0, attempts: 0, costUsd: 0 };
    const d = byDateMap[z.date];
    d.tokens += z.tokens || 0;
    d.seconds += z.seconds || 0;
    d.costUsd += z.costUsd;
    d.attempts += 1;
  }
  return Object.values(byDateMap).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The lines where the attempt word stands but there are no numbers at all - the spend happened, the record failed.
 * They are held APART from the legitimate zeros: mixing them means accusing of sloppiness the work where §3
 * does not require a spend record.
 */
function malformedOf(cards) {
  return cards
    .filter((c) => c.malformed && c.malformed.length)
    .flatMap((c) => c.malformed.map((line) => ({ cardId: c.id, title: c.title, line })));
}

function economyView(cards, w) {
  const allAttempts = cards.flatMap((c) => c.attempts.map((z) => ({ ...z, cardId: c.id, cardTitle: c.title })));
  const attemptsCards = cards.filter((c) => c.attempts.length > 0);
  const blindSpots = blindSpotsOf(cards);
  return {
    // The coverage - the first thing read, and so the first field.
    coverage: coverageOf(cards, allAttempts, blindSpots.length),
    totals: totalsOf(allAttempts),
    topCards: topCardsOf(attemptsCards),
    byService: byServiceOf(allAttempts, cards),
    byDate: byDateOf(allAttempts),
    blindSpots: blindSpots.slice(0, 40),
    efficiency: efficiencyOf(attemptsCards),
    malformed: malformedOf(cards),
    // The instruction weight - the only figure computed from the files rather than read from a record; hence
    // `estimate: true` inside: the display must name it an estimate.
    instruction: w.instrWeight === null ? UNKNOWN : w.instrWeight,
  };
}

/**
 * The spend slices over a set of cards: called on the whole corpus (the fields without tokens - the coverage,
 * the blind spots, the services) and on each engine tag separately (everything where tokens are): the tokens
 * of different engines do not go into one sum. `w` - the instruction weight (`weightContext` in `spend.cjs`).
 */
function spendViews(cards, w) {
  return { byNode: nodeSpend(cards, w), economy: economyView(cards, w) };
}

module.exports = { spendViews };
