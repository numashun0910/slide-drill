import { decks, loadSettings, saveSettings, clearSettings } from './db.js';
import { MODELS, DENSITY, TR_LANGS, generate, testKey, manualPrompt, parseManualReply, costOf } from './generate.js';
import { currentLang } from './i18n.js';
import { PRICE, FREE_LIMITS, PRO_LIMITS, API_BASE, SERVER_MODEL, account, planOf, limitsOf, usesOwnKey, checkoutReady } from './service.js';
import { initAccount, signIn, signOut, accessToken, usedToday, openBilling, pendingInvite } from './account.js';

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
const TYPES = [['both', '選択式＋記述'], ['mcq', '選択式だけ'], ['sa', '記述だけ']];
const KINDS = [['all', 'すべて'], ['mcq', '選択式'], ['sa', '記述']];
const KIND_LABEL = { mcq: '選択式', sa: '記述' };
const QLANG = [['same', '資料と同じ'], ['en', '英語'], ['ja', '日本語'], ['zh', '中国語'], ['ms', 'マレー語']];
const ELANG = [['ja', '日本語'], ['en', 'English'], ['zh', '中文'], ['ms', 'Bahasa Melayu']];
const TR_LABEL = { ja: '日本語', zh: '中文', ms: 'Bahasa Melayu' };
const GRADE = { ok: { mark: '◎', label: '書けた', cls: 'ok' }, part: { mark: '△', label: '一部だけ', cls: 'part' }, ng: { mark: '✕', label: '書けなかった', cls: 'ng' } };
const PRICE_TEXT = `${PRICE.currency}${PRICE.amount}/${PRICE.per}`;

let settings = loadSettings();
// The interface language is also the default for explanations and translations.
function useLang(lang) {
  settings.eLang = lang;
  settings.trLangs = TR_LANGS.includes(lang) ? [lang] : [];
  if (TR_LANGS.includes(lang)) settings.showTr = lang;
  saveSettings(settings);
}
try { if (!localStorage.getItem('slide-drill-settings')) useLang(currentLang()); } catch (e) {}
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
const isPro = () => planOf(settings) === 'pro';
// Trial mode needs the visitor's API key; the service needs a signed-in account.
const canGenerate = () => (usesOwnKey() ? !!settings.apiKey : !!account.user);

const kindOf = q => (q.k === 'sa' ? 'sa' : 'mcq');
const trOf = (q, lang) => (q.tr && q.tr[lang]) || (lang === 'ja' ? q.ja || '' : '');
const deckLangs = d => TR_LANGS.filter(l => d.questions.some(q => trOf(q, l)));
// The translation language to show for this deck: the chosen one if the deck has it, else the first it has.
function activeTr(d) {
  if (settings.showTr === 'off') return 'off';
  const langs = deckLangs(d);
  return langs.includes(settings.showTr) ? settings.showTr : langs[0] || 'off';
}
function trLine(d, q) {
  const lang = activeTr(d);
  const t = lang === 'off' ? '' : trOf(q, lang);
  return t ? `<p class="ja" lang="${lang}">${esc(t)}</p>` : '';
}

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
  const c = { total: qs.length, answered: 0, hidden: deck.questions.length - qs.length, mcq: 0, sa: 0 };
  for (const [key] of POOLS) c[key] = 0;
  for (const q of qs) {
    const s = deck.stats[q.id];
    c[kindOf(q)]++;
    if (s && s.n) c.answered++;
    for (const [key] of POOLS) if (inPool(s, key, now)) c[key]++;
  }
  return c;
}

function prefsOf(deck) {
  return Object.assign({ src: 'all', kind: 'all', minP: 1, order: 'priority', pool: 'all', requeue: true }, deck.prefs || {});
}

function selectIds(deck, prefs) {
  const now = Date.now();
  let list = deck.questions.filter(q => !q.hidden && (prefs.src === 'all' || q.src === Number(prefs.src)) &&
    (prefs.kind === 'all' || kindOf(q) === prefs.kind) && q.p >= prefs.minP && inPool(deck.stats[q.id], prefs.pool, now));
  if (prefs.order === 'shuffle') list = shuffle(list);
  else if (prefs.order === 'source') list.sort((a, b) => a.src - b.src || (a.loc ?? 0) - (b.loc ?? 0));
  else list.sort((a, b) => b.p - a.p || a.src - b.src || (a.loc ?? 0) - (b.loc ?? 0));
  return list.map(q => q.id);
}

const permFor = q => (kindOf(q) === 'sa' ? null : shuffle(range(q.o.length)));

