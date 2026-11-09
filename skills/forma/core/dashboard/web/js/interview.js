// The "Interview" tab: the live picture of the project toward the brief, a Markdown parser of the idea document.

// ------------------------------------------------------------- interview ---
// The live picture of the project toward the brief.
//   Q1.D  five positions on the left, the subject's tree on the right;
//   Q2.B  redrawn by the round of answers (the round comes in the data, not by a phrase);
//   Q4.C  a guess is marked node by node, not by an area;
//   Q5.C  a guess has exactly two actions - confirm and decline;
//   Q6.C/Q7.B what stayed unconfirmed by the end of the interview goes into "not yet clarified" next to the brief.
// `updated` in the picture is a real ISO with a zone, while timeAgo() above parses its own
// "YYYY-MM-DD HH:MM" format and deliberately does not touch time zones. Extending it for a second format
// would mean keeping two different agreements about what time is inside one function.
function agoIso(iso){
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const min = (Date.now() - t) / 60000;
  if (min < 1) return new Intl.RelativeTimeFormat(curLang(), {numeric:'auto'}).format(0, 'second');
  return relTime(min);
}

const POS_STATE_LABEL = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? t('iv.state.' + k) : '') });
const POS_STATE_CLASS_MAP = {answered:'full', now:'now', available:'available', blocked:'blocked', ready:'ready', sent:'sent', partial:'sent'};

// The board shows the result, not a list of the unsettled. A node not yet agreed on
// is marked "being clarified" - that is information, not an offer to decide it:
// it is decided by a question in the interview, not by a click here.
function guessTagHtml(status){
  if(status === 'confirmed') return `<span class="tag">${t('iv.confirmed')}</span>`;
  if(status === 'rejected') return `<span class="tag">${t('iv.rejected')}</span>`;
  return `<span class="tag">${t('iv.clarifying')}</span>`;
}

function treeNodeHtml(n){
  if(!n) return '';
  const kind = n.kind || 'said';
  const st = n.status || 'open';
  let cls = 'node';
  if(n.role) cls += ' ' + n.role;                 // root | part | fn
  if(kind === 'pending') cls += ' pending';
  else if(kind === 'guess') cls += st === 'confirmed' ? ' confirmed' : st === 'rejected' ? ' rejected' : ' guess';
  else cls += ' said';
  if(n.fresh) cls += ' fresh';

  const tag = kind === 'guess' ? guessTagHtml(st) : (n.tag ? `<span class="tag">${esc(n.tag)}</span>` : '');
  const from = n.from ? ` <span class="from">← ${esc(n.from)}</span>` : '';
  const kids = (n.children && n.children.length)
    ? `<ul>${n.children.map(treeNodeHtml).join('')}</ul>` : '';
  // What can be unwound is what the human said: a guess and an expectation are not material yet.
  const grow = (kind === 'said' && n.id)
    ? `<button class="grow-btn" title="${esc(t('iv.grow'))}" onclick="expandNode('${esc(n.id)}')">+</button>`
    : '';
  return `<li><span class="${cls}">${esc(n.label || '')} ${tag}</span>${grow}${from}${kids}</li>`;
}

