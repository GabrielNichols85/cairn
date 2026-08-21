/* ============================================================
   Cairn — data layer

   One API, two backends:
     • local  — localStorage. No account, works instantly, offline.
     • cloud  — Supabase. Google sign-in, syncs to every browser.

   Views never know which one is running. The app is fully usable
   before Supabase is configured, so nothing has to be rewritten
   when it is.
   ============================================================ */
import { CONFIG } from '../config.js';
import { uid, dayKey } from './util.js';

const LS = {
  prayers: 'cairn:v1:prayers',
  entries: 'cairn:v1:entries',
  readings: 'cairn:v1:readings',
  prefs: 'cairn:v1:prefs',
};

const readLS = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
};
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/* ================================================================
   Working offline.

   Two pieces, and both of them matter.

   The mirror is a copy of your cloud data kept in this browser.
   Without it, signing in and then losing the network means the
   app opens to an empty wall, which looks exactly like having
   lost everything.

   The outbox holds writes the server did not accept. A prayer
   typed on a plane is in memory and nowhere else until something
   remembers to send it later. That is the whole job.
   ================================================================ */
const uidKey = () => store.user?.id ?? 'anon';
const mirrorKey = (what) => `cairn:v1:mirror:${uidKey()}:${what}`;
const outboxKey = () => `cairn:v1:outbox:${uidKey()}`;

export const net = {
  online: typeof navigator === 'undefined' || navigator.onLine !== false,
  syncing: false,
};

const outbox = {
  all: () => readLS(outboxKey(), []),
  /* One entry per row. A prayer edited five times offline should
     arrive once, in its final state, not five times. */
  add(op) {
    const q = outbox.all().filter((x) => !(x.table === op.table && x.id === op.id));
    q.push(op);
    writeLS(outboxKey(), q);
    emit();
  },
  drop(op) {
    writeLS(outboxKey(), outbox.all().filter((x) => !(x.table === op.table && x.id === op.id)));
  },
  clear: () => writeLS(outboxKey(), []),
  count: () => outbox.all().length,
};
export const pendingCount = () => (cloud() ? outbox.count() : 0);

/** Send everything the server has not seen. Safe to call any time. */
export async function flushOutbox() {
  if (!cloud() || net.syncing) return 0;
  const queue = outbox.all();
  if (!queue.length) return 0;

  net.syncing = true;
  emit();
  let sent = 0;
  try {
    for (const op of queue) {
      try {
        const { error } = op.remove
          ? await store.sb.from(op.table).delete().eq('id', op.id)
          : await store.sb.from(op.table).upsert({ ...op.row, user_id: store.user.id });
        if (error) throw error;
        outbox.drop(op);
        net.online = true;
        sent++;
      } catch (err) {
        /* Still unreachable. Leave the rest for next time rather
           than hammering a network that is not there. */
        console.warn('[cairn] still queued', op.table, err?.message || err);
        break;
      }
    }
  } finally {
    net.syncing = false;
    emit();
  }
  return sent;
}

/* The browser's idea of "online" is only about the local network.
   A laptop on cafe wifi that never finished its captive portal is
   online by that measure and reaches nothing. So retry on a timer
   as well, quietly, and only while there is something to send. */
if (typeof window !== 'undefined') {
  setInterval(async () => {
    if (!cloud() || !outbox.count() || net.syncing) return;
    const sent = await flushOutbox();
    if (sent) { await loadAll(); emit(); }
  }, 60000);

  window.addEventListener('online', async () => {
    net.online = true;
    emit();
    const sent = await flushOutbox();
    if (sent) await loadAll();
    emit();
  });
  window.addEventListener('offline', () => { net.online = false; emit(); });
}

/* ---------- in-memory cache (source of truth for the UI) ---------- */
const cache = { prayers: [], entries: [], readings: [] };

export const store = {
  mode: 'local',          // 'local' | 'cloud'
  user: null,
  ready: false,
  sb: null,               // supabase client, when in cloud mode
  _listeners: new Set(),
};

export const isConfigured = () =>
  Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

export const onChange = (fn) => { store._listeners.add(fn); return () => store._listeners.delete(fn); };
const emit = () => store._listeners.forEach((f) => f());

/* ================================================================
   Supabase client — loaded from a CDN only when it's needed, so
   local mode has zero network dependencies.
   ================================================================ */
