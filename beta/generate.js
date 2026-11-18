// Reads lecture files in the browser and asks Claude to write MCQ questions from them.
// Nothing is uploaded anywhere except the Claude API call made with the user's own key.

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.0.0/+esm';
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

export const MODELS = {
  'claude-opus-5-5':   { label: 'Claude Opus 5.5（おすすめ・高品質）', in: 4,   out: 20,  cacheRead: 0.20, fallback: true },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5（速い・安い）',      in: 2,   out: 10,  cacheRead: 0.20, fallback: true },
  'claude-haiku-5-5':  { label: 'Claude Haiku 5.5（いちばん安い）',     in: 0.1, out: 0.5, cacheRead: 0.01, fallback: false },
};

export const DENSITY = { low: 1, normal: 2, high: 3 }; // questions per slide / page (per ~700 characters for text)
const MAX_PER_CALL = 40;
const PARALLEL_CALLS = 3; // calls in flight at once when the server does the generating
const SERVER_MAX_PER_CALL = 12; // the server has to finish one call within its time limit
const MAX_PDF_BYTES = 22 * 1024 * 1024; // base64 grows ~33%; the API request limit is 32 MB
const MAX_IMAGES_PER_CALL = 40;
const IMAGE_MAX_SIDE = 1280;

// Lets the browser test swap in a fake client.
export const deps = {
  // server {baseURL, token()}: send the request to the Slide Drill server, signed in, instead of to Anthropic.
  async createClient(apiKey, server) {
    const { default: Anthropic } = await import(SDK_URL);
    if (!server) return { client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }), Anthropic };
    const signed = async (url, init = {}) => {
      const headers = new Headers(init.headers);
      headers.delete('x-api-key');
      headers.set('Authorization', `Bearer ${await server.token()}`);
      return fetch(url, { ...init, headers });
    };
    return { client: new Anthropic({ apiKey: 'server', baseURL: server.baseURL, fetch: signed, maxRetries: 1, dangerouslyAllowBrowser: true }), Anthropic };
  },
};

export class GenError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/* ---------- loading helpers ---------- */

const loaded = {};
function loadScript(url) {
  if (!loaded[url]) {
    loaded[url] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error('ライブラリを読み込めませんでした。ネット接続を確認してください。'));
      document.head.appendChild(s);
    });
  }
  return loaded[url];
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function toJpegBase64(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  const out = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
  return blobToBase64(out);
}

/* ---------- file parsing ---------- */

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const parseXml = str => new DOMParser().parseFromString(str, 'application/xml');
const drawingParas = node => [...node.getElementsByTagNameNS(NS_A, 'p')]
  .map(p => [...p.getElementsByTagNameNS(NS_A, 't')].map(t => t.textContent).join('').trim())
  .filter(Boolean);
