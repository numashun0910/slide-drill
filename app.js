import { decks, loadSettings, saveSettings, clearSettings } from './db.js';
import { MODELS, DENSITY, generate, testKey, manualPrompt, parseManualReply, costOf } from './generate.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LETTERS = 'ABCDE';
const PRI_LABEL = { 3: '★★★ 最重要', 2: '★★ 重要', 1: '★ 基本' };
const DAY = 864e5;
const BOX_DAYS = [0, 1, 3, 7, 16, 35]; // days until the next review after a correct answer, by box
const REQUEUE_GAP = 4;                 // a missed question comes back this many questions later
const REQUEUE_MAX = 2;                 // at most this many extra appearances per session

const POOLS = [
  ['all', '全問'], ['new', 'まだ解いていない'], ['weak', '苦手（まだ克服していない）'],
  ['w1', '1回以上まちがえた'], ['w2', '2回以上まちがえた'], ['due', '今日の復習'],
];
const ORDERS = [['priority', '重要度順'], ['source', 'スライド順'], ['shuffle', 'シャッフル']];
const DENSITY_LABEL = { low: '少なめ（1枚に約1問）', normal: '標準（1枚に約2問）', high: '多め（1枚に約3問）' };
const QLANG = [['same', '資料と同じ'], ['ja', '日本語'], ['en', '英語']];
const ELANG = [['ja', '日本語'], ['en', '英語']];

let settings = loadSettings();
let current = null;   // the open deck (deck / play views)
let genJob = null;    // the running or finished generation
let pendingFiles = [];
const view = $('#view');

/* ---------- small helpers ---------- */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const range = n => Array.from({ length: n }, (_, i) => i);
const fmtDate = t => t ? new Date(t).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '—';
const fmtCost = c => c == null ? '—' : c < 0.01 ? '$0.01 未満' : `$${c.toFixed(2)}`;
const fmtSize = b => b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function chip(group, value, label, pressed, count, disabled) {
  const n = count === undefined ? '' : `<span class="n">${count}</span>`;
  return `<button type="button" class="chip" data-group="${group}" data-value="${esc(value)}" aria-pressed="${pressed}"${disabled ? ' disabled' : ''}>${esc(label)}${n}</button>`;
}

let toastTimer = null;
function toast(message, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button" class="toast-btn">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  if (action) $('.toast-btn', el).onclick = () => { el.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 7000 : 3500);
}

async function copyText(text, fallbackEl) {
  try { await navigator.clipboard.writeText(text); toast('コピーしました'); }
  catch (e) {
    if (fallbackEl) { fallbackEl.hidden = false; fallbackEl.focus(); fallbackEl.select(); }
    toast('自動でコピーできませんでした。選択された文字をコピーしてください。');
  }
}

function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function save(deck) {
  deck.updatedAt = Date.now();
  try { await decks.put(deck); }
  catch (e) { toast('保存できませんでした。ブラウザの保存容量を確認してください。'); }
}

// Two-step buttons instead of confirm(): the first click arms, the second acts.
function armed(btn, label) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1';
  const old = btn.textContent;
  btn.textContent = label;
  btn.classList.add('armed');
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; btn.classList.remove('armed'); }, 4000);
  return false;
}

/* ---------- decks & review stats ---------- */

function makeDeck({ title, sources, questions, meta, stats }) {
  return {
    id: newId('d'), title, createdAt: Date.now(), updatedAt: Date.now(), lastStudied: null,
    sources, questions: questions.map((q, i) => ({ ...q, id: q.id || `q${i + 1}` })),
    stats: stats || {}, session: null, prefs: null, meta: meta || {},
  };
}

function record(deck, id, ok) {
  const s = deck.stats[id] || (deck.stats[id] = { n: 0, c: 0, w: 0, streak: 0, box: 0, due: 0, last: null });
  const now = Date.now();
  s.n++;
  if (ok) { s.c++; s.streak++; s.box = Math.min(s.box + 1, BOX_DAYS.length - 1); s.due = now + BOX_DAYS[s.box] * DAY; }
  else { s.w++; s.streak = 0; s.box = 0; s.due = now; }
  s.last = ok ? 'c' : 'w';
  s.at = now;
}

const isWeak = s => !!s && s.w > 0 && s.streak < 2;
function inPool(s, pool, now) {
  switch (pool) {
    case 'new': return !s || !s.n;
    case 'weak': return isWeak(s);
    case 'w1': return !!s && s.w >= 1;
    case 'w2': return !!s && s.w >= 2;
    case 'due': return !!s && s.n > 0 && s.due <= now;
    default: return true;
  }
}

function counts(deck) {
  const now = Date.now();
  const qs = deck.questions.filter(q => !q.hidden);
  const c = { total: qs.length, answered: 0, hidden: deck.questions.length - qs.length };
  for (const [key] of POOLS) c[key] = 0;
  for (const q of qs) {
    const s = deck.stats[q.id];
    if (s && s.n) c.answered++;
    for (const [key] of POOLS) if (inPool(s, key, now)) c[key]++;
  }
  return c;
}

function prefsOf(deck) {
  return Object.assign({ src: 'all', minP: 1, order: 'priority', pool: 'all', requeue: true }, deck.prefs || {});
}

function selectIds(deck, prefs) {
  const now = Date.now();
  let list = deck.questions.filter(q => !q.hidden && (prefs.src === 'all' || q.src === Number(prefs.src)) && q.p >= prefs.minP && inPool(deck.stats[q.id], prefs.pool, now));
  if (prefs.order === 'shuffle') list = shuffle(list);
  else if (prefs.order === 'source') list.sort((a, b) => a.src - b.src || (a.loc ?? 0) - (b.loc ?? 0));
  else list.sort((a, b) => b.p - a.p || a.src - b.src || (a.loc ?? 0) - (b.loc ?? 0));
  return list.map(q => q.id);
}

