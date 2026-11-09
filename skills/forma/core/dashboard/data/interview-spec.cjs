'use strict';

/**
 * The interview structure: five positions and the opening questions. Order, names and structure come from
 * `project/brief/interview.md`, the default script. The skeleton exists always, before the first answer:
 * the tab shows not emptiness but what will be asked, so the human can collect their thoughts in advance.
 *
 * Two layers, kept apart:
 *  - STRUCTURE (`POSITIONS`): `name` is the canonical machine key — it is matched against the headings of
 *    `picture.md` and `interview.md`, so it never changes with the language; `asks`, `deps`, layer keys too.
 *  - COPY (`COPY.en` / `COPY.ru`): everything the human reads — display label, hint, note, questions. The
 *    language is the project language (`project/config/PROJECT.md`, «Project language»); English is the source,
 *    Russian the official second.
 *
 * `asks` — who is asked. For position 5 it is `intent`: the route is not a question to the human but the
 * node's reconnaissance (check against `project/config/ROUTE.md`; the branch is set by the «Project template»
 * field in `PROJECT.md`). It has no «answer» button — otherwise the human would be asked to do the node's work.
 *
 * `deps` — the frontier: a position is open when its prerequisites have settled. The third cannot be asked
 * until the second has named the parts — «which common goal do the parts serve together» without parts makes the
 * human guess at what they never said. The first and second open at once: they give the look and the breakdown
 * and neither waits for the other.
 *
 * `layers` — positions 3 and 4 have two each: the human layer — what the recipient will feel, the subject layer —
 * by what functionality it is produced. One without the other degenerates: a feeling without functionality is a
 * promise, functionality without a feeling is work for no known reason. For the talk it also means there are
 * seven rounds, not five, and each is smaller.
 *
 * Names on screen face the subject. The internal names of the qualities (Beauty, Simplicity, Individuality,
 * Honesty, Naturalness) are not brought out here: a question must not announce which quality it is after,
 * otherwise the human starts answering categories instead of about their own project.
 */
const i18n = require('../../i18n/index.cjs');

const POSITIONS = [
  { n: 1, name: '\u041e\u0431\u043b\u0438\u043a', asks: 'human', deps: [] },
  { n: 2, name: '\u0427\u0430\u0441\u0442\u0438', asks: 'human', deps: [] },
  { n: 3, name: '\u041e\u0431\u0449\u0430\u044f \u0446\u0435\u043b\u044c \u0447\u0430\u0441\u0442\u0435\u0439', asks: 'human', deps: [2], layers: ['human', 'subject'] },
  { n: 4, name: '\u0412\u043d\u0443\u0442\u0440\u0435\u043d\u043d\u044f\u044f \u0444\u0443\u043d\u043a\u0446\u0438\u043e\u043d\u0430\u043b\u044c\u043d\u043e\u0441\u0442\u044c', asks: 'human', deps: [3], layers: ['human', 'subject'] },
  { n: 5, name: '\u041c\u0430\u0440\u0448\u0440\u0443\u0442', asks: 'intent', deps: [4] },
];