const relsOf = doc => [...doc.getElementsByTagNameNS(NS_REL, 'Relationship')].map(r => ({
  type: r.getAttribute('Type') || '', target: r.getAttribute('Target') || '', id: r.getAttribute('Id'), external: r.getAttribute('TargetMode') === 'External',
}));
function joinPath(dir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const out = [];
  for (const part of (dir + target).split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

export async function parseFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return parsePdf(file);
  if (ext === 'pptx') return parsePptx(file);
  if (ext === 'docx') return parseDocx(file);
  if (['txt', 'md', 'markdown', 'csv'].includes(ext)) return parseText(file, await file.text());
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return parseImage(file);
  if (['ppt', 'key', 'doc', 'pages'].includes(ext)) {
    throw new GenError('format', `${file.name}：この形式は直接読めません。PowerPoint・Keynote・Word で PDF（または .pptx / .docx）に書き出してから入れてください。`);
  }
  throw new GenError('format', `${file.name}：対応していない形式です（PDF / PPTX / DOCX / TXT / MD / 画像に対応）。`);
}

async function parsePdf(file) {
  if (file.size > MAX_PDF_BYTES) {
    throw new GenError('size', `${file.name}：PDF が大きすぎます（22MB まで）。ページを分けて書き出してください。`);
  }
  await loadScript(PDFJS_URL);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const unitCount = pdf.numPages;
  pdf.destroy && pdf.destroy();
  return { name: file.name, kind: 'pdf', unitLabel: 'ページ', unitCount, pdfBase64: await blobToBase64(file) };
}

async function parsePptx(file) {
  await loadScript(JSZIP_URL);
  const zip = await window.JSZip.loadAsync(file);
  const read = path => (zip.file(path) ? zip.file(path).async('string') : Promise.resolve(null));
  const presXml = await read('ppt/presentation.xml');
  const presRels = await read('ppt/_rels/presentation.xml.rels');
  if (!presXml || !presRels) throw new GenError('format', `${file.name}：PowerPoint ファイルとして読めませんでした。`);
  const byId = Object.fromEntries(relsOf(parseXml(presRels)).map(r => [r.id, joinPath('ppt/', r.target)]));
  const slidePaths = [...parseXml(presXml).getElementsByTagNameNS(NS_P, 'sldId')]
    .map(s => byId[s.getAttributeNS(NS_R, 'id')]).filter(Boolean);

  const slides = [];
  const mediaUse = {};
  for (const [i, path] of slidePaths.entries()) {
    const doc = parseXml(await read(path));
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    const relXml = await read(`${dir}_rels/${path.split('/').pop()}.rels`);
    let title = '';
    for (const sp of doc.getElementsByTagNameNS(NS_P, 'sp')) {
      const ph = sp.getElementsByTagNameNS(NS_P, 'ph')[0];
      const type = ph && ph.getAttribute('type');
      if (type === 'title' || type === 'ctrTitle') { title = drawingParas(sp).join(' '); break; }
    }
    const extra = [];
    const images = [];
    for (const rel of relXml ? relsOf(parseXml(relXml)) : []) {
      if (rel.external) continue;
      const target = joinPath(dir, rel.target);
      const kind = rel.type.split('/').pop();
      if (kind === 'diagramData') {
        const x = await read(target);
        if (x) extra.push('[図表の文字] ' + drawingParas(parseXml(x)).join(' / '));
      } else if (kind === 'notesSlide') {
        const x = await read(target);
        const notes = x ? drawingParas(parseXml(x)).filter(l => !/^\d+$/.test(l)) : [];
        if (notes.length) extra.push('[発表者ノート] ' + notes.join(' / '));
      } else if (kind === 'chart') {
        const x = await read(target);
        if (x) {
          const c = parseXml(x);
          const vals = [...c.getElementsByTagNameNS(NS_C, 'v')].map(v => v.textContent).slice(0, 60);
          extra.push('[グラフ] ' + [...drawingParas(c), ...vals].join(' / '));
        }
      } else if (kind === 'image') {
        images.push(target);
        mediaUse[target] = (mediaUse[target] || 0) + 1;
      }
    }
    slides.push({ n: i + 1, title, lines: drawingParas(doc), extra, imagePaths: images });
  }

  // Images: skip template decorations (reused on 3+ slides), icons, and formats the browser cannot draw.
  let budget = 120;
  for (const slide of slides) {
    const candidates = [];
    for (const p of slide.imagePaths) {
      if (mediaUse[p] >= 3 || !/\.(png|jpe?g|gif|bmp|webp)$/i.test(p) || !zip.file(p)) continue;
      const bytes = await zip.file(p).async('uint8array');
      if (bytes.length < 15000) continue;
      candidates.push({ p, bytes });
    }
    candidates.sort((x, y) => y.bytes.length - x.bytes.length);
    slide.images = [];
    for (const c of candidates.slice(0, 3)) {
      if (budget <= 0) break;
      try {
        slide.images.push(await toJpegBase64(new Blob([c.bytes])));
        budget--;
      } catch (e) { /* undecodable image: skip */ }
    }
    delete slide.imagePaths;
  }
  return { name: file.name, kind: 'pptx', unitLabel: 'スライド', unitCount: slides.length, slides };
}

async function parseDocx(file) {
  await loadScript(JSZIP_URL);
  const zip = await window.JSZip.loadAsync(file);
  const x = zip.file('word/document.xml');
  if (!x) throw new GenError('format', `${file.name}：Word ファイルとして読めませんでした。`);
  const doc = parseXml(await x.async('string'));
  const paras = [...doc.getElementsByTagNameNS(NS_W, 'p')].map(p => {
    const style = p.getElementsByTagNameNS(NS_W, 'pStyle')[0];
    const val = style ? style.getAttributeNS(NS_W, 'val') || style.getAttribute('w:val') || '' : '';
    return { text: [...p.getElementsByTagNameNS(NS_W, 't')].map(t => t.textContent).join('').trim(), heading: /^(heading|title|見出し)/i.test(val) };
  }).filter(p => p.text);
  return textSource(file.name, paras);
}

function parseText(file, text) {
  const paras = text.split(/\n\s*\n/).map(t => t.trim()).filter(Boolean)
    .map(t => ({ text: t.replace(/^#+\s*/, ''), heading: /^#+\s/.test(t) }));
  return textSource(file.name, paras);
}

function textSource(name, paras) {
  if (!paras.length) throw new GenError('empty', `${name}：文字が見つかりませんでした。`);
  return { name, kind: 'text', unitLabel: '段落', unitCount: paras.length, paras: paras.map((p, i) => ({ n: i + 1, ...p })) };
}

async function parseImage(file) {
  return { name: file.name, kind: 'image', unitLabel: '画像', unitCount: 1, image: await toJpegBase64(file) };
}

/* ---------- planning ---------- */

export function planJobs(src, density, maxPerCall = MAX_PER_CALL) {
  const MAX_PER_CALL = maxPerCall;
  const per = DENSITY[density] || 2;
  const jobs = [];
  if (src.kind === 'pdf' || src.kind === 'pptx') {
    const size = Math.max(1, Math.min(src.kind === 'pdf' ? 30 : 25, Math.floor(MAX_PER_CALL / per)));
    for (let a = 1; a <= src.unitCount; a += size) {
      const b = Math.min(src.unitCount, a + size - 1);
      jobs.push({ from: a, to: b, target: clamp(Math.round((b - a + 1) * per), 3, MAX_PER_CALL) });
    }
  } else if (src.kind === 'text') {
    const charsPerQ = 700 / per;
    const maxChars = MAX_PER_CALL * charsPerQ;
    let start = 0, chars = 0;
    src.paras.forEach((p, i) => {
      chars += p.text.length;
      const last = i === src.paras.length - 1;
      if (chars >= maxChars || last) {
        jobs.push({ from: start + 1, to: i + 1, target: clamp(Math.round(chars / charsPerQ), 3, MAX_PER_CALL) });
        start = i + 1; chars = 0;
      }
    });
  } else {
    jobs.push({ from: 1, to: 1, target: clamp(per * 3, 3, 10) });
  }
  return jobs;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/* ---------- prompt ---------- */

import { SYSTEM_PROMPT, LANG_NAME, TR_LANGS, trLangsOf, buildSchema } from './supabase/functions/_shared/prompt.js';
export { SYSTEM_PROMPT, TR_LANGS, trLangsOf, buildSchema };

function languageLines(opts) {
  const q = opts.qLang === 'same' ? 'the same language as the material' : LANG_NAME[opts.qLang];
  const e = LANG_NAME[opts.eLang] || 'Japanese';
  const langs = trLangsOf(opts);
  const trans = langs.length
    ? `translations: translate the question stem (not the options) into ${langs.map(l => `${LANG_NAME[l]} (key "${l}")`).join(', ')}. Where the question is already in that language, use an empty string.\n`
    : '';
  const marker = { en: 'Note:', zh: '补充：', ms: 'Nota:' }[opts.eLang] || '補足：';
  return `Language of the question, options and model answer: ${q}.\nLanguage of the explanation and key_points: ${e}.\n${trans}Supplement marker: "${marker}"`;
}

// How a chunk's question count is split between the two types.
export function mix(target, types) {
  if (types === 'mcq') return { mcq: target, sa: 0 };
  if (types === 'sa') return { mcq: 0, sa: target };
  const sa = Math.max(1, Math.round(target * 0.25));
  return { mcq: Math.max(1, target - sa), sa };
}

const UNIT_EN = { pdf: 'page', pptx: 'slide', text: 'paragraph', image: 'image' };

function buildContent(src, job) {
  const blocks = [];
  if (src.kind === 'pdf') {
    blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: src.pdfBase64 }, title: src.name, cache_control: { type: 'ephemeral' } });
  } else if (src.kind === 'pptx') {
    let text = `File: ${src.name} (PowerPoint)\n`;
    let images = 0;
    for (const s of src.slides.slice(job.from - 1, job.to)) {
      text += `\n=== Slide ${s.n}${s.title ? ': ' + s.title : ''} ===\n${[...s.lines, ...s.extra].join('\n') || '(no text)'}\n`;
      for (const img of s.images || []) {
        if (images >= MAX_IMAGES_PER_CALL) break;
        blocks.push({ type: 'text', text: text + `(Image on slide ${s.n})` });
        blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
        text = '';
        images++;
      }
    }
    if (text) blocks.push({ type: 'text', text });
  } else if (src.kind === 'text') {
    const body = src.paras.slice(job.from - 1, job.to).map(p => `[¶${p.n}] ${p.heading ? '## ' : ''}${p.text}`).join('\n');
    blocks.push({ type: 'text', text: `File: ${src.name}\n\n${body}` });
  } else {
    blocks.push({ type: 'text', text: `File: ${src.name} (image 1)` });
    blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: src.image } });
  }
  return blocks;
}