function startSession(deck, ids, label, requeue) {
  const byId = qmap(deck);
  deck.session = {
    queue: ids.slice(), perms: ids.map(id => shuffle(range(byId[id].o.length))), results: ids.map(() => null),
    repeat: ids.map(() => false), extra: {}, idx: 0, requeue, label, done: false, startedAt: Date.now(),
  };
  save(deck);
  location.hash = `#/play/${deck.id}`;
}

const qmap = deck => Object.fromEntries(deck.questions.map(q => [q.id, q]));

function sourceLine(deck, q) {
  const src = deck.sources[q.src] || { name: '', unitLabel: '' };
  const where = q.loc != null ? `${src.unitLabel || ''} ${q.loc}` : '';
  return { file: src.name, where: where.trim(), title: q.title };
}

/* ---------- routing ---------- */

function setNav(name) {
  document.querySelectorAll('.nav a').forEach(a => a.setAttribute('aria-current', a.dataset.route === (name || 'library') ? 'page' : 'false'));
}

async function render() {
  const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
  setNav(name);
  window.scrollTo(0, 0);
  try {
    if (name === 'new') return renderCreate();
    if (name === 'import') return renderImport();
    if (name === 'settings') return renderSettings();
    if (name === 'deck' || name === 'play') {
      if (!current || current.id !== id) current = await decks.get(id);
      if (!current) { location.hash = '#/'; return; }
      return name === 'deck' ? renderDeck() : renderPlay();
    }
    return renderLibrary();
  } catch (err) {
    view.innerHTML = `<section class="panel"><h1>読み込めませんでした</h1><p>${esc(err.message)}</p><p class="hint">プライベートブラウズでは保存が使えないことがあります。通常のウィンドウで開いてください。</p></section>`;
  }
}

/* ---------- library ---------- */

async function renderLibrary() {
  const list = (await decks.all()).sort((a, b) => (b.lastStudied || b.createdAt) - (a.lastStudied || a.createdAt));
  if (!list.length) {
    view.innerHTML = `
      <section class="hero">
        <p class="eyebrow">Slide Drill</p>
        <h1>授業スライドを入れるだけで、選択問題のドリルに。</h1>
        <p class="lede">PDF や PowerPoint を入れると、Claude が重要度順に4〜5択の問題を作ります。答えるとすぐに正誤・解説・スライドの該当箇所が出て、まちがえた問題は自動で復習に回ります。</p>
        <div class="row-btns">
          <a class="btn" href="#/new">スライドから作る</a>
          <a class="btn ghost" href="#/import">API キーなしで作る</a>
          <button type="button" class="btn ghost" data-act="sample">サンプルで試す</button>
        </div>
      </section>
      <section class="steps">
        <div><b>1. 入れる</b><span>PDF・PPTX・DOCX・テキスト・画像。複数ファイルをまとめて1つのデッキにできます。</span></div>
        <div><b>2. 解く</b><span>キーボードの 1〜5 で回答。和訳・解説・出典スライドつき。</span></div>
        <div><b>3. 復習する</b><span>まちがえた問題は少し後にもう一度。「苦手」「今日の復習」でくり返し解けます。</span></div>
      </section>
      <p class="hint">データはすべてこのブラウザの中に保存されます。サーバーには何も送られません（問題を作るときの Claude API の呼び出しを除く）。</p>`;
    return;
  }
  view.innerHTML = `
    <section class="page-head row-between">
      <h1>ライブラリ</h1>
      <div class="row-btns"><a class="btn" href="#/new">＋ スライドから作る</a><a class="btn ghost" href="#/import">読み込む</a></div>
    </section>
    <ul class="deck-list">${list.map(deckCard).join('')}</ul>`;
}

function deckCard(d) {
  const c = counts(d);
  const pct = c.total ? Math.round(c.answered / c.total * 100) : 0;
  return `<li><a class="deck-card" href="#/deck/${esc(d.id)}">
    <span class="deck-title">${esc(d.title)}</span>
    <span class="deck-meta">${c.total}問 · ${esc(d.sources.map(s => s.name).join('、'))}</span>
    <span class="bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
    <span class="deck-chips">
      <span class="pill">解いた ${c.answered} / ${c.total}</span>
      ${c.weak ? `<span class="pill warn">苦手 ${c.weak}</span>` : ''}
      ${c.due ? `<span class="pill due">今日の復習 ${c.due}</span>` : ''}
      <span class="pill muted">最終学習 ${fmtDate(d.lastStudied)}</span>
    </span></a></li>`;
}

/* ---------- create (API) ---------- */

