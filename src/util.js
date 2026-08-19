/* Small shared helpers. No dependencies. */

export const uid = () =>
  (crypto.randomUUID?.() ??
    'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

export const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
};

export const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* --- dates --------------------------------------------------- */
export const dayKey = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export const fmtDate = (iso, opts) =>
  new Date(iso).toLocaleDateString(undefined, opts ?? { month: 'short', day: 'numeric', year: 'numeric' });

export const fmtLongDate = (d = new Date()) =>
  d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/** "3 months", "2 years", "11 days" — the span between two dates. */
/** Reads naturally in a sentence: "4 months of waiting" / "answered the same day". */
export function waitText(fromIso, toIso) {
  const span = spanText(fromIso, toIso);
  return span === 'the same day' ? 'answered the same day' : `${span} of waiting`;
}

export function spanText(fromIso, toIso) {
  const a = new Date(fromIso), b = new Date(toIso);
  const days = Math.max(0, Math.round((b - a) / 86400000));
  if (days < 1) return 'the same day';
  if (days === 1) return '1 day';
  if (days < 45) return `${days} days`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
  const years = (days / 365.25);
  const r = years < 10 ? Math.round(years * 10) / 10 : Math.round(years);
  return `${r} year${r === 1 ? '' : 's'}`;
}

export function relativeYears(iso) {
  const then = new Date(iso), now = new Date();
  const years = now.getFullYear() - then.getFullYear();
  const sameDay = then.getMonth() === now.getMonth() && then.getDate() === now.getDate();
  return { years, sameDay };
}

export const dayOfYear = (d = new Date()) =>
  Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const debounce = (fn, ms = 400) => {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
  return wrapped;
};

export const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return 'Still awake';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good evening';
};