async function loadSupabase() {
  const sources = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
    'https://esm.sh/@supabase/supabase-js@2',
  ];
  let lastErr;
  for (const src of sources) {
    try {
      const mod = await import(/* @vite-ignore */ src);
      if (mod?.createClient) return mod.createClient;
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error('Could not load Supabase');
}

/* ================================================================
   init
   ================================================================ */
export async function initStore() {
  if (isConfigured()) {
    try {
      const createClient = await loadSupabase();
      store.sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      const { data } = await store.sb.auth.getSession();
      store.user = data?.session?.user ?? null;
      store.mode = 'cloud';
      store.sb.auth.onAuthStateChange(async (_evt, session) => {
        const before = store.user?.id ?? null;
        store.user = session?.user ?? null;
        if ((store.user?.id ?? null) !== before) { await loadAll(); emit(); }
      });
    } catch (err) {
      console.warn('[cairn] Supabase unavailable, falling back to this browser only.', err);
      store.mode = 'local';
    }
  }
  await loadAll();
  store.ready = true;
  /* Anything left over from the last visit goes up now. */
  flushOutbox().then((sent) => { if (sent) loadAll().then(emit); });
  return store;
}

async function loadAll() {
  if (store.mode === 'cloud' && store.user) {
    /* Show the mirror straight away, so there is never a blank
       wall while the network is being waited on. */
    readMirror();

    let p, e, r;
    try {
      [p, e, r] = await Promise.all([
        store.sb.from('prayers').select('*').order('created_at', { ascending: false }),
        store.sb.from('journal_entries').select('*').order('created_at', { ascending: false }),
        store.sb.from('readings').select('*').order('day_key', { ascending: false }).limit(400),
      ]);
    } catch (err) {
      console.warn('[cairn] could not reach the server, showing what is saved here', err);
      net.online = false;
      return;
    }

    /* A failed request and an empty account look identical if you
       only check .data. Check the error, and keep the mirror when
       something went wrong rather than wiping the screen. */
    if (p.error || e.error || r.error) {
      console.warn('[cairn] partial load, keeping the local copy', p.error || e.error || r.error);
      net.online = false;
      return;
    }
    net.online = true;

    cache.prayers = (p.data ?? []).map(fromRowPrayer);
    cache.entries = (e.data ?? []).map(fromRowEntry);
    cache.readings = (r.data ?? []).map(fromRowReading);

    /* Anything still waiting to be sent has to survive the refresh,
       or a reconnect would quietly undo the work done offline. */
    applyPending();
    writeMirror();
  } else {
    cache.prayers = readLS(LS.prayers, []);
    cache.entries = readLS(LS.entries, []);
    cache.readings = readLS(LS.readings, []);
  }
}

function readMirror() {
  cache.prayers = readLS(mirrorKey('prayers'), cache.prayers);
  cache.entries = readLS(mirrorKey('entries'), cache.entries);
  cache.readings = readLS(mirrorKey('readings'), cache.readings);
}
function writeMirror() {
  writeLS(mirrorKey('prayers'), cache.prayers);
  writeLS(mirrorKey('entries'), cache.entries);
  writeLS(mirrorKey('readings'), cache.readings);
}

/* Fold un-sent local work back over a fresh copy from the server. */
function applyPending() {
  const lists = { prayers: 'prayers', journal_entries: 'entries', readings: 'readings' };
  const back = { prayers: fromRowPrayer, journal_entries: fromRowEntry, readings: fromRowReading };
  outbox.all().forEach((op) => {
    const key = lists[op.table];
    if (!key) return;
    cache[key] = cache[key].filter((x) => x.id !== op.id);
    if (!op.remove && op.row) {
      const item = back[op.table](op.row);
      if (key === 'readings') cache[key].push(item); else cache[key].unshift(item);
    }
  });
}

/* ---------- row mappers (DB snake_case <-> app camelCase) ---------- */
const fromRowPrayer = (r) => ({
  id: r.id, body: r.body, x: r.x, y: r.y, color: r.color, status: r.status,
  createdAt: r.created_at, answeredAt: r.answered_at, answeredNote: r.answered_note,
});
const toRowPrayer = (p) => ({
  id: p.id, body: p.body, x: p.x, y: p.y, color: p.color, status: p.status,
  created_at: p.createdAt, answered_at: p.answeredAt, answered_note: p.answeredNote,
});
const fromRowEntry = (r) => ({
  id: r.id, kind: r.kind, title: r.title, body: r.body, items: r.items ?? [],
  prompts: r.prompts ?? [], createdAt: r.created_at, updatedAt: r.updated_at,
});
const toRowEntry = (e) => ({
  id: e.id, kind: e.kind, title: e.title, body: e.body, items: e.items,
  prompts: e.prompts, created_at: e.createdAt, updated_at: e.updatedAt,
});
const fromRowReading = (r) => ({ id: r.id, dayKey: r.day_key, reference: r.reference, completedAt: r.completed_at });
const toRowReading = (r) => ({ id: r.id, day_key: r.dayKey, reference: r.reference, completed_at: r.completedAt });

/* ---------- write-through helper ---------- */
const cloud = () => store.mode === 'cloud' && store.user;

async function push(table, row, { remove = false } = {}) {
  if (!cloud()) return;
  const op = { table, id: row.id, row: remove ? null : row, remove, at: Date.now() };

  if (!net.online) { outbox.add(op); return; }

  try {
    const { error } = remove
      ? await store.sb.from(table).delete().eq('id', row.id)
      : await store.sb.from(table).upsert({ ...row, user_id: store.user.id });
    if (error) throw error;
    outbox.drop(op);
  } catch (err) {
    /* Nothing is thrown at the person writing. Their work is in the
       outbox and in the mirror, and it goes up when the network does. */
    console.warn(`[cairn] queued for later: ${table}`, err?.message || err);
    net.online = false;
    outbox.add(op);
  }
}

/* ================================================================
   Auth
   ================================================================ */
export const auth = {
  async signInWithGoogle() {
    if (!cloudCapable()) throw new Error('Sign-in is not set up yet.');
    return store.sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
  },
  async signInWithEmail(email) {
    if (!cloudCapable()) throw new Error('Sign-in is not set up yet.');
    return store.sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
  },
  async signOut() {
    if (store.sb) await store.sb.auth.signOut();
    store.user = null;
    await loadAll();
    emit();
  },
};
const cloudCapable = () => store.mode === 'cloud' && store.sb;
export { cloudCapable };

/* ================================================================
   Prayers
   ================================================================ */
export const prayers = {
  active: () => cache.prayers.filter((p) => p.status === 'active'),
  answered: () => cache.prayers
    .filter((p) => p.status === 'answered')
    .sort((a, b) => new Date(b.answeredAt) - new Date(a.answeredAt)),
  all: () => cache.prayers,
  get: (id) => cache.prayers.find((p) => p.id === id),

  create({ body = '', x = 40, y = 40, color = 1 } = {}) {
    const p = {
      id: uid(), body, x, y, color, status: 'active',
      createdAt: new Date().toISOString(), answeredAt: null, answeredNote: null,
    };
    cache.prayers.unshift(p);
    persistPrayers(); push('prayers', toRowPrayer(p));
    emit();
    return p;
  },

  update(id, patch) {
    const p = cache.prayers.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, patch);
    persistPrayers(); push('prayers', toRowPrayer(p));
    emit();
    return p;
  },

  /** Move a prayer to the answered list. */
  markAnswered(id, note = '') {
    return prayers.update(id, {
      status: 'answered',
      answeredAt: new Date().toISOString(),
      answeredNote: note || null,
    });
  },

  reopen(id) {
    return prayers.update(id, { status: 'active', answeredAt: null, answeredNote: null });
  },

  remove(id) {
    const p = cache.prayers.find((x) => x.id === id);
    cache.prayers = cache.prayers.filter((x) => x.id !== id);
    persistPrayers(); if (p) push('prayers', { id }, { remove: true });
    emit();
    return p;
  },

  /** Put a deleted prayer back (used by the undo toast). */
  restore(p) {
    cache.prayers.unshift(p);
    persistPrayers(); push('prayers', toRowPrayer(p));
    emit();
  },
};
const persistPrayers = () =>
  writeLS(cloud() ? mirrorKey('prayers') : LS.prayers, cache.prayers);

