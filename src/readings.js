/* ============================================================
   Cairn — daily scripture reading

   A 260-day plan: every chapter of the New Testament in order,
   paired with a Psalm.

   The plan advances by what you have READ, not by the calendar.
   Day 1 is your first day, whenever that is, and missing a week
   does not skip a week of the Bible — you pick up exactly where
   you left off. Nobody needs an app telling them they are behind.

   Passage text comes from bible-api.com (World English Bible —
   public domain, free, no key) and is cached in the browser, so a
   passage you have already opened works offline afterwards.
   ============================================================ */

const NT = [
  ['Matthew', 28], ['Mark', 16], ['Luke', 24], ['John', 21], ['Acts', 28],
  ['Romans', 16], ['1 Corinthians', 16], ['2 Corinthians', 13], ['Galatians', 6],
  ['Ephesians', 6], ['Philippians', 4], ['Colossians', 4], ['1 Thessalonians', 5],
  ['2 Thessalonians', 3], ['1 Timothy', 6], ['2 Timothy', 4], ['Titus', 3],
  ['Philemon', 1], ['Hebrews', 13], ['James', 5], ['1 Peter', 5], ['2 Peter', 3],
  ['1 John', 5], ['2 John', 1], ['3 John', 1], ['Jude', 1], ['Revelation', 22],
];

/** All 260 New Testament chapters, in canonical order. */
export const PLAN = NT.flatMap(([book, chapters]) =>
  Array.from({ length: chapters }, (_, i) => `${book} ${i + 1}`)
);

export const TRANSLATION = 'World English Bible';
export const TRANSLATION_SHORT = 'WEB';

const psalmFor = (index) => `Psalm ${(index % 150) + 1}`;

/**
 * Work out where the reader is.
 *
 * The plan advances by chapters finished, never by a clock. Miss a
 * week and you pick up where you left off; read three in an evening
 * and all three count. The only thing a calendar day is used for is
 * the streak, which is a record of days you showed up, not a gate on
 * what you are allowed to read.
 *
 * @param {{dayKey:string, reference:string, completedAt:string|null}[]} records
 * @param {string} todayKey
 * @param {{at?:number|null}} [opts]  at: show this chapter instead of the next unread one
 */
export function readingFor(records = [], todayKey, { at = null } = {}) {
  const done = records.filter((r) => r.completedAt);
  const doneRefs = new Set(done.map((r) => r.reference));

  // The first chapter not yet finished.
  let next = 0;
  while (next < PLAN.length && doneRefs.has(PLAN[next])) next++;
  const wrapped = next >= PLAN.length;
  if (wrapped) next = 0;

  const index = at === null ? next : Math.max(0, Math.min(PLAN.length - 1, at));
  const reference = PLAN[index];

  return {
    index,
    nextUnread: next,
    dayNumber: index + 1,
    total: PLAN.length,
    primary: reference,
    psalm: psalmFor(index),
    /** this particular chapter is finished */
    done: doneRefs.has(reference),
    /** anything at all was finished today, which is what the streak counts */
    doneToday: done.some((r) => r.dayKey === todayKey),
    /** how many were finished today, so the app can say "that's three" */
    countToday: done.filter((r) => r.dayKey === todayKey).length,
    finishedWholePlan: wrapped,
    nextUp: PLAN[(index + 1) % PLAN.length],
    completed: doneRefs.size,
  };
}

/* ---------- passage text ---------- */
const CACHE_KEY = 'cairn:v1:passages';
const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } };
const writeCache = (c) => {
  try {
    const keys = Object.keys(c);
    if (keys.length > 80) keys.slice(0, keys.length - 80).forEach((k) => delete c[k]);
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {}
};

/**
 * @returns {Promise<{reference:string, verses:{verse:number,text:string}[], translation:string}>}
 * @throws  when the passage can't be retrieved (caller shows the fallback)
 */
export async function fetchPassage(reference) {
  const cache = readCache();
  if (cache[reference]) return cache[reference];

  const url = `https://bible-api.com/${encodeURIComponent(reference)}?translation=web`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json?.verses?.length) throw new Error('No verses returned');
    const passage = {
      reference: json.reference ?? reference,
      translation: json.translation_name ?? TRANSLATION,
      verses: json.verses.map((v) => ({ verse: v.verse, text: (v.text || '').trim() })),
    };
    cache[reference] = passage;
    writeCache(cache);
    return passage;
  } finally {
    clearTimeout(timer);
  }
}

export const gatewayUrl = (reference) =>
  `https://www.biblegateway.com/passage/?search=${encodeURIComponent(reference)}&version=WEB`;