function instruction(src, job, opts) {
  const unit = UNIT_EN[src.kind];
  const range = src.kind === 'pdf'
    ? `Write questions only about pages ${job.from}–${job.to} of the PDF above (page 1 is the first page of the file).`
    : src.kind === 'image' ? 'Write questions about the image above.' : `The material above is ${unit}s ${job.from}–${job.to}.`;
  const m = mix(job.target, opts.types);
  const ask = [m.mcq ? `${m.mcq} multiple-choice (type "mcq")` : '', m.sa ? `${m.sa} short-answer (type "short")` : ''].filter(Boolean).join(' and ');
  const amount = job.exact
    ? `Write exactly ${ask} questions: choose the points an exam is most likely to test across the whole range.`
    : `Write about ${ask} questions for this range. Write fewer if the range has less testable content; never pad with trivial questions.`;
  return `${range}\nUse the ${unit} numbers for source.location.\n${amount}\n${languageLines(opts)}`;
}

/* ---------- calling Claude ---------- */

async function callClaude(ctx, src, job, opts, signal, onCount) {
  const params = {
    model: opts.model,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    output_config: { effort: opts.effort, format: { type: 'json_schema', schema: buildSchema(opts) } },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [...buildContent(src, job), { type: 'text', text: instruction(src, job, opts) }] }],
  };
  // Server-side fallback: if a safety classifier declines, the API retries on a fallback model in the same call.
  if (MODELS[opts.model] && MODELS[opts.model].fallback) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  const stream = ctx.client.beta.messages.stream(params, { signal });
  stream.on('text', (_delta, snapshot) => onCount((snapshot.match(/"answer_index"/g) || []).length));
  let msg;
  try {
    msg = await stream.finalMessage();
  } catch (err) {
    // The server cuts a call that runs too long; runJob then tries again with half the range.
    if (opts.server && !err.status && !(signal && signal.aborted)) throw new GenError('max_tokens', 'サーバーの時間制限で途中で切れました。');
    throw err;
  }
  if (msg.stop_reason === 'refusal') throw new GenError('refusal', 'この範囲は安全上の理由で問題を作れませんでした。');
  if (msg.stop_reason === 'max_tokens') throw new GenError('max_tokens', '出力が長すぎて途中で切れました。');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new GenError('bad_json', '返ってきた問題データを読めませんでした。'); }
  return { questions: Array.isArray(data.questions) ? data.questions : [], usage: msg.usage || {} };
}