function posHtml(p){
  const cls = POS_STATE_CLASS_MAP[p.state] || 'blocked';

  // Three different cases, and they must not be confused: the human's answer, an explanation of what is awaited,
  // a hint about what will be asked.
  let body;
  if (p.text) body = `<p class="pos-text">${esc(p.text)}</p>`;
  else if (p.state === 'blocked' && p.waitingFor.length)
    body = `<p class="pos-hint">${t('iv.waits', {what: p.waitingFor.map(n => t('iv.posN', {n})).join(t('iv.and')), hint: esc(p.hint)})}</p>`;
  else body = `<p class="pos-hint">${esc(p.hint)}</p>`;

  // How many of the approach's questions are closed: "answered" about a position that still has two questions
  // open would be a lie, and the human needs to see what exactly remains.
  const asked = (p.questions || []).length;
  const got = (p.questions || []).filter((q) => q.given).length;
  if (asked) body += `<p class="pos-hint">${t('iv.asked', {got, asked})}</p>`;

  // The layers of positions 3 and 4 - it is visible that there are two approaches here, not one.
  const layers = p.layers && p.layers.length
    ? `<ul class="layers">${p.layers.map(l => `<li class="layer${l.answered ? ' done' : ''}">
        <span class="lk">${esc(l.label || l.key)}</span><span>${esc(l.text || l.hint)}</span></li>`).join('')}</ul>`
    : '';

  // The button only on the one being asked, and only when the prerequisites have settled.
  // The fifth position never has it: the route is `Intent`'s work, and calling the human
  // to answer for a node would mean shifting someone else's work onto them.
  // The button only on the one being asked, and only when the prerequisites have settled.
  // There are no questions for the position yet - the button says so outright instead of opening
  // an empty form: the position rounds are written together with the human when their
  // turn comes.
  let open = '';
  // A closed position gets no button. Its session has run its course and is not resumed:
  // "Open the interview" here would promise a continuation of that conversation, and continuing it
  // is impossible - it is finished and recorded. If a clarification is needed, that is a new approach,
  // opened by `Intent`, after which the position stops being closed and the button returns by itself.
  if (p.asks === 'human' && p.state !== 'blocked' && p.state !== 'answered') {
    open = p.questions.length
      ? `<div class="pos-open">
          <button class="ghost-btn" data-pos="${p.n}" onclick="openPosition(${p.n})">${
            p.session && p.session.alive
              ? t('iv.go')
              : p.session ? t('iv.restart') : t('iv.open')
          }</button>
          ${p.session && !p.session.alive
            // The live session's address is not written next to the button: it led to the same place the button does.
            // Two paths to one place is not a choice but noise next to an action. The only thing
            // worth saying is what the button cannot show: the page is not responding.
            ? `<span class="sess dead">${t('iv.dead')}</span>` : ''}
        </div>`
      : `<p class="pos-note">${t('iv.notWritten')}</p>`;
  }

  // On a closed position, instead of the button - the only thing that still matters here:
  // where the result landed. From there one looks further, not here.
  // A closed position is not closed forever. Resuming is not a continuation of the same
  // conversation (it is recorded and handed over) but a new approach on this same position: one open
  // question about what the human wants to add, then it unwinds by questions.
  const done = p.state === 'answered'
    ? `<div class="pos-open">
        <button class="ghost-btn resume-btn" data-pos="${p.n}" onclick="openPosition(${p.n}, true)">${t('iv.resume')}</button>
        <span class="sess done">${t('iv.recorded')}</span>
      </div>`
    : '';

  const note = p.note ? `<p class="pos-note">${esc(p.note)}</p>` : '';

  let guess = '';
  if(p.guess){
    const st = p.guess.status || 'open';
    const style = st === 'rejected' ? ' style="opacity:.45"' : '';
    guess = `<div class="pos-guess"${style}>
      <span class="guess-mark">${st === 'confirmed' ? t('iv.confirmed') : st === 'rejected' ? t('iv.rejected') : t('iv.guess')}</span>
      <p>${esc(p.guess.text || '')}</p>
    </div>`;
  }

  return `<div class="pos ${cls}">
    <div class="pos-head"><span class="pos-n mono">${p.n}</span><span class="pos-name">${esc(p.label || p.name)}</span><span class="pos-state">${POS_STATE_LABEL[p.state] || ''}</span></div>
    <div class="pos-fill"><i style="width:${p.fill}%"></i></div>
    ${body}${layers}${guess}${note}${done}${open}
  </div>`;
}

// Which side is shown on the right. The choice survives a data rebuild but not
// a page reload: it is a glance, not the project's state.
let sideView = 'tree';
function setSideView(v){
  sideView = v;
  if (latestData) document.getElementById('interview').innerHTML = interviewHtml(latestData.interview);
}