function renderCreate() {
  if (genJob) return renderGen();
  const noKey = !settings.apiKey;
  view.innerHTML = `
    <section class="page-head">
      <h1>スライドから問題を作る</h1>
      <p class="lede">ファイルを入れて「問題を作る」を押すと、Claude がスライドに沿った選択問題・解説・出典をまとめて作ります。</p>
    </section>
    <section class="panel">
      <label class="drop" id="drop" for="file-input">
        <input type="file" id="file-input" multiple accept=".pdf,.pptx,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,.gif">
        <b>ここにファイルをドロップ</b>
        <span>またはクリックして選ぶ（PDF・PPTX・DOCX・TXT・MD・画像、複数可）</span>
      </label>
      <ul class="file-list" id="file-list"></ul>
    </section>
    <section class="panel form">
      <label class="field"><span>デッキ名</span><input id="deck-title" type="text" placeholder="空欄なら最初のファイル名"></label>
      <div class="field"><span>問題の量</span><div class="chips">${Object.keys(DENSITY).map(k => chip('density', k, DENSITY_LABEL[k], settings.density === k)).join('')}</div></div>
      <div class="field"><span>問題文の言語</span><div class="chips">${QLANG.map(([k, l]) => chip('qLang', k, l, settings.qLang === k)).join('')}</div></div>
      <div class="field"><span>解説の言語</span><div class="chips">${ELANG.map(([k, l]) => chip('eLang', k, l, settings.eLang === k)).join('')}</div></div>
      <p class="hint">使うモデル：${esc((MODELS[settings.model] || {}).label || settings.model)}（<a href="#/settings">設定で変更</a>）。費用はあなたの Anthropic アカウントに請求されます。目安は Opus 5.5・標準の量で、スライド20枚あたり 0.5 ドル前後です。</p>
    </section>
    ${noKey ? `<section class="panel notice">
      <p><b>問題を作るには Claude の API キーが必要です。</b></p>
      <div class="row-btns"><a class="btn" href="#/settings">API キーを入れる</a><a class="btn ghost" href="#/import">API キーなしで作る（チャットを使う）</a></div>
    </section>` : ''}
    <div class="actions"><button type="button" class="btn big" id="go" data-act="generate" disabled>問題を作る</button></div>`;
  const input = $('#file-input');
  input.onchange = () => { addFiles(input.files); input.value = ''; };
  const drop = $('#drop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };
  renderFileList();
}

function addFiles(list) {
  for (const f of list) if (!pendingFiles.some(p => p.name === f.name && p.size === f.size)) pendingFiles.push(f);
  renderFileList();
}

function renderFileList() {
  const ul = $('#file-list');
  if (!ul) return;
  ul.innerHTML = pendingFiles.map((f, i) => `<li><span class="fname">${esc(f.name)}</span><span class="fsize">${fmtSize(f.size)}</span><button type="button" class="link" data-act="remove-file" data-i="${i}" aria-label="${esc(f.name)} を外す">外す</button></li>`).join('');
  const go = $('#go');
  if (go) go.disabled = !pendingFiles.length || !settings.apiKey;
}

async function startGeneration() {
  const files = pendingFiles.slice();
  const title = ($('#deck-title').value || '').trim() || files[0].name.replace(/\.[^.]+$/, '');
  const opts = { apiKey: settings.apiKey, model: settings.model, effort: settings.effort, density: settings.density, qLang: settings.qLang, eLang: settings.eLang };
  genJob = { title, files, opts, controller: new AbortController(), running: true, progress: { stage: 'read', file: files[0].name }, result: null, deckId: null };
  renderGen();
  try {
    const res = await generate(files, opts, p => { genJob.progress = p; updateGen(); }, genJob.controller.signal);
    genJob.result = res;
    if (res.questions.length) {
      const deck = makeDeck({ title, sources: res.sources, questions: res.questions, meta: { model: opts.model, usage: res.usage, cost: costOf(opts.model, res.usage), createdWith: 'api' } });
      await save(deck);
      genJob.deckId = deck.id;
      navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {});
    }
  } catch (err) {
    genJob.result = { questions: [], failures: [{ file: '', message: err.message }], usage: {} };
  }
  genJob.running = false;
  pendingFiles = [];
  if (location.hash === '#/new') renderGen();
  else toast(genJob.deckId ? `「${title}」の問題ができました` : '問題を作れませんでした', { label: '見る', run: () => { location.hash = '#/new'; } });
}

function renderGen() {
  const j = genJob;
  if (j.running) {
    view.innerHTML = `
      <section class="page-head"><h1>問題を作っています</h1><p class="lede">「${esc(j.title)}」。終わるまでこのタブを開いたままにしてください。</p></section>
      <section class="panel gen" id="gen"></section>
      <div class="actions"><button type="button" class="btn ghost" data-act="cancel-gen">中止する</button></div>`;
    updateGen();
    return;
  }
  const r = j.result || { questions: [], failures: [] };
  const ok = r.questions.length > 0;
  view.innerHTML = `
    <section class="page-head"><h1>${ok ? `${r.questions.length}問できました` : '問題を作れませんでした'}</h1>
      <p class="lede">${ok ? `「${esc(j.title)}」をライブラリに保存しました。費用の目安：${fmtCost(costOf(j.opts.model, r.usage || {}))}` : '下の理由を確認して、もう一度試してください。'}</p></section>
    ${r.failures && r.failures.length ? `<section class="panel"><h2>うまくいかなかった部分</h2><ul class="fail-list">${r.failures.map(f => `<li><b>${esc(f.file)}</b> ${esc(f.message)}</li>`).join('')}</ul>${ok ? '<p class="hint">できた分の問題は保存されています。</p>' : ''}</section>` : ''}
    <div class="actions row-btns">
      ${ok ? `<a class="btn big" href="#/deck/${esc(j.deckId)}">デッキを開く</a>` : ''}
      <button type="button" class="btn ghost" data-act="new-gen">${ok ? '別のファイルで作る' : 'やり直す'}</button>
    </div>`;
}

let lastGenPaint = 0;
function updateGen() {
  const el = $('#gen');
  if (!el || !genJob) return;
  const now = performance.now();
  if (now - lastGenPaint < 120) return;
  lastGenPaint = now;
  const p = genJob.progress;
  const pct = p.stage === 'gen' ? Math.round(((p.job - 1) / p.jobs) * 100) : 2;
  el.innerHTML = p.stage === 'read'
    ? `<p class="gen-now">ファイルを読み込み中：${esc(p.file)}</p><div class="bar"><i style="width:${pct}%"></i></div>`
    : `<p class="gen-now">${esc(p.file)} の問題を作成中</p>
       <div class="bar"><i style="width:${pct}%"></i></div>
       <p class="gen-stats">${p.job} / ${p.jobs} 回目の呼び出し ・ この範囲で ${p.count} 問 ・ これまでに ${p.total} 問</p>
       <p class="hint">1回の呼び出しに1〜3分ほどかかります。中止しても、それまでにできた問題は保存されます。</p>`;
}

/* ---------- import / manual mode ---------- */