// Splits the range in half and tries again when the answer was cut off by max_tokens.
async function runJob(ctx, src, job, opts, signal, onCount) {
  try {
    return [await callClaude(ctx, src, job, opts, signal, onCount)];
  } catch (err) {
    if (err instanceof GenError && err.code === 'max_tokens' && job.to > job.from) {
      const mid = Math.floor((job.from + job.to) / 2);
      const half = n => Math.max(3, Math.round(job.target * n / (job.to - job.from + 1)));
      const a = { from: job.from, to: mid, target: half(mid - job.from + 1) };
      const b = { from: mid + 1, to: job.to, target: half(job.to - mid) };
      return [...await runJob(ctx, src, a, opts, signal, onCount), ...await runJob(ctx, src, b, opts, signal, onCount)];
    }
    throw err;
  }
}

const BANNED_OPTION = /^(all|none|both) of the above|^both [a-e] and [a-e]|上記(の)?(すべて|全て|いずれも)|すべて正しい/i;

// Deck question shape: k 'mcq' {o, a} or 'sa' {m, pts}; tr holds the stem translations by language.
export function normalizeQuestion(raw, srcIndex) {
  if (!raw || typeof raw.question !== 'string' || !raw.question.trim()) return null;
  const tr = {};
  for (const l of TR_LANGS) {
    const t = raw.translations && typeof raw.translations[l] === 'string' ? raw.translations[l].trim() : '';
    if (t) tr[l] = t;
  }
  if (!tr.ja && typeof raw.translation === 'string' && raw.translation.trim()) tr.ja = raw.translation.trim(); // older replies
  let body;
  if (raw.type === 'short') {
    const m = typeof raw.model_answer === 'string' ? raw.model_answer.trim() : '';
    if (!m) return null;
    const pts = Array.isArray(raw.key_points) ? raw.key_points.map(x => String(x).trim()).filter(Boolean).slice(0, 6) : [];
    body = { k: 'sa', m, pts };
  } else {
    if (!Array.isArray(raw.options)) return null;
    const o = raw.options.map(x => String(x).trim()).filter(Boolean);
    if (o.length !== raw.options.length || o.length < 3 || o.length > 5) return null;
    if (new Set(o.map(x => x.toLowerCase())).size !== o.length) return null;
    if (o.some(x => BANNED_OPTION.test(x))) return null;
    const a = raw.answer_index;
    if (!Number.isInteger(a) || a < 0 || a >= o.length) return null;
    body = { k: 'mcq', o, a };
  }
  const s = raw.source || {};
  return {
    q: raw.question.trim(),
    tr,
    ...body,
    e: typeof raw.explanation === 'string' ? raw.explanation.trim() : '',
    p: [1, 2, 3].includes(raw.priority) ? raw.priority : 2,
    src: srcIndex,
    loc: Number.isInteger(s.location) ? s.location : null,
    title: typeof s.title === 'string' ? s.title.trim() : '',
    quote: typeof s.quote === 'string' ? s.quote.trim() : '',
  };
}