// Opening-round questions per position. Open, no options to pick: options are invented by the agent, and a poll
// with ready options would write into the brief its own design approved by the human instead of the human's design —
// and unnoticed, since formally «the human said it: they clicked». Options appear from the second round
// and are built from what has already been said (`project/brief/picture.md`).
//
// Rounds of positions 3-5 are intentionally empty. A question composed before the previous answer is heard asks about
// an imagined project; they are written together with the human when their turn comes.
// Position 2 asks about the parts of the subject itself, not the sections of the catalog:
// the eight directions are its content, the parts are what it is assembled from.
const COPY = {
  en: {
    positions: {
      1: { label: 'Look', hint: 'What the project looks like from outside, what form it has.' },
      2: { label: 'Parts', hint: 'What separate parts it divides into.' },
      3: {
        label: 'Common goal of the parts',
        hint: 'The one common goal all the parts serve together.',
        layers: {
          human: { label: 'human', hint: 'What benefit a slice of the audience gets — what the person will feel.' },
          subject: { label: 'subject', hint: 'What functionality produces it so that they are satisfied.' },
        },
      },
      4: {
        label: 'Inner functionality',
        hint: 'What functions the project performs inside itself to deliver what position 3 names.',
        layers: {
          human: { label: 'human', hint: 'What it is done for, care about how it will turn out.' },
          subject: { label: 'subject', hint: 'What functions carry it out — what `Run` will do.' },
        },
      },
      5: {
        label: 'Route',
        hint: 'The natural way all of this is finally realized.',
        note: 'Checking against `project/config/ROUTE.md` is the work of `Intent`, not a question to the human.',
      },
    },
    rounds: {
      1: [
        { id: 'p1-q1', title: 'First screen',
          text: 'The project already works. You show it to someone who knows nothing about it — open it and let them look. What do they see in front of them?' },
        { id: 'p1-q2', title: 'What it resembles',
          text: 'Name one or two existing things this resembles. And at once — how yours differs from them.' },
        { id: 'p1-q3', title: 'What shows, what is hidden',
          text: 'What should catch the eye first? And what, on the contrary, should be unnoticed, go deep inside?' },
      ],
      2: [
        { id: 'p2-q1', title: 'What it is assembled from',
          text: 'Take the project apart, the way one takes a thing apart. Not the sections of the catalog — we already know them — but the pieces of the site itself: each with its own job. What is separate in there?' },
        { id: 'p2-q2', title: 'What can be removed',
          text: 'If you had to launch without one part — which would you drop first? And what would stop working after that.' },
        { id: 'p2-q3', title: 'Who is busy with what',
          text: 'Name a part that works by itself, without you. And a part that does not work at all without your participation.' },
      ],
    },
    resume: {
      title: 'What else to discuss',
      text: 'This position was closed, but not closed forever. What would you like to add, correct or discuss anew? One word is enough — I will unfold it with questions.',
    },
    grow: { title: 'In more detail', text: 'In the tree this is recorded as: «{label}». Unfold this item: what stands behind it, what it looks like in practice, what it lacks. Then I will go on with questions about your answer.' },
    seed: { note: 'The first round is open: answer in your own words. You may skip some.', question: 'Question {n}', topic: 'Brief interview — position {n}' },
  },
  ru: {
    positions: {
      1: { label: '\u041e\u0431\u043b\u0438\u043a', hint: '\u0427\u0442\u043e \u043f\u0440\u043e\u0435\u043a\u0442 \u0441\u043e\u0431\u043e\u0439 \u043f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u043b\u044f\u0435\u0442 \u0432\u043d\u0435\u0448\u043d\u0435, \u043a\u0430\u043a\u0443\u044e \u0444\u043e\u0440\u043c\u0443 \u0438\u043c\u0435\u0435\u0442.' },
      2: { label: '\u0427\u0430\u0441\u0442\u0438', hint: '\u041d\u0430 \u043a\u0430\u043a\u0438\u0435 \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u044b\u0435 \u0447\u0430\u0441\u0442\u0438 \u043e\u043d \u0434\u0435\u043b\u0438\u0442\u0441\u044f.' },
      3: {
        label: '\u041e\u0431\u0449\u0430\u044f \u0446\u0435\u043b\u044c \u0447\u0430\u0441\u0442\u0435\u0439',
        hint: '\u041a\u0430\u043a\u0443\u044e \u043e\u0434\u043d\u0443 \u043e\u0431\u0449\u0443\u044e \u0446\u0435\u043b\u044c \u0432\u0441\u0435 \u0447\u0430\u0441\u0442\u0438 \u0432\u044b\u043f\u043e\u043b\u043d\u044f\u044e\u0442 \u0432\u043c\u0435\u0441\u0442\u0435.',
        layers: {
          human: { label: '\u0447\u0435\u043b\u043e\u0432\u0435\u043a', hint: '\u041a\u0430\u043a\u0443\u044e \u043f\u043e\u043b\u044c\u0437\u0443 \u043f\u043e\u043b\u0443\u0447\u0430\u0435\u0442 \u0441\u0440\u0435\u0437 \u0430\u0443\u0434\u0438\u0442\u043e\u0440\u0438\u0438 — \u0447\u0442\u043e \u0447\u0435\u043b\u043e\u0432\u0435\u043a \u043f\u043e\u0447\u0443\u0432\u0441\u0442\u0432\u0443\u0435\u0442.' },
          subject: { label: '\u043f\u0440\u0435\u0434\u043c\u0435\u0442', hint: '\u041a\u0430\u043a\u043e\u0439 \u0444\u0443\u043d\u043a\u0446\u0438\u043e\u043d\u0430\u043b \u044d\u0442\u043e \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0438\u0442, \u0447\u0442\u043e\u0431\u044b \u043e\u043d \u0431\u044b\u043b \u0443\u0434\u043e\u0432\u043b\u0435\u0442\u0432\u043e\u0440\u0451\u043d.' },
        },
      },
      4: {
        label: '\u0412\u043d\u0443\u0442\u0440\u0435\u043d\u043d\u044f\u044f \u0444\u0443\u043d\u043a\u0446\u0438\u043e\u043d\u0430\u043b\u044c\u043d\u043e\u0441\u0442\u044c',
        hint: '\u041a\u0430\u043a\u0438\u0435 \u0444\u0443\u043d\u043a\u0446\u0438\u0438 \u043f\u0440\u043e\u0435\u043a\u0442 \u0432\u044b\u043f\u043e\u043b\u043d\u044f\u0435\u0442 \u0432\u043d\u0443\u0442\u0440\u0438 \u0441\u0435\u0431\u044f, \u0447\u0442\u043e\u0431\u044b \u0434\u0430\u0442\u044c \u043d\u0430\u0437\u0432\u0430\u043d\u043d\u043e\u0435 \u0432 \u043f\u043e\u0437\u0438\u0446\u0438\u0438 3.',
        layers: {
          human: { label: '\u0447\u0435\u043b\u043e\u0432\u0435\u043a', hint: '\u0420\u0430\u0434\u0438 \u0447\u0435\u0433\u043e \u044d\u0442\u043e \u0434\u0435\u043b\u0430\u0435\u0442\u0441\u044f, \u0437\u0430\u0431\u043e\u0442\u0430 \u043e \u0442\u043e\u043c, \u0447\u0442\u043e \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u0441\u044f.' },
          subject: { label: '\u043f\u0440\u0435\u0434\u043c\u0435\u0442', hint: '\u041a\u0430\u043a\u0438\u0435 \u0444\u0443\u043d\u043a\u0446\u0438\u0438 \u044d\u0442\u043e \u0438\u0441\u043f\u043e\u043b\u043d\u044f\u044e\u0442 — \u0442\u043e, \u0447\u0442\u043e \u0431\u0443\u0434\u0435\u0442 \u0434\u0435\u043b\u0430\u0442\u044c `Run`.' },
        },
      },
      5: {
        label: '\u041c\u0430\u0440\u0448\u0440\u0443\u0442',
        hint: '\u041a\u0430\u043a\u0438\u043c \u0435\u0441\u0442\u0435\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u043c \u0441\u043f\u043e\u0441\u043e\u0431\u043e\u043c \u0432\u0441\u0451 \u044d\u0442\u043e \u0432 \u043a\u043e\u043d\u0435\u0447\u043d\u043e\u043c \u0441\u0447\u0451\u0442\u0435 \u0440\u0435\u0430\u043b\u0438\u0437\u0443\u0435\u0442\u0441\u044f.',
        note: '\u0421\u0432\u0435\u0440\u043a\u0430 \u0441 `project/config/ROUTE.md` — \u0440\u0430\u0431\u043e\u0442\u0430 `Intent`, \u043d\u0435 \u0432\u043e\u043f\u0440\u043e\u0441 \u0447\u0435\u043b\u043e\u0432\u0435\u043a\u0443.',
      },
    },
    rounds: {
      1: [
        { id: 'p1-q1', title: '\u041f\u0435\u0440\u0432\u044b\u0439 \u044d\u043a\u0440\u0430\u043d',
          text: '\u041f\u0440\u043e\u0435\u043a\u0442 \u0443\u0436\u0435 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442. \u0412\u044b \u043f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0435\u0442\u0435 \u0435\u0433\u043e \u0447\u0435\u043b\u043e\u0432\u0435\u043a\u0443, \u043a\u043e\u0442\u043e\u0440\u044b\u0439 \u043e \u043d\u0451\u043c \u043d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u0437\u043d\u0430\u0435\u0442, — \u043e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u0442\u0435 \u0438 \u0434\u0430\u0451\u0442\u0435 \u043f\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c. \u0427\u0442\u043e \u043e\u043d \u0432\u0438\u0434\u0438\u0442 \u043f\u0435\u0440\u0435\u0434 \u0441\u043e\u0431\u043e\u0439?' },
        { id: 'p1-q2', title: '\u041d\u0430 \u0447\u0442\u043e \u043f\u043e\u0445\u043e\u0436\u0435',
          text: '\u041d\u0430\u0437\u043e\u0432\u0438\u0442\u0435 \u043e\u0434\u043d\u0443-\u0434\u0432\u0435 \u0443\u0436\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044e\u0449\u0438\u0435 \u0432\u0435\u0449\u0438, \u043d\u0430 \u043a\u043e\u0442\u043e\u0440\u044b\u0435 \u044d\u0442\u043e \u043f\u043e\u0445\u043e\u0436\u0435. \u0418 \u0441\u0440\u0430\u0437\u0443 — \u0447\u0435\u043c \u0432\u0430\u0448\u0435 \u043e\u0442 \u043d\u0438\u0445 \u043e\u0442\u043b\u0438\u0447\u0430\u0435\u0442\u0441\u044f.' },
        { id: 'p1-q3', title: '\u0427\u0442\u043e \u0432\u0438\u0434\u043d\u043e, \u0447\u0442\u043e \u0441\u043f\u0440\u044f\u0442\u0430\u043d\u043e',
          text: '\u0427\u0442\u043e \u0432 \u043d\u0451\u043c \u0434\u043e\u043b\u0436\u043d\u043e \u0431\u0440\u043e\u0441\u0430\u0442\u044c\u0441\u044f \u0432 \u0433\u043b\u0430\u0437\u0430 \u043f\u0435\u0440\u0432\u044b\u043c? \u0418 \u0447\u0442\u043e, \u043d\u0430\u043e\u0431\u043e\u0440\u043e\u0442, \u0434\u043e\u043b\u0436\u043d\u043e \u0431\u044b\u0442\u044c \u043d\u0435\u0437\u0430\u043c\u0435\u0442\u043d\u044b\u043c, \u0443\u0439\u0442\u0438 \u0432\u0433\u043b\u0443\u0431\u044c?' },
      ],
      2: [
        { id: 'p2-q1', title: '\u0418\u0437 \u0447\u0435\u0433\u043e \u0441\u043e\u0431\u0440\u0430\u043d\u043e',
          text: '\u0420\u0430\u0437\u0431\u0435\u0440\u0438\u0442\u0435 \u043f\u0440\u043e\u0435\u043a\u0442 \u043d\u0430 \u0447\u0430\u0441\u0442\u0438, \u043a\u0430\u043a \u0440\u0430\u0437\u0431\u0438\u0440\u0430\u044e\u0442 \u0432\u0435\u0449\u044c. \u041d\u0435 \u0440\u0430\u0437\u0434\u0435\u043b\u044b \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0430 — \u0438\u0445 \u043c\u044b \u0443\u0436\u0435 \u0437\u043d\u0430\u0435\u043c, — \u0430 \u043a\u0443\u0441\u043a\u0438 \u0441\u0430\u043c\u043e\u0433\u043e \u0441\u0430\u0439\u0442\u0430: \u0443 \u043a\u0430\u0436\u0434\u043e\u0433\u043e \u0441\u0432\u043e\u0451 \u0434\u0435\u043b\u043e. \u0427\u0442\u043e \u0442\u0430\u043c \u0435\u0441\u0442\u044c \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u043e\u0433\u043e?' },
        { id: 'p2-q2', title: '\u0427\u0442\u043e \u043c\u043e\u0436\u043d\u043e \u0443\u0431\u0440\u0430\u0442\u044c',
          text: '\u0415\u0441\u043b\u0438 \u0431\u044b \u043f\u0440\u0438\u0448\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c\u0441\u044f \u0431\u0435\u0437 \u043e\u0434\u043d\u043e\u0439 \u0447\u0430\u0441\u0442\u0438 — \u043a\u0430\u043a\u0443\u044e \u0443\u0431\u0440\u0430\u043b\u0438 \u0431\u044b \u043f\u0435\u0440\u0432\u043e\u0439? \u0418 \u0447\u0442\u043e \u043f\u043e\u0441\u043b\u0435 \u044d\u0442\u043e\u0433\u043e \u043f\u0435\u0440\u0435\u0441\u0442\u0430\u043b\u043e \u0431\u044b \u0440\u0430\u0431\u043e\u0442\u0430\u0442\u044c.' },
        { id: 'p2-q3', title: '\u041a\u0442\u043e \u0447\u0435\u043c \u0437\u0430\u043d\u044f\u0442',
          text: '\u041d\u0430\u0437\u043e\u0432\u0438\u0442\u0435 \u0447\u0430\u0441\u0442\u044c, \u043a\u043e\u0442\u043e\u0440\u0430\u044f \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u0441\u0430\u043c\u0430, \u0431\u0435\u0437 \u0432\u0430\u0441. \u0418 \u0447\u0430\u0441\u0442\u044c, \u043a\u043e\u0442\u043e\u0440\u0430\u044f \u0431\u0435\u0437 \u0432\u0430\u0448\u0435\u0433\u043e \u0443\u0447\u0430\u0441\u0442\u0438\u044f \u043d\u0435 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u0432\u043e\u043e\u0431\u0449\u0435.' },
      ],
    },
    resume: {
      title: '\u0427\u0442\u043e \u0435\u0449\u0451 \u043e\u0431\u0441\u0443\u0434\u0438\u0442\u044c',
      text: '\u042d\u0442\u0430 \u043f\u043e\u0437\u0438\u0446\u0438\u044f \u0431\u044b\u043b\u0430 \u0437\u0430\u043a\u0440\u044b\u0442\u0430, \u043d\u043e \u0437\u0430\u043a\u0440\u044b\u0442\u0430 \u043d\u0435 \u043d\u0430\u0432\u0441\u0435\u0433\u0434\u0430. \u0427\u0442\u043e \u0432\u044b \u0445\u043e\u0442\u0435\u043b\u0438 \u0431\u044b \u0434\u043e\u0431\u0430\u0432\u0438\u0442\u044c, \u043f\u043e\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0438\u043b\u0438 \u043e\u0431\u0441\u0443\u0434\u0438\u0442\u044c \u0437\u0430\u043d\u043e\u0432\u043e? \u041c\u043e\u0436\u043d\u043e \u043e\u0434\u043d\u0438\u043c \u0441\u043b\u043e\u0432\u043e\u043c — \u0434\u0430\u043b\u044c\u0448\u0435 \u0440\u0430\u0441\u043a\u0440\u0443\u0447\u0443 \u0432\u043e\u043f\u0440\u043e\u0441\u0430\u043c\u0438.',
    },
    grow: { title: '\u041f\u043e\u0434\u0440\u043e\u0431\u043d\u0435\u0435', text: '\u0412 \u0434\u0435\u0440\u0435\u0432\u0435 \u044d\u0442\u043e \u0437\u0430\u043f\u0438\u0441\u0430\u043d\u043e \u0442\u0430\u043a: «{label}». \u0420\u0430\u0441\u043a\u0440\u043e\u0439\u0442\u0435 \u044d\u0442\u043e\u0442 \u043f\u0443\u043d\u043a\u0442: \u0447\u0442\u043e \u0437\u0430 \u043d\u0438\u043c \u0441\u0442\u043e\u0438\u0442, \u043a\u0430\u043a \u043e\u043d \u0432\u044b\u0433\u043b\u044f\u0434\u0438\u0442 \u043d\u0430 \u0434\u0435\u043b\u0435, \u0447\u0435\u0433\u043e \u0432 \u043d\u0451\u043c \u043d\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442. \u0414\u0430\u043b\u044c\u0448\u0435 \u043f\u043e\u0439\u0434\u0443 \u0432\u043e\u043f\u0440\u043e\u0441\u0430\u043c\u0438 \u043f\u043e \u0432\u0430\u0448\u0435\u043c\u0443 \u043e\u0442\u0432\u0435\u0442\u0443.' },
    seed: { note: '\u041f\u0435\u0440\u0432\u044b\u0439 \u0437\u0430\u0445\u043e\u0434 \u043e\u0442\u043a\u0440\u044b\u0442\u044b\u0439: \u043e\u0442\u0432\u0435\u0447\u0430\u0439\u0442\u0435 \u0441\u0432\u043e\u0438\u043c\u0438 \u0441\u043b\u043e\u0432\u0430\u043c\u0438. \u041c\u043e\u0436\u043d\u043e \u043e\u0442\u0432\u0435\u0442\u0438\u0442\u044c \u043d\u0435 \u043d\u0430 \u0432\u0441\u0435.', question: '\u0412\u043e\u043f\u0440\u043e\u0441 {n}', topic: '\u0418\u043d\u0442\u0435\u0440\u0432\u044c\u044e \u043a \u0431\u0440\u0438\u0444\u0443 — \u043f\u043e\u0437\u0438\u0446\u0438\u044f {n}' },
  },
};

/** Project language → copy set: «Russian» → `ru`, anything else → `en` (the source language). */
function langOf(projectMd) {
  const word = (i18n.reader(projectMd).inline('language') || '').split(/\s+/)[0];
  return i18n.langCode(word) === 'ru' ? 'ru' : 'en';
}

/** Positions with copy merged in (`label`, `hint`, `note`, layers with `label`/`hint`) and the opening rounds. */
function localize(lang) {
  const c = COPY[lang] || COPY.en;
  const positions = POSITIONS.map((p) => {
    const t = c.positions[p.n];
    const spec = { ...p, label: t.label, hint: t.hint };
    if (t.note) spec.note = t.note;
    if (p.layers) spec.layers = p.layers.map((key) => ({ key, label: t.layers[key].label, hint: t.layers[key].hint }));
    return spec;
  });
  return { POSITIONS: positions, OPENING_ROUND: c.rounds, resume: c.resume, seed: c.seed, grow: c.grow };
}

module.exports = { POSITIONS, OPENING_ROUND: COPY.en.rounds, COPY, langOf, localize };