function renderImport() {
  view.innerHTML = `
    <section class="page-head"><h1>読み込む・API キーなしで作る</h1></section>
    <section class="panel">
      <h2>デッキファイルを読み込む</h2>
      <p>このアプリで書き出した <code>.json</code> ファイル（別のパソコンや友だちから受け取ったもの）を読み込みます。</p>
      <label class="btn ghost file-btn" for="deck-file">ファイルを選ぶ<input type="file" id="deck-file" accept=".json,application/json"></label>
    </section>
    <section class="panel">
      <h2>Claude.ai などのチャットで作る（API キー不要）</h2>
      <ol class="howto">
        <li>下のボタンで、問題作成用のプロンプトをコピーします。</li>
        <li><a href="https://claude.ai/new" target="_blank" rel="noopener">Claude.ai</a> で新しいチャットを開き、スライドのファイルを添付して、プロンプトを貼り付けて送ります。</li>
        <li>返ってきた返答（JSON）をすべてコピーして、下の欄に貼り付けます。</li>
      </ol>
      <div class="field"><span>問題の量</span><div class="chips">${Object.keys(DENSITY).map(k => chip('density', k, DENSITY_LABEL[k], settings.density === k)).join('')}</div></div>
      <div class="field"><span>問題文の言語</span><div class="chips">${QLANG.map(([k, l]) => chip('qLang', k, l, settings.qLang === k)).join('')}</div></div>
      <div class="field"><span>解説の言語</span><div class="chips">${ELANG.map(([k, l]) => chip('eLang', k, l, settings.eLang === k)).join('')}</div></div>
      <div class="row-btns"><button type="button" class="btn" data-act="copy-prompt">プロンプトをコピー</button></div>
      <textarea id="prompt-text" class="mono" rows="6" readonly hidden></textarea>
      <label class="field"><span>デッキ名</span><input id="paste-title" type="text" placeholder="例：Front Office Topic 5"></label>
      <label class="field"><span>返ってきた JSON</span><textarea id="paste-json" class="mono" rows="8" placeholder='{"questions": [ ... ]}'></textarea></label>
      <div class="row-btns"><button type="button" class="btn" data-act="import-paste">取り込む</button></div>
      <p class="hint">チャットの返答が途中で切れたときは「続けて」と送り、最後まで出てからまとめて貼り付けてください。ファイルが多いときは1〜2ファイルずつに分けると安定します。</p>
    </section>`;
  $('#deck-file').onchange = e => importDeckFile(e.target.files[0]);
}

async function importDeckFile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    let deck;
    if (data && data.format === 'slide-drill-deck' && data.deck && Array.isArray(data.deck.questions)) {
      const d = data.deck;
      deck = makeDeck({ title: d.title || file.name, sources: d.sources || [], questions: d.questions, meta: d.meta, stats: data.stats || {} });
    } else {
      const res = parseManualReply(JSON.stringify(data));
      deck = makeDeck({ title: file.name.replace(/\.json$/i, ''), sources: res.sources, questions: res.questions, meta: { createdWith: 'manual' } });
    }
    await save(deck);
    toast(`「${deck.title}」を読み込みました（${deck.questions.length}問）`);
    location.hash = `#/deck/${deck.id}`;
  } catch (err) {
    toast(`読み込めませんでした：${err.message}`);
  }
}

async function importPaste() {
  const text = $('#paste-json').value;
  try {
    const res = parseManualReply(text);
    const title = $('#paste-title').value.trim() || res.sources.map(s => s.name).join('、') || '貼り付けたデッキ';
    const deck = makeDeck({ title, sources: res.sources, questions: res.questions, meta: { createdWith: 'manual' } });
    await save(deck);
    toast(`${res.questions.length}問を取り込みました${res.skipped ? `（形の崩れた ${res.skipped} 問は除外）` : ''}`);
    location.hash = `#/deck/${deck.id}`;
  } catch (err) {
    toast(err.message);
  }
}

/* ---------- settings ---------- */