export function costOf(model, usage) {
  const m = MODELS[model] || MODELS['claude-opus-5-5'];
  const u = usage;
  return ((u.input_tokens || 0) * m.in + (u.cache_creation_input_tokens || 0) * m.in * 1.25 +
    (u.cache_read_input_tokens || 0) * m.cacheRead + (u.output_tokens || 0) * m.out) / 1e6;
}

/**
 * Reads every file, then generates questions chunk by chunk.
 * onProgress receives {stage, file, job, jobs, count, total, message}.
 * opts.limits {files, questions} caps a free-plan run: only the first files are read, and only that many
 * questions are written (from the first chunk).
 * Returns {sources, questions, usage, failures, limited}.
 */
export async function generate(files, opts, onProgress, signal) {
  const sources = [];
  const failures = [];
  const lim = opts.limits || {};
  const skippedFiles = lim.files ? files.slice(lim.files).map(f => f.name) : [];
  if (lim.files) files = files.slice(0, lim.files);
  for (const file of files) {
    onProgress({ stage: 'read', file: file.name });
    try {
      sources.push(await parseFile(file));
    } catch (err) {
      failures.push({ file: file.name, message: err.message });
    }
  }
  if (!sources.length) return { sources, questions: [], usage: {}, failures };

  const ctx = await deps.createClient(opts.apiKey, opts.server);
  let plan = sources.flatMap((src, i) => planJobs(src, opts.density, opts.server ? SERVER_MAX_PER_CALL : MAX_PER_CALL).map(job => ({ src, srcIndex: i, job })));
  const possible = plan.reduce((n, s) => n + s.job.target, 0);
  if (lim.questions) plan = [{ ...plan[0], job: { ...plan[0].job, target: lim.questions, exact: true } }];
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const questions = [];

  // Several calls run at once (through the server; with the visitor's own key they stay one at a time
  // because of that key's rate limits). The first call for each file runs before the others for that
  // file, so that the file is cached once and the later calls read it from the cache.
  const limit = opts.server && !lim.questions ? PARALLEL_CALLS : 1;
  const results = new Array(plan.length);
  const pending = plan.map((_, k) => k);
  const active = new Map();
  const warmed = new Set(), warming = new Set();
  const callSecs = [];
  let done = 0, made = 0, stop = false;
  const report = () => {
    const a = [...active.values()];
    onProgress({
      stage: 'gen', file: a.length ? a[a.length - 1].label : '', jobs: plan.length, lanes: Math.min(limit, plan.length), done, job: Math.min(plan.length, done + 1),
      active: a.map(x => ({ startedAt: x.startedAt, count: x.count, target: x.target })),
      count: a.reduce((n, x) => n + x.count, 0), target: a.reduce((n, x) => n + x.target, 0), total: made,
      callSecs: callSecs.length ? callSecs.reduce((x, y) => x + y, 0) / callSecs.length : 0,
    });
  };
  await new Promise(resolve => {
    const start = k => {
      const step = plan[k];
      const label = `${step.src.name}（${step.src.unitLabel} ${step.job.from}${step.job.to > step.job.from ? '–' + step.job.to : ''}）`;
      const me = { label, startedAt: performance.now(), count: 0, target: step.job.target };
      active.set(k, me);
      report();
      runJob(ctx, step.src, step.job, opts, signal, n => { me.count = n; report(); }).then(parts => {
        results[k] = parts;
        callSecs.push((performance.now() - me.startedAt) / 1000);
        for (const part of parts) made += part.questions.length;
      }, err => {
        if (err instanceof ctx.Anthropic.APIUserAbortError || (signal && signal.aborted)) { stop = true; return; }
        failures.push({ file: label, message: explainError(err, ctx.Anthropic) });
        // A bad key, an empty balance or a used-up plan will fail every call the same way.
        if (err instanceof ctx.Anthropic.AuthenticationError || err instanceof ctx.Anthropic.PermissionDeniedError || serverError(err)) stop = true;
      }).finally(() => {
        active.delete(k);
        done++;
        warmed.add(step.srcIndex);
        report();
        pump();
      });
    };
    const pump = () => {
      if (signal && signal.aborted) stop = true;
      while (!stop && active.size < limit) {
        const at = pending.findIndex(k => warmed.has(plan[k].srcIndex) || !warming.has(plan[k].srcIndex));
        if (at < 0) break;
        const k = pending.splice(at, 1)[0];
        warming.add(plan[k].srcIndex);
        start(k);
      }
      if (!active.size) resolve();
    };
    pump();
  });
  for (const [k, parts] of results.entries()) {
    for (const part of parts || []) {
      for (const key of Object.keys(usage)) usage[key] += part.usage[key] || 0;
      for (const raw of part.questions) {
        const q = normalizeQuestion(raw, plan[k].srcIndex);
        if (q) questions.push(q);
      }
    }
  }
  // Drop the heavy payloads before the deck is saved.
  const slim = sources.map(s => ({ name: s.name, kind: s.kind, unitLabel: s.unitLabel, unitCount: s.unitCount }));
  if (lim.questions) questions.splice(lim.questions);
  const limited = lim.questions || skippedFiles.length ? { skippedFiles, possible, more: Math.max(0, possible - questions.length) } : null;
  return { sources: slim, questions, usage, failures, limited };
}