// A tiny Markdown parser - exactly what the idea document is written with: headings,
// lists, tables, quotes, bold and italic. A full library is not pulled in here:
// the dashboard has no build and no dependencies, and there is nothing to start them for one file's sake.
function mdHtml(src){
  const esc2 = (t) => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inline = (t) => esc2(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
  const out = [];
  const lines = String(src).split(/\r?\n/);
  let list = null, quote = false, table = null;
  // Lines accumulate until the paragraph ends with an empty line or something else.
  let para = [];
  const closePara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  let qpara = [];
  const closeQPara = () => { if (qpara.length) { out.push('<p>' + inline(qpara.join(' ')) + '</p>'); qpara = []; } };
  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  const closeQuote = () => { closeQPara(); if (quote) { out.push('</blockquote>'); quote = false; } };
  const closeTable = () => { if (table) { out.push('</tbody></table>'); table = null; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    // A table: the separator row divides the header from the body.
    if (/^\|/.test(l)) {
      closePara();
      const cells = l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (/^[-: ]+$/.test(cells.join(''))) continue;        // separator
      if (!table) { closeList(); closeQuote(); out.push('<table><tbody>'); table = 1; }
      out.push('<tr>' + cells.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>');
      continue;
    }
    closeTable();
    if (!l.trim()) { closePara(); closeList(); closeQuote(); continue; }
    if (/^---+$/.test(l)) { closePara(); closeList(); closeQuote(); out.push('<hr>'); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { closePara(); closeList(); closeQuote(); out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); continue; }
    const q = /^>\s?(.*)$/.exec(l);
    // Inside a quote an empty line separates paragraphs too - otherwise the whole block clumps into one.
    if (q) { closePara(); closeList(); if (!quote) { out.push('<blockquote>'); quote = true; }
      if (q[1].trim()) qpara.push(q[1]); else closeQPara();
      continue; }
    const li = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(l);
    if (li) {
      closePara();
      const want = /^\d/.test(li[1]) ? 'ol' : 'ul';
      if (list && list !== want) closeList();
      if (!list) { out.push('<' + want + '>'); list = want; }
      out.push('<li>' + inline(li[2]) + '</li>');
      continue;
    }
    closeList(); closeQuote();
    para.push(l.trim());
  }
  closePara(); closeList(); closeQuote(); closeTable();
  return out.join('');
}

// A tree item becomes the next question's topic.
//
// The human looks at the parsed tree and sees where little was said. Asking them
// meanwhile "what else shall we talk about" would mean making them recall what is
// right in front of their eyes. The question is assembled from the item itself, on the server.
function expandNode(id){
  fetch('/interview/expand?node=' + encodeURIComponent(id)).then(r => r.json()).then(r => {
    if (!r.ok) { alert(t('iv.err.grow', {err: r.error})); return; }
    const w = window.open(r.url, 'forma-grill-' + r.position);
    if (!w) alert(t('iv.err.popup', {url: r.url}));
  }).catch(e => alert(t('iv.err.grow', {err: String(e)})));
}

// The button leads into the familiar conversation format - the interview page
// `forma-grill-with-ui`, as a separate tab. There is deliberately no form inside the dashboard:
// two input places for the same questions is exactly the fatigue of many little
// windows, which everything was gathered into one channel to avoid.
//
function openPosition(n, resume){
  const btn = document.querySelector(`#interview [data-pos="${n}"]`);
  if (btn) { btn.disabled = true; btn.textContent = t('iv.opening'); }
  fetch('/interview/open?position=' + n + (resume ? '&resume=1' : '')).then(r => r.json()).then(r => {
    if (btn) { btn.disabled = false; btn.textContent = t('iv.openBtn'); }
    if (!r.ok) { alert(t('iv.err.open', {err: r.error})); return; }
    // A named window, not an unnamed one: a second click on the same position returns
    // the same tab instead of starting a second page of one conversation.
    const w = window.open(r.url, 'forma-grill-' + n);
    if (!w) alert(t('iv.err.popup', {url: r.url}));
  }).catch(e => {
    if (btn) { btn.disabled = false; btn.textContent = t('iv.openBtn'); }
    alert(t('iv.err.open', {err: String(e)}));
  });
}

function interviewRightHtml(iv){
  return `<div class="live-right">
    <div class="side-tabs">
      <button class="side-tab${sideView === 'tree' ? ' on' : ''}" onclick="setSideView('tree')">${t('iv.view.tree')}</button>
      <button class="side-tab${sideView === 'idea' ? ' on' : ''}" onclick="setSideView('idea')">${t('iv.view.idea')}</button>
      <button class="side-tab${sideView === 'prompt' ? ' on' : ''}" onclick="setSideView('prompt')">${t('iv.view.prompt')}</button>
    </div>
    <div class="side-pane" style="display:${sideView === 'prompt' ? 'block' : 'none'}">
      ${iv.landingPrompt && iv.landingPrompt.trim()
        ? '<div class="idea-doc">' + mdHtml(iv.landingPrompt) + '</div>'
        : `<p class="pos-text" style="font-style:italic">${t('iv.prompt.empty')}</p>`}
      <p class="tree-foot">${t('iv.prompt.foot')}</p>
    </div>
    <div class="side-pane" style="display:${sideView === 'idea' ? 'block' : 'none'}">
      ${iv.idea
        ? '<div class="idea-doc">' + mdHtml(iv.idea) + '</div>'
        : `<p class="pos-text" style="font-style:italic">${t('iv.idea.empty')}</p>`}
      <p class="tree-foot">${t('iv.idea.foot')}</p>
    </div>
    <div class="side-pane" style="display:${sideView === 'tree' ? 'block' : 'none'}">
    <p class="col-title">${t('iv.tree.title')}</p>
    <div class="tree">${iv.tree ? '<ul>' + treeNodeHtml(iv.tree) + '</ul>' : `<p class="pos-text" style="font-style:italic">${t('iv.tree.empty')}</p>`}</div>
    <p class="tree-foot">${t('iv.tree.foot')}</p>
    <p class="limit-note">${t('iv.limit')}</p>
    </div>
  </div>`;
}

// From the board one can jump into the interview - there, and only there, the unclear gets clarified.
function interviewUnconfHtml(iv){
  const open = (iv.positions || []).find((x) => x.asks === 'human' && x.questions && x.questions.length
    && (x.state === 'available' || x.state === 'sent' || x.state === 'answered'));
  return `<div class="unconf">
    <span>${t('iv.unclear')}</span>
    <span class="spacer" style="flex:1"></span>
    ${open ? (open.session && open.session.alive
      ? `<a class="sess live" href="${esc(open.session.url)}" target="forma-grill-${open.n}">${t('iv.sessOpen', {url: esc(open.session.url)})}</a>`
      : `<button class="ghost-btn" data-pos="${open.n}" onclick="openPosition(${open.n})">${t('iv.open')}</button>`) : ''}
  </div>`;
}

function interviewHtml(iv){
  if(!iv) return '';

  // The interview is not running - but the skeleton is shown anyway: the human sees what
  // will be asked and can gather their thoughts before the conversation, not during it.
  const off = !iv.present;
  const warn = off
    ? (iv.reason === 'bad-json'
        ? `<div class="load-error">${t('iv.brokenPicture', {err: esc(iv.error || t('iv.brokenJson'))})}</div>`
        : `<p class="pos-hint" style="margin:0 0 14px">${t('iv.notHeld')}</p>`)
    : '';

  const head = `<div class="live-head">
    <h2>${t('iv.title')}</h2>
    <span class="spacer"></span>
    <span class="refresh" title="${esc(t('iv.refreshTip'))}">
      <span class="dot"></span> ${off ? t('iv.notStarted') : (iv.round != null ? t('iv.updatedRound', {n: iv.round}) : t('iv.noRound'))}${iv.updated ? ' · <b>' + agoIso(iv.updated) + '</b>' : ''}
    </span>
  </div>`;

  const left = `<div class="live-left">
    <p class="col-title">${t('iv.positions', {n: iv.answered})}</p>
    ${iv.positions.map(posHtml).join('')}
  </div>`;

  const foot = `<div class="live-foot">
    <span>${t('iv.fillsStep')}</span>
    <span class="spacer" style="flex:1"></span>
    <span class="mini">${iv.guesses.open ? t('iv.nodesOpen', {n: iv.guesses.open}) : t('iv.nothingOpen')}</span>
  </div>`;

  return warn + `<section class="live">${head}<div class="live-body">${left}${interviewRightHtml(iv)}</div>${interviewUnconfHtml(iv)}${foot}</section>`;
}