function startSession(deck, ids, label, requeue) {
  const byId = qmap(deck);
  deck.session = {
    queue: ids.slice(), perms: ids.map(id => permFor(byId[id])), results: ids.map(() => null),
    repeat: ids.map(() => false), shown: ids.map(() => false), drafts: ids.map(() => ''),
    extra: {}, idx: 0, requeue, label, done: false, startedAt: Date.now(),
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
  const route = !name || name === 'new' || name === 'deck' || name === 'play' ? 'home' : name;
  document.querySelectorAll('.topnav a').forEach(a => a.setAttribute('aria-current', a.dataset.route === route ? 'page' : 'false'));
}

async function render() {
  const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
  setNav(name);
  window.scrollTo(0, 0);
  try {
    if (name === 'new') return genJob ? renderGen() : (location.hash = '#/');
    if (name === 'import') return renderImport();
    if (name === 'plan') return renderPlan();
    if (name === 'settings') return renderSettings();
    if (name === 'account') return renderAccount();
    if (name === 'deck' || name === 'play') {
      if (!current || current.id !== id) current = await decks.get(id);
      if (!current) { location.hash = '#/'; return; }
      return name === 'deck' ? renderDeck() : renderPlay();
    }
    return renderHome();
  } catch (err) {
    view.innerHTML = `<section class="panel"><h1>読み込めませんでした</h1><p>${esc(err.message)}</p><p class="hint">プライベートブラウズでは保存が使えないことがあります。通常のウィンドウで開いてください。</p></section>`;
  }
}

/* ---------- home: upload first, library below ---------- */

function optsSummary() {
  const label = (list, key) => (list.find(x => x[0] === key) || [])[1] || '';
  const tr = settings.trLangs.filter(l => TR_LABEL[l]).map(l => TR_LABEL[l]).join('・') || 'なし';
  return `${label(TYPES, settings.types)} · ${DENSITY_LABEL[settings.density].split('（')[0]} · 訳：${tr} · 解説：${label(ELANG, settings.eLang)}`;
}

async function renderHome() {
  const list = (await decks.all()).sort((a, b) => (b.lastStudied || b.createdAt) - (a.lastStudied || a.createdAt));
  const running = genJob && genJob.running;
  view.innerHTML = `
    <section class="hero">
      <p class="eyebrow">Mr.MCQuuu</p>
      <h1>授業スライドを入れるだけで、テスト対策の問題集に。</h1>
      <p class="lede">PDF や PowerPoint を下の枠に入れると、選択問題（MCQ）と短い記述問題を重要度順に作ります。答えるとすぐに正誤・解説・スライドの該当箇所が出て、まちがえた問題は自動で復習に回ります。</p>
    </section>
    ${running ? `<section class="panel notice"><p><b>「${esc(genJob.title)}」の問題を作っています。</b></p><div class="row-btns"><a class="btn" href="#/new">進み具合を見る</a></div></section>` : `
    <section class="panel">
      <label class="drop" id="drop" for="file-input">
        <input type="file" id="file-input" multiple accept=".pdf,.pptx,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,.gif">
        <b>ここに授業のファイルをドロップ</b>
        <span>またはクリックして選ぶ（PDF・PPTX・DOCX・TXT・MD・画像）。1つの授業のファイルをまとめて入れると、1つの問題集になります。</span>
      </label>
      <ul class="file-list" id="file-list"></ul>
      <p class="plan-line" id="plan-line"></p>
    </section>
    <details class="panel opts" id="opts">
      <summary><h2>作り方の設定</h2><span class="hint" id="opts-sum">${esc(optsSummary())}</span></summary>
      <label class="field"><span>問題集の名前</span><input id="deck-title" type="text" placeholder="空欄なら最初のファイル名"></label>
      <div class="field"><span>問題の種類</span><div class="chips">${TYPES.map(([k, l]) => chip('types', k, l, settings.types === k)).join('')}</div></div>
      <div class="field"><span>問題の量</span><div class="chips">${Object.keys(DENSITY).map(k => chip('density', k, DENSITY_LABEL[k], settings.density === k)).join('')}</div></div>
      <div class="field"><span>問題文の言語</span><div class="chips">${QLANG.map(([k, l]) => chip('qLang', k, l, settings.qLang === k)).join('')}</div></div>
      <div class="field"><span>問題文につける訳（複数選べます）</span><div class="chips">${TR_LANGS.map(l => chip('trLangs', l, TR_LABEL[l], settings.trLangs.includes(l))).join('')}</div></div>
      <div class="field"><span>解説の言語</span><div class="chips">${ELANG.map(([k, l]) => chip('eLang', k, l, settings.eLang === k)).join('')}</div></div>
    </details>
    ${usesOwnKey() && !settings.apiKey ? `<section class="panel notice">
      <p><b>いまは試験運用中のため、問題を作るには Claude の API キーが必要です。</b></p>
      <div class="row-btns"><a class="btn" href="#/settings">API キーを入れる</a></div>
    </section>` : ''}
    ${!usesOwnKey() && account.ready && !account.user ? `<section class="panel notice">
      <p><b>問題を作るには、ログインが必要です（無料）。</b></p>
      <div class="row-btns"><a class="btn" href="#/account">ログインする</a></div>
    </section>` : ''}
    <div class="actions"><button type="button" class="btn big" id="go" data-act="generate" disabled>問題を作る</button></div>`}
    <section class="lib-head row-between">
      <h2>あなたの問題集</h2>
      <a class="btn ghost" href="#/import">ファイルから読み込む</a>
    </section>
    ${list.length ? `<ul class="deck-list">${list.map(deckCard).join('')}</ul>`
      : `<p class="hint">まだ問題集はありません。上の枠にファイルを入れて作るか、<button type="button" class="link inline" data-act="sample">サンプルの問題集で使い方を試せます</button>。</p>`}`;
  if (running) return;
  const input = $('#file-input');
  input.onchange = () => { addFiles(input.files); input.value = ''; };
  const drop = $('#drop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };
  renderFileList();
}

function deckCard(d) {
  const c = counts(d);
  const pct = c.total ? Math.round(c.answered / c.total * 100) : 0;
  return `<li><a class="deck-card" href="#/deck/${esc(d.id)}">
    <span class="deck-title">${esc(d.title)}</span>
    <span class="deck-meta">${c.total}問${c.sa ? `（選択式 ${c.mcq}・記述 ${c.sa}）` : ''} · ${esc(d.sources.map(s => s.name).join('、'))}</span>
    <span class="bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
    <span class="deck-chips">
      <span class="pill">解いた ${c.answered} / ${c.total}</span>
      ${c.weak ? `<span class="pill warn">苦手 ${c.weak}</span>` : ''}
      ${c.due ? `<span class="pill due">今日の復習 ${c.due}</span>` : ''}
      <span class="pill muted">最終学習 ${fmtDate(d.lastStudied)}</span>
    </span></a></li>`;
}

function addFiles(list) {
  for (const f of list) if (!pendingFiles.some(p => p.name === f.name && p.size === f.size)) pendingFiles.push(f);
  renderFileList();
}

function renderFileList() {
  const ul = $('#file-list');
  if (!ul) return;
  const lim = limitsOf(settings);
  const over = i => i >= lim.files;
  ul.innerHTML = pendingFiles.map((f, i) => `<li class="${over(i) ? 'locked' : ''}"><span class="fname"><span data-noi18n>${esc(f.name)}</span>${over(i) ? ` <span class="pill lock">${isPro() ? `1回に${PRO_LIMITS.files}ファイルまで` : 'Pro で使えます'}</span>` : ''}</span><span class="fsize">${fmtSize(f.size)}</span><button type="button" class="link" data-act="remove-file" data-i="${i}" aria-label="${esc(f.name)} を外す">外す</button></li>`).join('');
  const line = $('#plan-line');
  if (line) {
    line.innerHTML = isPro()
      ? `Pro プラン：1回に ${PRO_LIMITS.files} ファイルまでまとめて、すべてのスライドから作れます。`
      : `無料プラン：1回につき ${FREE_LIMITS.files} ファイル、最初の ${FREE_LIMITS.questions} 問まで作れます。<a href="#/plan">Pro（${PRICE_TEXT}）ですべて作る</a>`;
  }
  const go = $('#go');
  if (go) {
    go.textContent = isPro() ? '問題を作る' : `無料で ${FREE_LIMITS.questions} 問つくる`;
    go.disabled = !pendingFiles.length || !canGenerate();
  }
}

async function startGeneration() {
  const files = pendingFiles.slice();
  const lim = limitsOf(settings);
  const title = ($('#deck-title').value || '').trim() || files[0].name.replace(/\.[^.]+$/, '');
  const server = usesOwnKey() ? null : { baseURL: API_BASE, token: accessToken };
  const opts = { apiKey: settings.apiKey, server, model: server ? SERVER_MODEL : settings.model, effort: settings.effort, density: settings.density, types: settings.types,
    qLang: settings.qLang, eLang: settings.eLang, trLangs: settings.trLangs.slice(), limits: lim };
  genJob = { title, files, opts, plan: planOf(settings), controller: new AbortController(), running: true, startedAt: performance.now(), shown: 0, left: null, progress: { stage: 'read', file: files[0].name }, result: null, deckId: null };
  location.hash = '#/new';
  try {
    const res = await generate(files, opts, p => { genJob.progress = p; updateGen(); }, genJob.controller.signal);
    genJob.result = res;
    if (res.questions.length) {
      const deck = makeDeck({ title, sources: res.sources, questions: res.questions, meta: { model: opts.model, usage: res.usage, cost: costOf(opts.model, res.usage), createdWith: 'api', plan: genJob.plan } });
      await save(deck);
      genJob.deckId = deck.id;
      navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {});
    }
  } catch (err) {
    genJob.result = { questions: [], failures: [{ file: '', message: err.message }], usage: {} };
  }
  // Let the bar reach the end before the result replaces it.
  if (location.hash === '#/new' && $('#gen-bar') && !genJob.controller.signal.aborted) {
    clearInterval(genTimer);
    paintGenBar(100);
    await new Promise(r => setTimeout(r, 450));
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
  const lim = r.limited;
  const sa = r.questions.filter(q => q.k === 'sa').length;
  view.innerHTML = `
    <section class="page-head"><h1>${ok ? `${r.questions.length}問できました` : '問題を作れませんでした'}</h1>
      <p class="lede">${ok ? `「${esc(j.title)}」を保存しました（選択式 ${r.questions.length - sa} 問・記述 ${sa} 問）。${usesOwnKey() ? `費用の目安：${fmtCost(costOf(j.opts.model, r.usage || {}))}` : ''}` : '下の理由を確認して、もう一度試してください。'}</p></section>
    ${r.failures && r.failures.length ? `<section class="panel"><h2>うまくいかなかった部分</h2><ul class="fail-list">${r.failures.map(f => `<li><b>${esc(f.file)}</b> ${esc(f.message)}</li>`).join('')}</ul>${ok ? '<p class="hint">できた分の問題は保存されています。</p>' : ''}</section>` : ''}
    ${ok && lim && j.plan === 'free' ? `<section class="panel upsell">
      <h2>無料プランで作れるのはここまでです</h2>
      <p>${lim.more ? `<span>このファイルからは、あと約 ${lim.more} 問つくれます。</span>` : ''}${lim.skippedFiles.length ? `<span>今回使わなかったファイル：${esc(lim.skippedFiles.join('、'))}。</span>` : ''}<span>Pro にすると、複数のファイルをまとめて、すべてのスライドから問題を作れます。</span></p>
      <div class="row-btns"><a class="btn" href="#/plan">Pro にする（${PRICE_TEXT}）</a></div>
    </section>` : ''}
    ${ok && lim && j.plan === 'pro' && lim.skippedFiles.length ? `<section class="panel"><p>1回に入れられるのは ${PRO_LIMITS.files} ファイルまでです。使わなかったファイル：${esc(lim.skippedFiles.join('、'))}。</p></section>` : ''}
    <div class="actions row-btns">
      ${ok ? `<a class="btn big" href="#/deck/${esc(j.deckId)}">問題集を開く</a>` : ''}
      <button type="button" class="btn ghost" data-act="new-gen">${ok ? '別のファイルで作る' : 'やり直す'}</button>
    </div>`;
}

// The bar on the "making questions" screen. Claude sends nothing for a while and then a lot at once, and a
// long run is many calls of about a minute each, so real progress alone looks stuck. The bar is therefore
// driven by a clock that is tied to the real work:
// - a run is split evenly between its calls; inside a call the bar keeps creeping at the pace a call
//   usually takes (measured from the calls already finished), and jumps ahead when questions arrive;
// - the quick start is short for long runs (60% for one call, about 20% for nine), so the bar never
//   rushes ahead and then waits;
// - it never goes backwards and waits just below 100%.
let genTimer = 0;
const SEC_PER_QUESTION = 6.2; // measured: about 75 seconds for a 12-question call
function genState(j) {
  const now = performance.now();
  const p = j.progress;
  if (p.stage !== 'gen') return { frac: 0, span: 1, left: null };
  const active = p.active || [];
  const avgTarget = active.length ? active.reduce((n, a) => n + a.target, 0) / active.length : 12;
  const usual = p.callSecs || SEC_PER_QUESTION * avgTarget;
  let within = 0;
  for (const a of active) {
    const age = (now - a.startedAt) / 1000;
    within += Math.max(0.97 * (1 - Math.exp(-age / (0.6 * usual))), Math.min(0.97, a.count / Math.max(1, a.target)));
  }
  const lanes = Math.max(1, p.lanes || active.length);
  const left = Math.max(0, p.jobs - p.done - within) * usual / lanes;
  // span: how many calls long the run is when the calls in flight are counted as one step.
  return { frac: Math.min(1, (p.done + within) / p.jobs), span: p.jobs / lanes, left };
}
function genPercent(j) {
  const t = (performance.now() - j.startedAt) / 1000;
  const st = genState(j);
  const head = Math.max(12, Math.min(60, 60 / Math.sqrt(st.span)));
  const warm = 1 - Math.pow(1 - Math.min(1, t / 5), 3);
  j.left = st.left;
  j.shown = Math.max(j.shown || 0, Math.min(97, (head + (97 - head) * st.frac) * warm));
  return j.shown;
}
// What the screen says is happening; it changes every few seconds so the page is visibly alive.
const GEN_STEPS = ['資料を読んでいます…', '大事なポイントを選んでいます…', '問題文を書いています…', '選択肢を作っています…', '解説を書いています…', '出典と照らし合わせています…'];
function genLeftText(sec) {
  if (sec == null) return '';
  return sec < 50 ? 'あと少しで終わります' : `残り 約 ${Math.max(1, Math.round(sec / 60))} 分`;
}
function paintGenBar(pct) {
  const bar = $('#gen-bar'), num = $('#gen-pct');
  if (bar) bar.style.width = `${pct}%`;
  if (num) num.textContent = `${Math.floor(pct)}%`;
  if (!genJob || pct >= 100) return;
  const step = $('#gen-step'), left = $('#gen-left');
  const k = Math.floor((performance.now() - genJob.startedAt) / 4500) % GEN_STEPS.length;
  if (step && step.dataset.k !== String(k)) { step.dataset.k = String(k); step.textContent = genJob.progress.stage === 'gen' ? GEN_STEPS[k] : ''; }
  const txt = genLeftText(genJob.left);
  if (left && left.dataset.t !== txt) { left.dataset.t = txt; left.textContent = txt; }
}
function startGenTicker() {
  clearInterval(genTimer);
  genTimer = setInterval(() => {
    if (!genJob || !genJob.running || !$('#gen')) { clearInterval(genTimer); return; }
    paintGenBar(genPercent(genJob));
  }, 100);
}

function updateGen() {
  const el = $('#gen');
  if (!el || !genJob) return;
  const p = genJob.progress;
  if (!$('#gen-bar')) {
    el.innerHTML = `<p class="gen-now" id="gen-now"></p>
      <div class="gen-bar-row"><div class="bar"><i id="gen-bar"></i></div><b class="gen-pct" id="gen-pct" data-noi18n>0%</b></div>
      <p class="gen-live"><span class="gen-dot" aria-hidden="true"></span><span id="gen-step"></span><span class="gen-left" id="gen-left"></span></p>
      <p class="gen-stats" id="gen-stats"></p>
      <p class="gen-away">☕ 待っていなくて大丈夫です。ほかのタブやアプリを使っていても作成は進みます。このページを閉じず、ネットにつないだままにして、あとで戻ってきてください。</p>
      <p class="hint">資料が多いと数分かかります。中止しても、それまでにできた問題は保存されます。</p>`;
    startGenTicker();
  }
  // Only touch the page when the wording changes, so the translator is not woken up for nothing.
  const now = p.stage === 'read' ? `ファイルを読み込み中：${p.file}` : `${p.file} の問題を作成中`;
  const stats = p.stage === 'read' ? '' : `${p.job} / ${p.jobs} 回目 ・ この範囲で ${p.count} 問 ・ これまでに ${p.total} 問`;
  if (el.dataset.now !== now) { el.dataset.now = now; $('#gen-now').textContent = now; }
  if (el.dataset.stats !== stats) { el.dataset.stats = stats; $('#gen-stats').textContent = stats; }
  paintGenBar(genPercent(genJob));
}

/* ---------- plan ---------- */

function renderPlan() {
  const pro = isPro();
  view.innerHTML = `
    <section class="page-head"><h1>プラン</h1><p class="lede">まずは無料で試せます。Pro にすると、授業のファイルをまとめて入れて、すべてのスライドから問題集を作れます。</p></section>
    <section class="plans">
      <div class="plan">
        <h2>Free</h2>
        <p class="price">${PRICE.currency}0</p>
        <ul>
          <li>1回につき ${FREE_LIMITS.files} ファイル</li>
          <li>1ファイルにつき最初の ${FREE_LIMITS.questions} 問</li>
          ${usesOwnKey() ? '' : `<li>1日 ${FREE_LIMITS.perDay} 回まで</li>`}
          <li>解説・出典・訳の表示</li>
          <li>まちがえた問題の復習</li>
        </ul>
        ${pro ? '' : '<span class="pill">いまのプラン</span>'}
      </div>
      <div class="plan pro">
        <h2>Pro</h2>
        <p class="price">${PRICE.currency}${PRICE.amount}<span>/${PRICE.per}</span></p>
        <ul>
          <li>月に ${PRO_LIMITS.questions} 問まで</li>
          <li>1回に ${PRO_LIMITS.files} ファイルまでまとめて1つの問題集に</li>
          <li>すべてのスライドから作成（選択式＋記述）</li>
          <li>日本語・中文・Bahasa Melayu の訳</li>
          <li>いつでも解約できます</li>
        </ul>
        ${pro ? '<span class="pill">いまのプラン</span>'
          : checkoutReady() ? '<button type="button" class="btn big" data-act="checkout">Pro にする</button>'
          : '<button type="button" class="btn big" disabled>お支払いは準備中です</button>'}
      </div>
    </section>
    <section class="panel">
      <h2>お支払いについて</h2>
      <p>Pro は月額 ${PRICE.currency}${PRICE.amount} です。解約するまで毎月自動で更新され、解約後も支払い済みの期間が終わるまで使えます。</p>
      <p class="hint">作れる量は毎月1日にもどります。使わなかった分は翌月に持ち越せません。</p>
      <p class="hint">対応予定の支払い方法：クレジットカード・デビットカード（毎月自動更新）。FPX（銀行）や Touch 'n Go eWallet などは準備中です。</p>
      <p class="hint"><a href="./legal/terms.html" target="_blank" rel="noopener">利用規約</a> · <a href="./legal/privacy.html" target="_blank" rel="noopener">プライバシーポリシー</a> · <a href="./legal/refund.html" target="_blank" rel="noopener">解約・返金について</a> · <a href="./legal/tokushoho.html" target="_blank" rel="noopener">特定商取引法に基づく表記</a></p>
    </section>`;
}

/* ---------- import / manual mode ---------- */

function renderImport() {
  view.innerHTML = `
    <section class="page-head"><h1>読み込む</h1></section>
    <section class="panel">
      <h2>問題集のファイルを読み込む</h2>
      <p>このアプリで書き出した <code>.json</code> ファイル（別のパソコンや友だちから受け取ったもの）を読み込みます。</p>
      <label class="btn ghost file-btn" for="deck-file">ファイルを選ぶ<input type="file" id="deck-file" accept=".json,application/json"></label>
    </section>
    ${usesOwnKey() ? `<section class="panel">
      <h2>Claude.ai などのチャットで作る（試験運用中だけの機能）</h2>
      <ol class="howto">
        <li>ホームの「作り方の設定」で種類・量・言語を選んでから、下のボタンで問題作成用のプロンプトをコピーします。</li>
        <li><a href="https://claude.ai/new" target="_blank" rel="noopener">Claude.ai</a> で新しいチャットを開き、スライドのファイルを添付して、プロンプトを貼り付けて送ります。</li>
        <li>返ってきた返答（JSON）をすべてコピーして、下の欄に貼り付けます。</li>
      </ol>
      <div class="row-btns"><button type="button" class="btn" data-act="copy-prompt">プロンプトをコピー</button></div>
      <textarea id="prompt-text" class="mono" rows="6" readonly hidden></textarea>
      <label class="field"><span>問題集の名前</span><input id="paste-title" type="text" placeholder="例：Front Office Topic 5"></label>
      <label class="field"><span>返ってきた JSON</span><textarea id="paste-json" class="mono" rows="8" placeholder='{"questions": [ ... ]}'></textarea></label>
      <div class="row-btns"><button type="button" class="btn" data-act="import-paste">取り込む</button></div>
      <p class="hint">チャットの返答が途中で切れたときは「続けて」と送り、最後まで出てからまとめて貼り付けてください。</p>
    </section>` : ''}`;
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
    const title = $('#paste-title').value.trim() || res.sources.map(s => s.name).join('、') || '貼り付けた問題集';
    const deck = makeDeck({ title, sources: res.sources, questions: res.questions, meta: { createdWith: 'manual' } });
    await save(deck);
    toast(`${res.questions.length}問を取り込みました${res.skipped ? `（形の崩れた ${res.skipped} 問は除外）` : ''}`);
    location.hash = `#/deck/${deck.id}`;
  } catch (err) {
    toast(err.message);
  }
}

/* ---------- account ---------- */

function setAccountNav() {
  const a = $('#nav-account');
  if (!a) return;
  a.hidden = usesOwnKey();
  a.textContent = account.user ? 'アカウント' : 'ログイン';
}

async function renderAccount() {
  if (usesOwnKey()) { location.hash = '#/'; return; }
  if (!account.ready) { view.innerHTML = '<p class="hint">読み込み中…</p>'; return; }
  if (!account.user) {
    view.innerHTML = `
      <section class="page-head"><h1>ログイン</h1><p class="lede">メールアドレスを入れると、ログイン用のリンクが届きます。パスワードは要りません。</p></section>
      ${pendingInvite() ? '<section class="panel"><p>🎟️ 招待コードを受け取りました。ログインすると Pro を無料で使えます。</p></section>' : ''}
      <section class="panel form">
        <label class="field"><span>メールアドレス</span><input id="login-email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com"></label>
        <div class="row-btns"><button type="button" class="btn" data-act="send-link">ログイン用のリンクを送る</button></div>
        <p class="status" id="login-status" role="status"></p>
        <p class="hint">続けると、ページ下の利用規約とプライバシーポリシーに同意したことになります。</p>
      </section>`;
    return;
  }
  const pro = isPro();
  view.innerHTML = `
    <section class="page-head"><h1>アカウント</h1></section>
    <section class="panel">
      <h2>ログイン中のアカウント</h2>
      <p data-noi18n>${esc(account.user.email || '')}</p>
      <p>いまのプラン：<b data-noi18n>${pro ? 'Pro' : 'Free'}</b></p>
      ${account.inviteResult === 'ok' ? '<p>🎟️ 招待コードで Pro になりました。</p>' : account.inviteResult === 'bad' ? '<p class="hint">招待コードが正しくありませんでした。</p>' : ''}
      ${pro && account.invited ? `<p class="hint">招待による Pro です（${esc(new Date(account.proUntil).toLocaleDateString('ja-JP'))} まで）。使ってみた感想をぜひ教えてください。</p>`
        : pro ? `<p class="hint">カードの変更や解約は、下のボタンから Stripe の画面で行えます。解約しても、支払い済みの期間が終わるまで Pro を使えます。</p><div class="row-btns"><button type="button" class="btn ghost" data-act="billing" data-route="portal">支払いと解約の管理</button></div>`
        : `<p class="hint" id="used-today"></p><div class="row-btns"><a class="btn" href="#/plan">プランを見る</a></div>`}
    </section>
    <section class="panel">
      <div class="row-btns"><button type="button" class="btn ghost" data-act="sign-out">ログアウト</button></div>
    </section>`;
  account.inviteResult = '';
  if (!pro) {
    const n = await usedToday().catch(() => null);
    const el = $('#used-today');
    if (el && n != null) el.textContent = `無料プランは1日 ${FREE_LIMITS.perDay} 回まで作れます。この24時間で ${n} 回使いました。`;
  }
}

/* ---------- settings ---------- */

function renderSettings() {
  view.innerHTML = `
    <section class="page-head"><h1>設定</h1></section>
    ${usesOwnKey() ? `<section class="panel form">
      <h2>Claude API キー（試験運用中）</h2>
      <p>サービスの準備が整うまでは、問題を作るのにあなた自身の API キーを使います。<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic Console</a> の「API Keys」で作成できます。利用料はあなたのアカウントに請求されます。</p>
      <label class="field"><span>API キー</span>
        <span class="key-row"><input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-..." value="${esc(settings.apiKey)}"><button type="button" class="btn ghost" data-act="toggle-key">表示</button></span>
      </label>
      <div class="row-btns">
        <button type="button" class="btn" data-act="save-key">保存</button>
        <button type="button" class="btn ghost" data-act="test-key">接続テスト</button>
        <button type="button" class="btn ghost" data-act="delete-key">キーを削除</button>
      </div>
      <p class="status" id="key-status" aria-live="polite"></p>
      <p class="hint">キーはこのブラウザ（localStorage）にだけ保存され、問題を作るときに Anthropic の API（api.anthropic.com）へ直接送られます。共用のパソコンでは、使い終わったら削除してください。</p>
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
      <h2>開発者向け</h2>
      <p>お支払いの仕組みができるまで、Pro の動きをこのブラウザだけで試すためのスイッチです。</p>
      <div class="chips">${chip('devPro', 'toggle', 'Pro として動かす（テスト用）', settings.devPro)}</div>
    </section>` : ''}
    <section class="panel form">
      <h2>データ</h2>
      <p>問題集と学習記録は、このブラウザの中（IndexedDB）にだけ保存されています。別のパソコンで使うときは、問題集の画面から書き出して、もう一台で読み込んでください。</p>
      <div class="row-btns"><button type="button" class="btn ghost danger" data-act="wipe">すべての問題集と設定を消す</button></div>
    </section>`;
  if ($('#model')) {
    $('#model').onchange = e => { settings.model = e.target.value; saveSettings(settings); toast('モデルを変更しました'); };
    $('#effort').onchange = e => { settings.effort = e.target.value; saveSettings(settings); toast('保存しました'); };
  }
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
  const langs = deckLangs(d);
  const tr = activeTr(d);
  view.innerHTML = `
    <p class="crumb"><a href="#/">← ホーム</a></p>
    <section class="page-head">
      <h1 id="deck-name">${esc(d.title)}</h1>
      <p class="lede">${d.questions.length}問${c.sa ? `（選択式 ${c.mcq}・記述 ${c.sa}）` : ''} · ${esc(d.sources.map(s => s.name).join('、'))} · 作成 ${fmtDate(d.createdAt)}${usesOwnKey() && d.meta && d.meta.cost != null ? ` · 生成費用の目安 ${fmtCost(d.meta.cost)}` : ''}</p>
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
      ${c.mcq && c.sa ? `<div class="row"><span class="row-label">形式</span><div class="chips">${KINDS.map(([k, l]) => chip('kind', k, l, prefs.kind === k, k === 'all' ? c.total : c[k])).join('')}</div></div>` : ''}
      <div class="row"><span class="row-label">重要度</span><div class="chips">${chip('minP', 3, '★★★ だけ', prefs.minP === 3)}${chip('minP', 2, '★★ 以上', prefs.minP === 2)}${chip('minP', 1, 'すべて', prefs.minP === 1)}</div></div>
      <div class="row"><span class="row-label">順番</span><div class="chips">${ORDERS.map(([k, l]) => chip('order', k, l, prefs.order === k)).join('')}</div></div>
      <div class="row"><span class="row-label">出題</span><div class="chips">${POOLS.map(([k, l]) => chip('pool', k, l, prefs.pool === k, c[k], !c[k] && prefs.pool !== k)).join('')}</div></div>
      <div class="row"><span class="row-label">復習</span><div class="chips">${chip('requeue', 'toggle', `まちがえた問題を${REQUEUE_GAP}問後にもう一度出す`, prefs.requeue)}</div></div>
      ${langs.length ? `<div class="row"><span class="row-label">訳</span><div class="chips">${chip('showTr', 'off', '表示しない', tr === 'off')}${langs.map(l => chip('showTr', l, TR_LABEL[l], tr === l)).join('')}</div></div>` : ''}
      <div class="actions"><button type="button" class="btn big" data-act="start" ${n ? '' : 'disabled'}>この条件で始める（${n}問）</button></div>
    </section>
    <details class="panel qlist">
      <summary><h2>問題の一覧</h2><span class="hint">正解・まちがいの回数つき${c.hidden ? `・除外 ${c.hidden}問` : ''}</span></summary>
      <ol>${d.questions.map(q => {
        const s = d.stats[q.id];
        const src = sourceLine(d, q);
        return `<li class="${q.hidden ? 'is-hidden' : ''}"><span class="ql-q">${esc(q.q)}</span>
          <span class="ql-a">${kindOf(q) === 'sa' ? `模範解答：${esc(q.m)}` : `正解：${esc(q.o[q.a])}`}</span>
          <span class="ql-m"><span class="pri p${q.p}">${PRI_LABEL[q.p]}</span> ${KIND_LABEL[kindOf(q)]} · ${esc(src.where)} ${s ? `· ○${s.c} ×${s.w}` : '· 未回答'}${isWeak(s) ? ' · <b class="warn-t">苦手</b>' : ''}
          ${q.hidden ? `<button type="button" class="link" data-act="unhide" data-id="${esc(q.id)}">除外をやめる</button>` : ''}</span></li>`;
      }).join('')}</ol>
    </details>
    ${d.meta && d.meta.plan === 'free' && !isPro() ? `<section class="panel upsell">
      <h2>この問題集は無料プランで作りました</h2>
      <p>最初の ${FREE_LIMITS.questions} 問だけが入っています。Pro にすると、同じファイルをもう一度入れて、すべてのスライドから作り直せます。</p>
      <div class="row-btns"><a class="btn" href="#/plan">Pro にする（${PRICE_TEXT}）</a></div>
    </section>` : ''}
    <section class="panel">
      <h2>この問題集</h2>
      <div class="row-btns">
        <button type="button" class="btn ghost" data-act="rename">名前を変える</button>
        <button type="button" class="btn ghost" data-act="export" data-stats="1">書き出す（学習記録つき）</button>
        <button type="button" class="btn ghost" data-act="export" data-stats="0">問題だけ書き出す（友だちに渡す用）</button>
        <button type="button" class="btn ghost" data-act="reset-stats">学習記録をリセット</button>
        <button type="button" class="btn ghost danger" data-act="delete-deck">問題集を削除</button>
      </div>
    </section>`;
}

/* ---------- play ---------- */

function sessionSummary(S) {
  const first = {}, last = {};
  S.queue.forEach((id, i) => { const r = S.results[i]; if (!r) return; if (!(id in first)) first[id] = r; last[id] = r; });
  const ids = Object.keys(first);
  const ok = ids.filter(id => first[id].ok).length;
  const wrong = ids.filter(id => !first[id].ok);
  const recovered = wrong.filter(id => last[id].ok);
  const unique = new Set(S.queue).size;
  return { first, answered: ids.length, ok, ng: wrong.length, wrong, recovered, unique, skipped: unique - ids.length };
}

function srcBox(d, q) {
  const src = sourceLine(d, q);
  return `<div class="src">
      <span class="src-head">出典</span>
      <span class="src-loc">${esc(src.file)}${src.where ? ' ／ ' + esc(src.where) : ''}${src.title ? `「${esc(src.title)}」` : ''}</span>
      ${q.quote ? `<p class="src-quote">${esc(q.quote)}</p>` : ''}
    </div>
    <button type="button" class="link" data-act="hide-q">この問題を今後出さない（内容がおかしいとき）</button>`;
}

function renderPlay() {
  const d = current;
  const S = d.session;
  if (!S || !S.queue.length) { location.hash = `#/deck/${d.id}`; return; }
  if (S.done) return renderResults();
  S.shown = S.shown || []; S.drafts = S.drafts || [];   // sessions saved before short-answer questions existed
  const byId = qmap(d);
  const id = S.queue[S.idx];
  const q = byId[id];
  const res = S.results[S.idx];
  const sum = sessionSummary(S);
  const pct = sum.answered / sum.unique * 100;
  const src = sourceLine(d, q);
  const last = S.idx === S.queue.length - 1;
  const comesBack = res && !res.ok && S.queue.indexOf(id, S.idx + 1) > -1;
  const again = comesBack ? '<span class="verdict-sub">少し後にもう一度出ます</span>' : '';
  let body;
  if (kindOf(q) === 'mcq') {
    const perm = S.perms[S.idx];
    const correctPos = perm.indexOf(q.a);
    const opts = perm.map((oi, pos) => {
      let cls = '', mark = '';
      if (res) {
        if (oi === q.a) { cls = ' is-correct'; mark = '正解'; }
        else if (pos === res.pick) { cls = ' is-wrong'; mark = 'あなたの回答'; }
        else cls = ' is-dim';
      }
      return `<li><button type="button" class="opt${cls}" data-act="answer" data-pos="${pos}" ${res ? 'disabled' : ''}><span class="k">${LETTERS[pos]}</span><span class="opt-t">${esc(q.o[oi])}</span><span class="mark">${mark}</span></button></li>`;
    }).join('');
    body = `<ol class="opts">${opts}</ol>
      ${res ? `<div class="fb">
        <p class="verdict ${res.ok ? 'ok' : 'ng'}">${res.ok ? '正解' : `不正解　正解は ${LETTERS[correctPos]}`}${again}</p>
        ${q.e ? `<p class="exp">${esc(q.e)}</p>` : ''}
        ${srcBox(d, q)}
      </div>` : ''}`;
  } else {
    const shown = !!S.shown[S.idx];
    body = `<div class="ans-area">
        <label for="sa-answer">自分の答え（書かずに頭の中で答えても大丈夫です）</label>
        <textarea id="sa-answer" ${shown ? 'disabled' : ''} placeholder="ここに答えを書く">${esc(S.drafts[S.idx] || '')}</textarea>
        ${shown ? '' : '<div class="row-btns"><button type="button" class="btn" data-act="reveal">模範解答を見る</button></div>'}
      </div>
      ${shown ? `<div class="fb">
        <div class="model"><span class="model-head">模範解答</span><p>${esc(q.m)}</p></div>
        ${q.pts && q.pts.length ? `<div><p class="hint">採点のポイント（これが入っていれば ◎）</p><ul class="pts">${q.pts.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
        ${q.e ? `<p class="exp">${esc(q.e)}</p>` : ''}
        ${res ? `<p class="verdict ${GRADE[res.grade].cls}">${GRADE[res.grade].mark} ${GRADE[res.grade].label}${again}</p>`
          : `<div class="grades" role="group" aria-label="自己採点">
              <button type="button" class="grade g-ok" data-act="grade" data-grade="ok">◎ 書けた <kbd>1</kbd></button>
              <button type="button" class="grade g-part" data-act="grade" data-grade="part">△ 一部だけ <kbd>2</kbd></button>
              <button type="button" class="grade g-ng" data-act="grade" data-grade="ng">✕ 書けなかった <kbd>3</kbd></button>
            </div>`}
        ${srcBox(d, q)}
      </div>` : ''}`;
  }
  view.innerHTML = `
    <p class="crumb"><a href="#/deck/${esc(d.id)}">← ${esc(d.title)}</a> <span class="muted">· ${esc(S.label)}</span></p>
    <section class="progress" aria-live="polite">
      <div class="progress-line"><span>問題 <b>${S.idx + 1}</b> / ${S.queue.length}${S.queue.length > sum.unique ? `（復習 +${S.queue.length - sum.unique}）` : ''}</span>
      <span>正解 <b>${sum.ok}</b>　まちがい <b>${sum.ng}</b>　正答率 <b>${sum.answered ? Math.round(sum.ok / sum.answered * 100) + '%' : '—'}</b></span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </section>
    <article class="card">
      <div class="meta">
        <span class="keytag">Q ${String(S.idx + 1).padStart(3, '0')}</span>
        <span class="pill">${KIND_LABEL[kindOf(q)]}</span>
        <span class="pri p${q.p}">${PRI_LABEL[q.p]}</span>
        ${S.repeat[S.idx] ? '<span class="pill warn">もう一度</span>' : ''}
        <span class="where">${esc(src.file)}${src.where ? ' ／ ' + esc(src.where) : ''}</span>
      </div>
      <p class="q">${esc(q.q)}</p>
      ${trLine(d, q)}
      ${body}
      <div class="nav">
        <div class="row-btns">
          <button type="button" class="btn ghost" data-act="prev" ${S.idx === 0 ? 'disabled' : ''}>← 前へ</button>
          ${res ? '' : '<button type="button" class="btn ghost" data-act="skip">スキップ</button>'}
        </div>
        <button type="button" class="btn" data-act="next" ${res ? '' : 'disabled'}>${last ? '結果を見る' : '次の問題 →'}</button>
      </div>
    </article>
    <p class="hint keys">選択式：<kbd>1</kbd>〜<kbd>5</kbd> / <kbd>A</kbd>〜<kbd>E</kbd> · 記述：<kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> で模範解答、<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> で採点 · <kbd>Enter</kbd> 次へ · <kbd>←</kbd> 前へ · <kbd>T</kbd> 訳の切り替え</p>`;
  if (res || S.shown[S.idx]) {
    const fb = $('.fb');
    if (fb && fb.getBoundingClientRect().bottom > window.innerHeight) fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// Records an answer to the current question and, when it was missed, queues it again a few questions later.
function finish(ok, result) {
  const d = current, S = d.session;
  const id = S.queue[S.idx];
  S.results[S.idx] = result;
  record(d, id, ok);
  if (!ok && S.requeue && (S.extra[id] || 0) < REQUEUE_MAX) {
    const at = Math.min(S.idx + 1 + REQUEUE_GAP, S.queue.length);
    S.queue.splice(at, 0, id);
    S.perms.splice(at, 0, permFor(qmap(d)[id]));
    S.results.splice(at, 0, null);
    S.repeat.splice(at, 0, true);
    S.shown.splice(at, 0, false);
    S.drafts.splice(at, 0, '');
    S.extra[id] = (S.extra[id] || 0) + 1;
  }
  d.lastStudied = Date.now();
  save(d);
  renderPlay();
}

function answer(pos) {
  const d = current, S = d.session;
  if (!S || S.done || S.results[S.idx]) return;
  const q = qmap(d)[S.queue[S.idx]];
  if (kindOf(q) !== 'mcq' || pos >= q.o.length) return;
  finish(S.perms[S.idx][pos] === q.a, { pick: pos, ok: S.perms[S.idx][pos] === q.a });
}

function keepDraft() {
  const ta = $('#sa-answer');
  const S = current && current.session;
  if (ta && S && !ta.disabled) S.drafts[S.idx] = ta.value;
}

function reveal() {
  const d = current, S = d.session;
  if (!S || S.done || S.shown[S.idx] || kindOf(qmap(d)[S.queue[S.idx]]) !== 'sa') return;
  keepDraft();
  S.shown[S.idx] = true;
  save(d);
  renderPlay();
}

function grade(g) {
  const S = current.session;
  if (!S || S.done || !S.shown[S.idx] || S.results[S.idx] || !GRADE[g]) return;
  finish(g === 'ok', { grade: g, ok: g === 'ok' });
}

function move(delta) {
  const S = current.session;
  keepDraft();
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
    const ids = Object.keys(sum.first).filter(id => byId[id] && byId[id].src === i);
    if (!ids.length) return '';
    const ok = ids.filter(id => sum.first[id].ok).length;
    return `<tr><td>${esc(s.name)}</td><td class="num">${ok} / ${ids.length}</td><td class="num">${Math.round(ok / ids.length * 100)}%</td></tr>`;
  }).join('');
  const hasSa = Object.keys(sum.first).some(id => byId[id] && kindOf(byId[id]) === 'sa');
  const weakNow = counts(d).weak;
  view.innerHTML = `
    <p class="crumb"><a href="#/deck/${esc(d.id)}">← ${esc(d.title)}</a></p>
    <article class="card">
      <p class="eyebrow">結果 · ${esc(S.label)}</p>
      <div class="score"><span class="score-big">${pct}%</span><span class="score-sub"><span>最初の回答で ${sum.ok} / ${sum.answered} 問正解</span>${hasSa ? '<span>（記述は ◎ だけを正解に数えます）</span>' : ''}${sum.skipped ? ` · <span>スキップ ${sum.skipped}</span>` : ''}${sum.recovered.length ? ` · <span>復習で ${sum.recovered.length} 問を取り返しました</span>` : ''}</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>ファイル</th><th class="num">正解</th><th class="num">正答率</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${sum.wrong.length ? `<h2>まちがえた問題（${sum.wrong.length}）</h2><ul class="wl">${sum.wrong.map(id => {
        const q = byId[id]; const src = sourceLine(d, q);
        const a = kindOf(q) === 'sa' ? `模範解答：${esc(q.m)}` : `正解：${esc(q.o[q.a])}`;
        const mark = kindOf(q) === 'sa' ? `${GRADE[sum.first[id].grade].mark} ` : '';
        return `<li><span class="wl-q">${mark}${esc(q.q)}</span><span class="wl-a">${a}</span><span class="wl-s">${esc(src.file)} ${esc(src.where)}${sum.recovered.includes(id) ? ' · 復習で正解' : ''}</span></li>`;
      }).join('')}</ul>` : '<p>まちがえた問題はありません。</p>'}
      <div class="nav">
        <div class="row-btns">
          <button type="button" class="btn ghost" data-act="again">同じ問題をもう一度</button>
          ${weakNow ? `<button type="button" class="btn ghost" data-act="quick" data-pool="weak">苦手をまとめて（${weakNow}問）</button>` : ''}
        </div>
        ${sum.wrong.length ? `<button type="button" class="btn" data-act="retry-wrong">まちがえた ${sum.wrong.length} 問を解き直す</button>` : `<a class="btn" href="#/deck/${esc(d.id)}">問題集に戻る</a>`}
      </div>
    </article>`;
}

/* ---------- sample deck ---------- */

function sampleDeck() {
  const src = [{ name: 'Mr.MCQuuu の使い方', kind: 'text', unitLabel: '項目', unitCount: 6 }];
  const Q = (loc, title, q, o, e, quote, p = 3) => ({ k: 'mcq', q, tr: {}, o, a: 0, e, p, src: 0, loc, title, quote });
  return makeDeck({
    title: 'サンプル：Mr.MCQuuu の使い方',
    sources: src,
    meta: { createdWith: 'sample' },
    questions: [
      Q(1, '苦手', '「苦手」に入るのはどんな問題？', ['1回以上まちがえて、まだ2回続けて正解していない問題', 'まだ一度も解いていない問題', '重要度が ★ の問題', '最後に正解した問題'], '一度でもまちがえると「苦手」に入り、2回続けて正解すると外れます。まだ解いていない問題は「まだ解いていない」に入ります。', 'まちがえた問題は、2回続けて正解するまで「苦手」に残ります。'),
      Q(2, '今日の復習', '「今日の復習」に出るのはどの問題？', ['前に解いた問題のうち、次の復習日が来たもの', '問題集のすべての問題', 'まだ解いていない問題だけ', '重要度 ★★★ の問題だけ'], '正解するたびに次の復習までの間隔が 1日→3日→7日→16日→35日 とのびます。まちがえるとすぐ復習に戻ります。', '正解すると次の復習日が先にのび、まちがえるとすぐに「今日の復習」に戻ります。'),
      Q(3, 'くり返し', '「まちがえた問題を4問後にもう一度出す」がオンのとき、まちがえた問題はどうなる？', ['4問ほど後にもう一度出る（1回の学習で最大2回まで）', '学習の最後にまとめて1回だけ出る', '次の日まで出ない', '問題集から消える'], 'その場で思い出し直せるように、少し間をあけてもう一度出します。結果画面には「復習で取り返した」数も出ます。', 'まちがえた問題は4問後にもう一度出ます（最大2回）。'),
      { k: 'sa', q: '記述問題は、どうやって正解・不正解を決める？', tr: {}, m: '答えを書いて（または頭の中で答えて）から模範解答を開き、採点のポイントと見比べて、自分で ◎・△・✕ をつける。', pts: ['先に自分で答える', '模範解答と採点のポイントを見る', '自分で ◎・△・✕ をつける', '△ と ✕ は復習に回る'], e: '◎ だけが正解として数えられ、△ と ✕ は「まちがえた問題」として少し後にもう一度出ます。', p: 3, src: 0, loc: 4, title: '記述問題', quote: '記述問題は、模範解答を見てから自分で採点します。' },
      Q(5, '別のパソコン', '別のパソコンで同じ問題集を続けるには？', ['問題集を「書き出す（学習記録つき）」で保存し、もう一台で読み込む', '同じ URL を開けば自動で同期される', '同じ Wi-Fi につなげば自動で同期される', 'ブラウザを再起動する'], 'データはブラウザごとに保存されるので、自動では同期されません。書き出したファイルを読み込めば、学習記録ごと移せます。', '別のパソコンで使うときは、問題集の画面から書き出して、もう一台で読み込んでください。', 2),
      Q(6, '訳', '問題文の下に出る訳の言語を切り替えるには？', ['問題集の画面の「訳」で選ぶか、解いている途中に T キーを押す', '問題集を作り直すしかない', 'ブラウザの言語設定を変える', '切り替えはできない'], '訳は問題を作るときに選んだ言語（日本語・中文・Bahasa Melayu）の分だけ入っています。その中から表示する言語を選べます。', '問題文につける訳（複数選べます）', 2),
    ],
  });
}

/* ---------- events ---------- */

document.addEventListener('input', e => { if (e.target.id === 'sa-answer') keepDraft(); });

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
    case 'generate': if (pendingFiles.length && canGenerate()) startGeneration(); break;
    case 'send-link': {
      const email = $('#login-email').value.trim();
      const st = $('#login-status');
      if (!/^\S+@\S+\.\S+$/.test(email)) { st.textContent = 'メールアドレスを入力してください。'; st.className = 'status bad-t'; break; }
      el.disabled = true;
      st.className = 'status'; st.textContent = '送信しています…';
      try {
        await signIn(email);
        st.textContent = 'メールを送りました。届いたリンクを開くとログインできます。'; st.className = 'status ok-t';
      } catch (err) {
        st.textContent = 'メールを送れませんでした。少し待ってから、もう一度試してください。'; st.className = 'status bad-t';
        el.disabled = false;
      }
      break;
    }
    case 'checkout':
    case 'billing': {
      if (!account.user) { location.hash = '#/account'; toast('先にログインしてください'); break; }
      el.disabled = true;
      try { await openBilling(act === 'checkout' ? 'checkout' : 'portal'); }
      catch (err) { el.disabled = false; console.error('billing', err); toast('お支払いの画面を開けませんでした。少し待ってから、もう一度試してください。'); const st = document.createElement('p'); st.className = 'status bad-t'; st.dataset.noi18n = ''; st.textContent = err.message; el.insertAdjacentElement('afterend', st); }
      break;
    }
    case 'sign-out': await signOut(); toast('ログアウトしました'); break;
    case 'cancel-gen': if (genJob && genJob.running) { genJob.controller.abort(); el.disabled = true; el.textContent = '中止しています…'; } break;
    case 'new-gen': genJob = null; location.hash = '#/'; break;
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
      const prefs = Object.assign(prefsOf(d), { src: 'all', kind: 'all', minP: 1, pool, order: 'priority' });
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
    case 'reveal': reveal(); break;
    case 'grade': grade(el.dataset.grade); break;
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
      h.innerHTML = `<input id="rename-input" type="text" value="${esc(d.title)}" aria-label="問題集の名前">`;
      const i = $('#rename-input'); i.focus(); i.select();
      const done = async () => { const v = i.value.trim(); if (v) { d.title = v; await save(d); } renderDeck(); };
      i.onkeydown = ev => { if (ev.key === 'Enter') done(); if (ev.key === 'Escape') renderDeck(); };
      i.onblur = done;
      break;
    }
    case 'export': {
      const withStats = el.dataset.stats === '1';
      const deck = { title: d.title, sources: d.sources, questions: d.questions.map(({ hidden, ...q }) => (withStats ? { hidden, ...q } : q)), meta: { createdWith: d.meta && d.meta.createdWith, plan: d.meta && d.meta.plan } };
      download(`${d.title.replace(/[\\/:*?"<>|]+/g, '_')}.slide-drill.json`, { format: 'slide-drill-deck', version: 2, exportedAt: new Date().toISOString(), deck, stats: withStats ? d.stats : undefined });
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
  const single = () => c.parentElement.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
  const sum = () => { const s = $('#opts-sum'); if (s) s.textContent = optsSummary(); };
  if (['density', 'qLang', 'eLang', 'types'].includes(g)) {
    settings[g] = v; saveSettings(settings); single(); sum();
    return;
  }
  if (g === 'trLangs') {
    settings.trLangs = settings.trLangs.includes(v) ? settings.trLangs.filter(l => l !== v) : TR_LANGS.filter(l => l === v || settings.trLangs.includes(l));
    saveSettings(settings);
    c.setAttribute('aria-pressed', String(settings.trLangs.includes(v))); sum();
    return;
  }
  if (g === 'devPro') { settings.devPro = !settings.devPro; saveSettings(settings); c.setAttribute('aria-pressed', String(settings.devPro)); toast(settings.devPro ? 'Pro として動かします（このブラウザだけ）' : '無料プランに戻しました'); return; }
  if (g === 'showTr') { settings.showTr = v; saveSettings(settings); return renderDeck(); }
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
  if (e.target && e.target.id === 'sa-answer') {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); reveal(); }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!location.hash.startsWith('#/play/') || !current || !current.session || current.session.done) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) return;
  const k = e.key.toLowerCase();
  const S = current.session;
  if (k === 't') {
    const cycle = ['off', ...deckLangs(current)];
    settings.showTr = cycle[(cycle.indexOf(activeTr(current)) + 1) % cycle.length];
    saveSettings(settings); renderPlay();
    return;
  }
  const q = qmap(current)[S.queue[S.idx]];
  const done = !!S.results[S.idx];
  if (kindOf(q) === 'mcq' && !done) {
    let pos = -1;
    if (/^[1-5]$/.test(k)) pos = Number(k) - 1;
    else if (/^[a-e]$/.test(k)) pos = 'abcde'.indexOf(k);
    if (pos >= 0) { e.preventDefault(); answer(pos); return; }
  }
  if (kindOf(q) === 'sa' && !done) {
    if (!S.shown[S.idx] && k === 'enter') { e.preventDefault(); reveal(); return; }
    if (S.shown[S.idx] && /^[1-3]$/.test(k)) { e.preventDefault(); grade(['ok', 'part', 'ng'][Number(k) - 1]); return; }
  }
  if ((k === 'enter' || k === 'arrowright') && done) { e.preventDefault(); move(1); return; }
  if (k === 'arrowleft' && S.idx > 0) { e.preventDefault(); move(-1); }
});

window.addEventListener('beforeunload', e => {
  if (genJob && genJob.running) { e.preventDefault(); e.returnValue = ''; }
});
window.addEventListener('langchange', e => {
  useLang(e.detail.lang);
  render();
});
window.addEventListener('hashchange', render);
setAccountNav();
render();
// When the sign-in state arrives or changes, redraw the screens that depend on it.
initAccount(() => {
  setAccountNav();
  const name = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (name.includes('access_token') || name.includes('error')) { location.hash = '#/account'; return; }
  // Invite links: send the visitor to sign in, and show the result after redeeming.
  if ((pendingInvite() && !account.user) || account.inviteResult) { if (name !== 'account') { location.hash = '#/account'; return; } }
  if (['', 'plan', 'account'].includes(name)) render();
});