// Errors the Slide Drill server raises itself (sign-in, limits) carry a type starting with "sd_".
function serverError(err) {
  const body = err && err.error;
  const type = body && ((body.error && body.error.type) || body.type);
  return typeof type === 'string' && type.startsWith('sd_') ? type : '';
}
const SERVER_MESSAGE = {
  sd_sign_in: 'ログインが切れました。もう一度ログインしてください。',
  sd_quota_free: '無料プランの1日の上限に達しました。24時間たつと、また作れます。',
  sd_quota_pro: '今月の Pro の利用枠を使い切りました。来月1日にもどります。',
  sd_too_large: 'ファイルが大きすぎます。ページ数を減らすか、分けて入れてください。',
  sd_not_configured: 'サーバーの準備がまだ終わっていません。しばらくしてから試してください。',
};

export function explainError(err, Anthropic) {
  if (err instanceof GenError) return err.message;
  if (serverError(err)) return SERVER_MESSAGE[serverError(err)] || 'サーバーでエラーが起きました。';
  if (Anthropic) {
    if (err instanceof Anthropic.APIUserAbortError) return '中止しました。';
    if (err instanceof Anthropic.AuthenticationError) return 'API キーが正しくありません。設定画面でキーを確認してください。';
    if (err instanceof Anthropic.PermissionDeniedError) return 'この API キーではこのモデルを使えません。設定でモデルを変えるか、Anthropic Console で権限を確認してください。';
    if (err instanceof Anthropic.RateLimitError) return '利用量の上限（レート制限）に達しました。1〜2分待ってから、もう一度生成してください。';
    if (err instanceof Anthropic.BadRequestError) return `リクエストを受け付けてもらえませんでした（残高不足やファイルが大きすぎる場合など）：${err.message}`;
    if (err instanceof Anthropic.InternalServerError) return 'Anthropic 側で一時的なエラーが起きました。少し待ってから再実行してください。';
    if (err instanceof Anthropic.APIConnectionError) return 'Anthropic の API に接続できませんでした。ネット接続を確認してください。';
    if (err instanceof Anthropic.APIError) return `API エラー（${err.status}）：${err.message}`;
  }
  return err && err.message ? err.message : String(err);
}