function renderSettings() {
  view.innerHTML = `
    <section class="page-head"><h1>設定</h1></section>
    <section class="panel form">
      <h2>Claude API キー</h2>
      <p>問題を自動で作るのに使います。<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic Console</a> の「API Keys」で作成できます。利用料はあなたのアカウントに請求されます。</p>
      <label class="field"><span>API キー</span>
        <span class="key-row"><input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-..." value="${esc(settings.apiKey)}"><button type="button" class="btn ghost" data-act="toggle-key">表示</button></span>
      </label>
      <div class="row-btns">
        <button type="button" class="btn" data-act="save-key">保存</button>
        <button type="button" class="btn ghost" data-act="test-key">接続テスト</button>
        <button type="button" class="btn ghost" data-act="delete-key">キーを削除</button>
      </div>
      <p class="status" id="key-status" aria-live="polite"></p>
      <p class="hint">キーはこのブラウザ（localStorage）にだけ保存され、問題を作るときに Anthropic の API（api.anthropic.com）へ直接送られます。このサイトの作者を含め、ほかの誰にも送られません。共用のパソコンでは、使い終わったら削除してください。</p>
    </section>
    <section class="panel form">
      <h2>生成の設定</h2>
      <label class="field"><span>モデル</span><select id="model">${Object.entries(MODELS).map(([id, m]) => `<option value="${id}"${settings.model === id ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
      <label class="field"><span>考える深さ</span><select id="effort">
        <option value="high"${settings.effort === 'high' ? ' selected' : ''}>深く（おすすめ・問題の質が上がる）</option>
        <option value="medium"${settings.effort === 'medium' ? ' selected' : ''}>標準（速くて安い）</option>
      </select></label>
      <p class="hint">料金（100万トークンあたり、入力 / 出力）：Opus 5.5 $4 / $20、Sonnet 5.5 $2 / $10、Haiku 5.5 $0.10 / $0.50。</p>
    </section>
    <section class="panel form">
      <h2>データ</h2>
      <p>デッキと学習記録は、このブラウザの中（IndexedDB）にだけ保存されています。別のパソコンで使うときは、デッキの画面から書き出して、もう一台で読み込んでください。</p>
      <div class="row-btns"><button type="button" class="btn ghost danger" data-act="wipe">すべてのデッキと設定を消す</button></div>
    </section>`;
  $('#model').onchange = e => { settings.model = e.target.value; saveSettings(settings); toast('モデルを変更しました'); };
  $('#effort').onchange = e => { settings.effort = e.target.value; saveSettings(settings); toast('保存しました'); };
}

/* ---------- deck overview ---------- */

function renderDeck() {
  const d = current;
  const c = counts(d);
  const prefs = prefsOf(d);
  const n = selectIds(d, prefs).length;
  const S = d.session;
  const resumable = S && !S.done && S.queue.length;
  const srcCount = i => d.questions.filter(q => !q.hidden && q.src === i).length;
  view.innerHTML = `
    <p class="crumb"><a href="#/">← ライブラリ</a></p>
    <section class="page-head">
      <h1 id="deck-name">${esc(d.title)}</h1>
      <p class="lede">${d.questions.length}問 · ${esc(d.sources.map(s => s.name).join('、'))} · 作成 ${fmtDate(d.createdAt)}${d.meta && d.meta.cost != null ? ` · 生成費用の目安 ${fmtCost(d.meta.cost)}` : ''}</p>
    </section>
    <section class="tiles">
      <div class="tile"><span class="tile-n">${c.total}</span><span class="tile-l">問題</span></div>
      <div class="tile"><span class="tile-n">${c.answered}</span><span class="tile-l">解いた</span></div>
      <div class="tile warn"><span class="tile-n">${c.weak}</span><span class="tile-l">苦手</span></div>
      <div class="tile due"><span class="tile-n">${c.due}</span><span class="tile-l">今日の復習</span></div>
    </section>
    <section class="quick row-btns">
      ${resumable ? `<button type="button" class="btn big" data-act="resume">続きから（${Math.min(S.idx + 1, S.queue.length)} / ${S.queue.length}）</button>` : ''}
      <button type="button" class="btn${resumable ? ' ghost' : ' big'}" data-act="quick" data-pool="due" ${c.due ? '' : 'disabled'}>今日の復習 ${c.due}問</button>
      <button type="button" class="btn ghost" data-act="quick" data-pool="weak" ${c.weak ? '' : 'disabled'}>苦手をまとめて ${c.weak}問</button>
    </section>
    <section class="panel" aria-label="出題の条件">
      <h2>出題を選ぶ</h2>
      <div class="row"><span class="row-label">範囲</span><div class="chips">${chip('src', 'all', 'すべて', prefs.src === 'all', c.total)}${d.sources.length > 1 ? d.sources.map((s, i) => chip('src', String(i), s.name, String(prefs.src) === String(i), srcCount(i))).join('') : ''}</div></div>
      <div class="row"><span class="row-label">重要度</span><div class="chips">${chip('minP', 3, '★★★ だけ', prefs.minP === 3)}${chip('minP', 2, '★★ 以上', prefs.minP === 2)}${chip('minP', 1, 'すべて', prefs.minP === 1)}</div></div>
      <div class="row"><span class="row-label">順番</span><div class="chips">${ORDERS.map(([k, l]) => chip('order', k, l, prefs.order === k)).join('')}</div></div>
      <div class="row"><span class="row-label">出題</span><div class="chips">${POOLS.map(([k, l]) => chip('pool', k, l, prefs.pool === k, c[k], !c[k] && prefs.pool !== k)).join('')}</div></div>
      <div class="row"><span class="row-label">復習</span><div class="chips">${chip('requeue', 'toggle', `まちがえた問題を${REQUEUE_GAP}問後にもう一度出す`, prefs.requeue)}</div></div>
      <div class="row"><span class="row-label">表示</span><div class="chips">${chip('showJa', 'toggle', '和訳を表示', settings.showJa)}</div></div>
      <div class="actions"><button type="button" class="btn big" data-act="start" ${n ? '' : 'disabled'}>この条件で始める（${n}問）</button></div>
    </section>
    <details class="panel qlist">
      <summary><h2>問題の一覧</h2><span class="hint">正解・まちがいの回数つき${c.hidden ? `・除外 ${c.hidden}問` : ''}</span></summary>
      <ol>${d.questions.map(q => {
        const s = d.stats[q.id];
        const src = sourceLine(d, q);
        return `<li class="${q.hidden ? 'is-hidden' : ''}"><span class="ql-q">${esc(q.q)}</span>
          <span class="ql-a">正解：${esc(q.o[q.a])}</span>
          <span class="ql-m"><span class="pri p${q.p}">${PRI_LABEL[q.p]}</span> ${esc(src.where)} ${s ? `· ○${s.c} ×${s.w}` : '· 未回答'}${isWeak(s) ? ' · <b class="warn-t">苦手</b>' : ''}
          ${q.hidden ? `<button type="button" class="link" data-act="unhide" data-id="${esc(q.id)}">除外をやめる</button>` : ''}</span></li>`;
      }).join('')}</ol>
    </details>
    <section class="panel">
      <h2>このデッキ</h2>
      <div class="row-btns">
        <button type="button" class="btn ghost" data-act="rename">名前を変える</button>
        <button type="button" class="btn ghost" data-act="export" data-stats="1">書き出す（学習記録つき）</button>
        <button type="button" class="btn ghost" data-act="export" data-stats="0">問題だけ書き出す（友だちに渡す用）</button>
        <button type="button" class="btn ghost" data-act="reset-stats">学習記録をリセット</button>
        <button type="button" class="btn ghost danger" data-act="delete-deck">デッキを削除</button>
      </div>
    </section>`;
}

/* ---------- play ---------- */

function sessionSummary(S) {
  const first = {}, last = {};
  S.queue.forEach((id, i) => { const r = S.results[i]; if (!r) return; if (!(id in first)) first[id] = r.ok; last[id] = r.ok; });
  const ids = Object.keys(first);
  const ok = ids.filter(id => first[id]).length;
  const wrong = ids.filter(id => !first[id]);
  const recovered = wrong.filter(id => last[id]);
  const unique = new Set(S.queue).size;
  return { answered: ids.length, ok, ng: wrong.length, wrong, recovered, unique, skipped: unique - ids.length };
}

function renderPlay() {
  const d = current;
  const S = d.session;
  if (!S || !S.queue.length) { location.hash = `#/deck/${d.id}`; return; }
  if (S.done) return renderResults();
  const byId = qmap(d);
  const id = S.queue[S.idx];
  const q = byId[id];
  const perm = S.perms[S.idx];
  const res = S.results[S.idx];
  const sum = sessionSummary(S);
  const pct = sum.answered / sum.unique * 100;
  const correctPos = perm.indexOf(q.a);
  const src = sourceLine(d, q);
  const opts = perm.map((oi, pos) => {
    let cls = '', mark = '';
    if (res) {
      if (oi === q.a) { cls = ' is-correct'; mark = '正解'; }
      else if (pos === res.pick) { cls = ' is-wrong'; mark = 'あなたの回答'; }
      else cls = ' is-dim';
    }
    return `<li><button type="button" class="opt${cls}" data-act="answer" data-pos="${pos}" ${res ? 'disabled' : ''}><span class="k">${LETTERS[pos]}</span><span class="opt-t">${esc(q.o[oi])}</span><span class="mark">${mark}</span></button></li>`;
  }).join('');
  const last = S.idx === S.queue.length - 1;
  view.innerHTML = `
    <p class="crumb"><a href="#/deck/${esc(d.id)}">← ${esc(d.title)}</a> <span class="muted">· ${esc(S.label)}</span></p>
    <section class="progress" aria-live="polite">
      <div class="progress-line"><span>問題 <b>${S.idx + 1}</b> / ${S.queue.length}${S.queue.length > sum.unique ? `（復習 +${S.queue.length - sum.unique}）` : ''}</span>
      <span>正解 <b>${sum.ok}</b>　不正解 <b>${sum.ng}</b>　正答率 <b>${sum.answered ? Math.round(sum.ok / sum.answered * 100) + '%' : '—'}</b></span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </section>
    <article class="card">
      <div class="meta">
        <span class="keytag">Q ${String(S.idx + 1).padStart(3, '0')}</span>
        <span class="pri p${q.p}">${PRI_LABEL[q.p]}</span>
        ${S.repeat[S.idx] ? '<span class="pill warn">もう一度</span>' : ''}
        <span class="where">${esc(src.file)}${src.where ? ' ／ ' + esc(src.where) : ''}</span>
      </div>
      <p class="q">${esc(q.q)}</p>
      ${settings.showJa && q.ja ? `<p class="ja">${esc(q.ja)}</p>` : ''}
      <ol class="opts">${opts}</ol>
      ${res ? `<div class="fb">
        <p class="verdict ${res.ok ? 'ok' : 'ng'}">${res.ok ? '正解' : `不正解　正解は ${LETTERS[correctPos]}`}${!res.ok && S.requeue && (S.extra[id] || 0) <= REQUEUE_MAX && S.queue.indexOf(id, S.idx + 1) > -1 ? '<span class="verdict-sub">少し後にもう一度出ます</span>' : ''}</p>
        ${q.e ? `<p class="exp">${esc(q.e)}</p>` : ''}
        <div class="src">
          <span class="src-head">出典</span>
          <span class="src-loc">${esc(src.file)}${src.where ? ' ／ ' + esc(src.where) : ''}${src.title ? `「${esc(src.title)}」` : ''}</span>
          ${q.quote ? `<p class="src-quote">${esc(q.quote)}</p>` : ''}
        </div>
        <button type="button" class="link" data-act="hide-q">この問題を今後出さない（内容がおかしいとき）</button>
      </div>` : ''}
      <div class="nav">
        <div class="row-btns">
          <button type="button" class="btn ghost" data-act="prev" ${S.idx === 0 ? 'disabled' : ''}>← 前へ</button>
          ${res ? '' : '<button type="button" class="btn ghost" data-act="skip">スキップ</button>'}
        </div>
        <button type="button" class="btn" data-act="next" ${res ? '' : 'disabled'}>${last ? '結果を見る' : '次の問題 →'}</button>
      </div>
    </article>
    <p class="hint keys"><kbd>1</kbd>〜<kbd>5</kbd> / <kbd>A</kbd>〜<kbd>E</kbd> で回答 · <kbd>Enter</kbd> 次へ · <kbd>←</kbd> 前へ · <kbd>T</kbd> 和訳</p>`;
  if (res) {
    const fb = $('.fb');
    if (fb && fb.getBoundingClientRect().bottom > window.innerHeight) fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function answer(pos) {
  const d = current, S = d.session;
  if (!S || S.done || S.results[S.idx]) return;
  const id = S.queue[S.idx];
  const q = qmap(d)[id];
  if (pos >= q.o.length) return;
  const ok = S.perms[S.idx][pos] === q.a;
  S.results[S.idx] = { pick: pos, ok };
  record(d, id, ok);
  if (!ok && S.requeue && (S.extra[id] || 0) < REQUEUE_MAX) {
    const at = Math.min(S.idx + 1 + REQUEUE_GAP, S.queue.length);
    S.queue.splice(at, 0, id);
    S.perms.splice(at, 0, shuffle(range(q.o.length)));
    S.results.splice(at, 0, null);
    S.repeat.splice(at, 0, true);
    S.extra[id] = (S.extra[id] || 0) + 1;
  }
  d.lastStudied = Date.now();
  save(d);
  renderPlay();
}

function move(delta) {
  const S = current.session;
  const next = S.idx + delta;
  if (next >= S.queue.length) S.done = true;
  else if (next >= 0) S.idx = next;
  save(current);
  renderPlay();
}

function renderResults() {
  const d = current, S = d.session, byId = qmap(d);
  const sum = sessionSummary(S);
  const pct = sum.answered ? Math.round(sum.ok / sum.answered * 100) : 0;
  const rows = d.sources.map((s, i) => {
    const ids = [...new Set(S.queue)].filter(id => byId[id] && byId[id].src === i);
    if (!ids.length) return '';
    const first = id => { const k = S.queue.findIndex((x, j) => x === id && S.results[j]); return k < 0 ? null : S.results[k].ok; };
    const done = ids.filter(id => first(id) !== null);
    const ok = done.filter(id => first(id)).length;
    return `<tr><td>${esc(s.name)}</td><td class="num">${ok} / ${done.length}</td><td class="num">${done.length ? Math.round(ok / done.length * 100) + '%' : '—'}</td></tr>`;
  }).join('');
  const weakNow = counts(d).weak;
  view.innerHTML = `
    <p class="crumb"><a href="#/deck/${esc(d.id)}">← ${esc(d.title)}</a></p>
    <article class="card">
      <p class="eyebrow">結果 · ${esc(S.label)}</p>
      <div class="score"><span class="score-big">${pct}%</span><span class="score-sub">最初の回答で ${sum.ok} / ${sum.answered} 問正解${sum.skipped ? `（スキップ ${sum.skipped}）` : ''}${sum.recovered.length ? ` · 復習で ${sum.recovered.length} 問を取り返しました` : ''}</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>ファイル</th><th class="num">正解</th><th class="num">正答率</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${sum.wrong.length ? `<h2>まちがえた問題（${sum.wrong.length}）</h2><ul class="wl">${sum.wrong.map(id => {
        const q = byId[id]; const src = sourceLine(d, q);
        return `<li><span class="wl-q">${esc(q.q)}</span><span class="wl-a">正解：${esc(q.o[q.a])}</span><span class="wl-s">${esc(src.file)} ${esc(src.where)}${sum.recovered.includes(id) ? ' · 復習で正解' : ''}</span></li>`;
      }).join('')}</ul>` : '<p>まちがえた問題はありません。</p>'}
      <div class="nav">
        <div class="row-btns">
          <button type="button" class="btn ghost" data-act="again">同じ問題をもう一度</button>
          ${weakNow ? `<button type="button" class="btn ghost" data-act="quick" data-pool="weak">苦手をまとめて（${weakNow}問）</button>` : ''}
        </div>
        ${sum.wrong.length ? `<button type="button" class="btn" data-act="retry-wrong">まちがえた ${sum.wrong.length} 問を解き直す</button>` : `<a class="btn" href="#/deck/${esc(d.id)}">デッキに戻る</a>`}
      </div>
    </article>`;
}

/* ---------- sample deck ---------- */

function sampleDeck() {
  const src = [{ name: 'Slide Drill の使い方', kind: 'text', unitLabel: '項目', unitCount: 6 }];
  const Q = (loc, title, q, o, e, quote, p = 3) => ({ q, ja: '', o, a: 0, e, p, src: 0, loc, title, quote });
  return makeDeck({
    title: 'サンプル：Slide Drill の使い方',
    sources: src,
    meta: { createdWith: 'sample' },
    questions: [
      Q(1, '苦手', '「苦手」に入るのはどんな問題？', ['1回以上まちがえて、まだ2回続けて正解していない問題', 'まだ一度も解いていない問題', '重要度が ★ の問題', '最後に正解した問題'], '一度でもまちがえると「苦手」に入り、2回続けて正解すると外れます。まだ解いていない問題は「まだ解いていない」に入ります。', 'まちがえた問題は、2回続けて正解するまで「苦手」に残ります。'),
      Q(2, '今日の復習', '「今日の復習」に出るのはどの問題？', ['前に解いた問題のうち、次の復習日が来たもの', 'デッキのすべての問題', 'まだ解いていない問題だけ', '重要度 ★★★ の問題だけ'], '正解するたびに次の復習までの間隔が 1日→3日→7日→16日→35日 とのびます。まちがえるとすぐ復習に戻ります。', '正解すると次の復習日が先にのび、まちがえるとすぐに「今日の復習」に戻ります。'),
      Q(3, 'くり返し', '「まちがえた問題を4問後にもう一度出す」がオンのとき、まちがえた問題はどうなる？', ['4問ほど後にもう一度出る（1回の学習で最大2回まで）', '学習の最後にまとめて1回だけ出る', '次の日まで出ない', 'デッキから消える'], 'その場で思い出し直せるように、少し間をあけてもう一度出します。結果画面には「復習で取り返した」数も出ます。', 'まちがえた問題は4問後にもう一度出ます（最大2回）。'),
      Q(4, 'API キー', 'Claude の API キーはどこに保存される？', ['このブラウザの中だけ', 'GitHub のリポジトリ', 'このサイトの作者のサーバー', 'Google ドライブ'], 'キーは localStorage にだけ保存され、問題を作るときに api.anthropic.com へ直接送られます。', 'キーはこのブラウザ（localStorage）にだけ保存されます。'),
      Q(5, '別のパソコン', '別のパソコンで同じデッキを続けるには？', ['デッキを「書き出す（学習記録つき）」で保存し、もう一台で読み込む', '同じ URL を開けば自動で同期される', 'API キーを入れれば自動で同期される', '同じ Wi-Fi につなぐ'], 'データはブラウザごとに保存されるので、自動では同期されません。書き出したファイルを読み込めば、学習記録ごと移せます。', '別のパソコンで使うときは、デッキの画面から書き出して、もう一台で読み込んでください。', 2),
      Q(6, 'API キーなし', 'API キーを持っていないときに問題を作る方法は？', ['プロンプトをコピーし、Claude.ai にファイルと一緒に送って、返ってきた JSON を貼り付ける', '問題は作れない', 'スライドの画像を1枚ずつ手で入力する', 'Word で問題を書いてから読み込む'], '「読み込む・API キーなしで作る」画面の手順どおりに進めます。', 'Claude.ai などのチャットで作る（API キー不要）', 2),
    ],
  });
}

/* ---------- events ---------- */

document.addEventListener('click', async e => {
  const c = e.target.closest('.chip');
  if (c) return onChip(c);
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const d = current;
  switch (act) {
    case 'sample': { const deck = sampleDeck(); await save(deck); location.hash = `#/deck/${deck.id}`; break; }
    case 'remove-file': pendingFiles.splice(Number(el.dataset.i), 1); renderFileList(); break;
    case 'generate': if (pendingFiles.length && settings.apiKey) startGeneration(); break;
    case 'cancel-gen': if (genJob && genJob.running) { genJob.controller.abort(); el.disabled = true; el.textContent = '中止しています…'; } break;
    case 'new-gen': genJob = null; renderCreate(); break;
    case 'copy-prompt': { const t = manualPrompt(settings); const ta = $('#prompt-text'); ta.value = t; copyText(t, ta); break; }
    case 'import-paste': importPaste(); break;
    case 'toggle-key': { const i = $('#api-key'); i.type = i.type === 'password' ? 'text' : 'password'; el.textContent = i.type === 'password' ? '表示' : '隠す'; break; }
    case 'save-key': settings.apiKey = $('#api-key').value.trim(); saveSettings(settings); $('#key-status').textContent = settings.apiKey ? '保存しました。' : 'キーが空です。'; break;
    case 'test-key': {
      const key = $('#api-key').value.trim();
      const st = $('#key-status');
      if (!key) { st.textContent = 'キーを入力してください。'; break; }
      st.textContent = '確認しています…';
      const r = await testKey(key, settings.model).catch(err => ({ ok: false, message: err.message }));
      st.textContent = r.message;
      st.className = 'status ' + (r.ok ? 'ok-t' : 'bad-t');
      break;
    }
    case 'delete-key': settings.apiKey = ''; saveSettings(settings); renderSettings(); toast('API キーを削除しました'); break;
    case 'wipe':
      if (!armed(el, 'もう一度押すと、すべて消えます')) break;
      await decks.clear(); clearSettings(); settings = loadSettings(); current = null;
      toast('すべてのデータを消しました'); location.hash = '#/';
      break;
    case 'resume': location.hash = `#/play/${d.id}`; break;
    case 'quick': {
      const pool = el.dataset.pool;
      const prefs = Object.assign(prefsOf(d), { src: 'all', minP: 1, pool, order: 'priority' });
      startSession(d, selectIds(d, prefs), pool === 'due' ? '今日の復習' : '苦手の復習', true);
      break;
    }
    case 'start': {
      const prefs = prefsOf(d);
      const label = [POOLS.find(p => p[0] === prefs.pool)[1], ORDERS.find(o => o[0] === prefs.order)[1]].join(' · ');
      startSession(d, selectIds(d, prefs), label, prefs.requeue);
      break;
    }
    case 'answer': answer(Number(el.dataset.pos)); break;
    case 'next': case 'skip': move(1); break;
    case 'prev': move(-1); break;
    case 'again': { const ids = [...new Set(d.session.queue)]; startSession(d, ids, d.session.label, d.session.requeue); break; }
    case 'retry-wrong': startSession(d, sessionSummary(d.session).wrong, 'まちがえた問題の解き直し', true); break;
    case 'hide-q': {
      const q = qmap(d)[d.session.queue[d.session.idx]];
      q.hidden = true; save(d);
      toast('この問題は今後出しません', { label: '元に戻す', run: () => { q.hidden = false; save(d); } });
      el.remove();
      break;
    }
    case 'unhide': { const q = qmap(d)[el.dataset.id]; q.hidden = false; await save(d); renderDeck(); break; }
    case 'rename': {
      const h = $('#deck-name');
      h.innerHTML = `<input id="rename-input" type="text" value="${esc(d.title)}" aria-label="デッキ名">`;
      const i = $('#rename-input'); i.focus(); i.select();
      const done = async () => { const v = i.value.trim(); if (v) { d.title = v; await save(d); } renderDeck(); };
      i.onkeydown = ev => { if (ev.key === 'Enter') done(); if (ev.key === 'Escape') renderDeck(); };
      i.onblur = done;
      break;
    }
    case 'export': {
      const withStats = el.dataset.stats === '1';
      const deck = { title: d.title, sources: d.sources, questions: d.questions.map(({ hidden, ...q }) => (withStats ? { hidden, ...q } : q)), meta: { createdWith: d.meta && d.meta.createdWith } };
      download(`${d.title.replace(/[\\/:*?"<>|]+/g, '_')}.slide-drill.json`, { format: 'slide-drill-deck', version: 1, exportedAt: new Date().toISOString(), deck, stats: withStats ? d.stats : undefined });
      break;
    }
    case 'reset-stats':
      if (!armed(el, 'もう一度押すとリセット')) break;
      d.stats = {}; d.session = null; await save(d); renderDeck(); toast('学習記録をリセットしました');
      break;
    case 'delete-deck':
      if (!armed(el, 'もう一度押すと削除')) break;
      await decks.remove(d.id); current = null; toast(`「${d.title}」を削除しました`); location.hash = '#/';
      break;
  }
});

function onChip(c) {
  const g = c.dataset.group, v = c.dataset.value;
  if (['density', 'qLang', 'eLang'].includes(g)) {
    settings[g] = v; saveSettings(settings);
    c.parentElement.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
    return;
  }
  if (g === 'showJa') { settings.showJa = !settings.showJa; saveSettings(settings); return renderDeck(); }
  const d = current;
  const prefs = prefsOf(d);
  if (g === 'requeue') prefs.requeue = !prefs.requeue;
  else if (g === 'minP') prefs.minP = Number(v);
  else prefs[g] = v;
  d.prefs = prefs;
  save(d);
  renderDeck();
}

document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!location.hash.startsWith('#/play/') || !current || !current.session || current.session.done) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) return;
  const k = e.key.toLowerCase();
  const S = current.session;
  if (k === 't') { settings.showJa = !settings.showJa; saveSettings(settings); renderPlay(); return; }
  let pos = -1;
  if (/^[1-5]$/.test(k)) pos = Number(k) - 1;
  else if (/^[a-e]$/.test(k)) pos = 'abcde'.indexOf(k);
  if (pos >= 0 && !S.results[S.idx]) { e.preventDefault(); answer(pos); return; }
  if ((k === 'enter' || k === 'arrowright') && S.results[S.idx]) { e.preventDefault(); move(1); return; }
  if (k === 'arrowleft' && S.idx > 0) { e.preventDefault(); move(-1); }
});

window.addEventListener('beforeunload', e => {
  if (genJob && genJob.running) { e.preventDefault(); e.returnValue = ''; }
});
window.addEventListener('hashchange', render);
render();