/* ================================================================
   Journal
   ================================================================ */
export const journal = {
  all: () => cache.entries.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  ofKind: (kind) => journal.all().filter((e) => e.kind === kind),
  get: (id) => cache.entries.find((e) => e.id === id),

  create({ kind = 'open', title = '', body = '', items = [], prompts = [] } = {}) {
    const now = new Date().toISOString();
    const e = { id: uid(), kind, title, body, items, prompts, createdAt: now, updatedAt: now };
    cache.entries.unshift(e);
    persistEntries(); push('journal_entries', toRowEntry(e));
    emit();
    return e;
  },

  update(id, patch) {
    const e = cache.entries.find((x) => x.id === id);
    if (!e) return null;
    Object.assign(e, patch, { updatedAt: new Date().toISOString() });
    persistEntries(); push('journal_entries', toRowEntry(e));
    emit();
    return e;
  },

  remove(id) {
    const e = cache.entries.find((x) => x.id === id);
    cache.entries = cache.entries.filter((x) => x.id !== id);
    persistEntries(); if (e) push('journal_entries', { id }, { remove: true });
    emit();
    return e;
  },
};
const persistEntries = () =>
  writeLS(cloud() ? mirrorKey('entries') : LS.entries, cache.entries);

/* ================================================================
   Daily reading completion
   ================================================================ */