export async function testKey(apiKey, model) {
  const ctx = await deps.createClient(apiKey);
  try {
    await ctx.client.models.retrieve(model);
    return { ok: true, message: 'API キーは有効です。このモデルを使えます。' };
  } catch (err) {
    return { ok: false, message: explainError(err, ctx.Anthropic) };
  }
}

/* ---------- manual mode (no API key) ---------- */

export function manualPrompt(opts) {
  const schema = buildSchema(opts);
  const src = schema.properties.questions.items.properties.source;
  src.properties.file = { type: 'string' };
  src.required.unshift('file');
  const per = DENSITY[opts.density] || 2;
  const kinds = opts.types === 'mcq' ? 'All questions are multiple-choice.' : opts.types === 'sa' ? 'All questions are short-answer.' : 'About three in four are multiple-choice and one in four is short-answer.';
  return `${SYSTEM_PROMPT}

Task
- The lecture files are attached to this message. Write about ${per} questions per slide or page with testable content, across all attached files. ${kinds}
- source.file: the file name the question comes from. source.location: the slide or page number within that file.
${languageLines(opts)}

Output
Reply with only one JSON object that matches this JSON Schema. No code fences, no text before or after it.
${JSON.stringify(schema)}`;
}

// Accepts a pasted reply (possibly wrapped in code fences) and returns {sources, questions}.
export function parseManualReply(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new GenError('bad_json', 'JSON が見つかりませんでした。返答をそのまま全部貼り付けてください。');
  let data;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch (e) {
    throw new GenError('bad_json', 'JSON の形が崩れています。返答が途中で切れていないか確認してください。');
  }
  const list = Array.isArray(data.questions) ? data.questions : [];
  const names = [];
  const questions = [];
  for (const raw of list) {
    const file = raw && raw.source && typeof raw.source.file === 'string' && raw.source.file.trim() ? raw.source.file.trim() : '貼り付けた問題';
    if (!names.includes(file)) names.push(file);
    const q = normalizeQuestion(raw, names.indexOf(file));
    if (q) questions.push(q);
  }
  if (!questions.length) throw new GenError('empty', '使える問題がありませんでした（選択肢が3〜5個で、正解番号が正しい問題だけを取り込みます）。');
  const sources = names.map(name => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return { name, kind: ext === 'pdf' ? 'pdf' : ext === 'pptx' ? 'pptx' : 'text', unitLabel: ext === 'pdf' ? 'ページ' : ext === 'pptx' ? 'スライド' : '箇所', unitCount: null };
  });
  return { sources, questions, skipped: list.length - questions.length };
}
