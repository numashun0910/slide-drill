// Decks live in this browser's IndexedDB; settings (API key, model, languages) in localStorage.

const DB_NAME = 'slide-drill';
const STORE = 'decks';
let opening = null;

function open() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return opening;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const decks = {
  all: () => run('readonly', s => s.getAll()),
  get: id => run('readonly', s => s.get(id)),
  put: deck => run('readwrite', s => s.put(deck)),
  remove: id => run('readwrite', s => s.delete(id)),
  clear: () => run('readwrite', s => s.clear()),
};

const SETTINGS_KEY = 'slide-drill-settings';
// types: 'both' | 'mcq' | 'sa'. trLangs: languages to translate question stems into. showTr: 'off' or the language shown while studying.
const DEFAULTS = { apiKey: '', model: 'claude-opus-5-5', effort: 'high', qLang: 'same', eLang: 'ja', density: 'normal', types: 'both', trLangs: ['ja'], showTr: 'ja', devPro: false };

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (stored.showJa === false && !stored.showTr) stored.showTr = 'off'; // setting from before translations had languages
    delete stored.showJa;
    return Object.assign({}, DEFAULTS, stored);
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
}

export function clearSettings() {
  try { localStorage.removeItem(SETTINGS_KEY); } catch (e) {}
}