export const readings = {
  all: () => cache.readings,
  isDone: (key = dayKey()) => cache.readings.some((r) => r.dayKey === key && r.completedAt),

  setDone(key, reference, done) {
    const existing = cache.readings.find((r) => r.dayKey === key);
    if (done) {
      const row = existing ?? { id: uid(), dayKey: key, reference, completedAt: null };
      row.completedAt = new Date().toISOString();
      row.reference = reference;
      if (!existing) cache.readings.unshift(row);
      persistReadings(); push('readings', toRowReading(row));
    } else if (existing) {
      cache.readings = cache.readings.filter((r) => r.dayKey !== key);
      persistReadings(); push('readings', { id: existing.id }, { remove: true });
    }
    emit();
  },

  /** Consecutive days completed, counting back from today (or yesterday). */
  streak() {
    const done = new Set(cache.readings.filter((r) => r.completedAt).map((r) => r.dayKey));
    let n = 0;
    const d = new Date();
    if (!done.has(dayKey(d))) d.setDate(d.getDate() - 1);
    while (done.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  },

  totalDone: () => cache.readings.filter((r) => r.completedAt).length,
};
const persistReadings = () =>
  writeLS(cloud() ? mirrorKey('readings') : LS.readings, cache.readings);

/* ================================================================
   Preferences (always local — they're per-device by nature)
   ================================================================ */
export const prefs = {
  get: (k, d = null) => { const p = readLS(LS.prefs, {}); return k in p ? p[k] : d; },
  set: (k, v) => { const p = readLS(LS.prefs, {}); p[k] = v; writeLS(LS.prefs, p); },
};

/* ================================================================
   Feature suggestions
   ================================================================ */
export async function submitSuggestion(body) {
  if (cloud()) {
    const { error } = await store.sb.from('suggestions').insert({
      body, user_id: store.user.id,
    });
    if (error) throw error;
    return 'saved';
  }
  if (CONFIG.contactEmail) {
    const url = `mailto:${CONFIG.contactEmail}?subject=${encodeURIComponent('Cairn feature idea')}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank');
    return 'email';
  }
  throw new Error('No way to send suggestions is configured yet.');
}

/* ================================================================
   Export — your data is yours
   ================================================================ */
export function exportAll() {
  return {
    app: 'Cairn', version: 1, exportedAt: new Date().toISOString(),
    prayers: cache.prayers, journal: cache.entries, readings: cache.readings,
  };
}

export function importAll(payload, { merge = true } = {}) {
  if (!payload || payload.app !== 'Cairn') throw new Error('That does not look like a Cairn export.');
  const mergeBy = (a, b) => {
    const seen = new Set(a.map((x) => x.id));
    return a.concat((b ?? []).filter((x) => !seen.has(x.id)));
  };
  cache.prayers = merge ? mergeBy(cache.prayers, payload.prayers) : (payload.prayers ?? []);
  cache.entries = merge ? mergeBy(cache.entries, payload.journal) : (payload.journal ?? []);
  cache.readings = merge ? mergeBy(cache.readings, payload.readings) : (payload.readings ?? []);
  persistPrayers(); persistEntries(); persistReadings();
  if (cloud()) {
    cache.prayers.forEach((p) => push('prayers', toRowPrayer(p)));
    cache.entries.forEach((e) => push('journal_entries', toRowEntry(e)));
    cache.readings.forEach((r) => push('readings', toRowReading(r)));
  }
  emit();
}

export function clearEverything() {
  cache.prayers = []; cache.entries = []; cache.readings = [];
  writeLS(LS.prayers, []); writeLS(LS.entries, []); writeLS(LS.readings, []);
  writeLS(mirrorKey('prayers'), []); writeLS(mirrorKey('entries'), []); writeLS(mirrorKey('readings'), []);
  outbox.clear();
  emit();
}

/* used by the offline tests to force a refresh through the same path a reconnect takes */
export const __reloadForTest = async () => { await loadAll(); emit(); };
