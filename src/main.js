/* ============================================================
   Cairn — app shell: boot, theme, routing, auth screen.
   ============================================================ */
import { CONFIG } from '../config.js';
import { el } from './util.js';
import { initStore, store, prefs, prayers, auth, cloudCapable, onChange, net, pendingCount, flushOutbox } from './store.js';
import { applyIcons, toast, modal } from './ui.js';
import { renderToday } from './views/today.js';
import { renderWall } from './views/wall.js';
import { renderAnswered } from './views/answered.js';
import { renderJournal } from './views/journal.js';
import { renderSettings } from './views/settings.js';
import { renderCircles } from './views/circles.js';
import { renderUnsubscribe } from './views/unsubscribe.js';
import { renderStats } from './views/stats.js';
import { syncProfile, circles as circlesApi, circlesAvailable, pendingJoin } from './circles.js';

const ROUTES = {
  today: renderToday,
  wall: renderWall,
  answered: renderAnswered,
  journal: renderJournal,
  circles: renderCircles,
  settings: renderSettings,
  unsubscribe: renderUnsubscribe,
  stats: renderStats,
};

let current = { route: 'today', params: {} };
let teardown = null;

/* ---------- theme ---------- */
function applyTheme() {
  const pref = prefs.get('theme', 'system');
  const dark = pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#23222A' : '#FAF8F5');
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (prefs.get('theme', 'system') === 'system') applyTheme();
});

/* ---------- context handed to every view ---------- */
const ctx = {
  go(route, params = {}) {
    if (!ROUTES[route]) route = 'today';
    current = { route, params };
    if (joinTokenFromPath() || unsubscribeFromPath()) history.replaceState(null, '', '/');
    location.hash = route === 'today' ? '' : `#${route}`;
    render();
  },
  rerender: () => render(),
  refreshChrome,
  applyTheme,
  showAuth: () => showAuthScreen({ dismissible: true }),
};

function render() {
  teardown?.();
  const main = document.getElementById('main');
  main.replaceChildren();
  teardown = ROUTES[current.route](main, ctx, current.params) ?? null;
  applyIcons(main);
  refreshChrome();
  main.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

function refreshChrome() {
  document.querySelectorAll('[data-route]').forEach((b) => {
    if (b.dataset.route === current.route) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const n = prayers.answered().length;
  const badge = document.getElementById('answeredCount');
  if (badge) badge.textContent = n ? String(n) : '';

  drawNetStatus();

  const acct = document.getElementById('sidebarAccount');
  if (acct) {
    acct.replaceChildren();
    if (store.user) {
      const name = store.user.user_metadata?.full_name || store.user.email || 'Signed in';
      const pic = store.user.user_metadata?.avatar_url;
      const av = el('span', { class: 'avatar' });
      if (pic) av.append(el('img', { src: pic, alt: '', referrerpolicy: 'no-referrer' }));
      else av.textContent = name.slice(0, 1).toUpperCase();
      acct.append(av, el('span', { text: name.split(' ')[0], style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }));
    } else if (cloudCapable()) {
      acct.append(el('button', { type: 'button', text: 'Sign in to sync', onclick: () => showAuthScreen({ dismissible: true }) }));
    } else {
      acct.append(el('span', { text: 'Saved in this browser' }));
    }
  }
}

/* ============================================================
   Offline.

   Nothing is lost when the network goes, so this does not need
   to alarm anybody. It needs to do one thing: say plainly that
   the writing is safe and that it will go up on its own. The
   worst version of this bar is the one that makes somebody stop
   writing because they are not sure it counted.
   ============================================================ */
function netMessage({ offline, reallyOffline, waiting }) {
  const changes = `${waiting} ${waiting === 1 ? 'change' : 'changes'}`;
  if (net.syncing) return 'Syncing…';
  if (reallyOffline) {
    return waiting
      ? `Offline. ${changes} saved here, and they go up when you are back.`
      : 'Offline. Everything you write is saved here and goes up when you are back.';
  }
  if (offline) {
    // Connected to something, just not to Cairn. Say that, rather than
    // insisting they are offline while they are reading this online.
    return waiting
      ? `Cannot reach Cairn right now. ${changes} saved here.`
      : 'Cannot reach Cairn right now. Everything you write is saved here.';
  }
  return `${changes} still to sync.`;
}

function drawNetStatus() {
  const waiting = pendingCount();
  const offline = !net.online;
  /* Two different problems, and calling the second one the first is
     how you end up telling somebody on perfectly good wifi that they
     are offline. The browser knows whether it has a network; only the
     failed request knows whether Cairn's server answered. */
  const reallyOffline = offline && navigator.onLine === false;
  let bar = document.getElementById('netStatus');

  if (!offline && !waiting) { bar?.remove(); return; }

  if (!bar) {
    bar = el('div', { id: 'netStatus', class: 'netbar', role: 'status', 'aria-live': 'polite' });
    document.body.append(bar);
  }

  bar.classList.toggle('netbar-waiting', !offline);
  /* replaceChildren renders a literal "null" for a null child,
     unlike el(), which drops them. Filter before handing it over. */
  bar.replaceChildren(...[
    el('span', { class: 'netdot' }),
    el('span', { text: netMessage({ offline, reallyOffline, waiting }) }),
    !net.syncing
      ? el('button', {
          class: 'netbar-btn', type: 'button',
          onclick: async () => {
            net.online = true;              // give it the benefit of the doubt, then find out
            refreshChrome();
            await flushOutbox();
            refreshChrome();
          },
        }, 'Try now')
      : null,
  ].filter(Boolean));
}

/* ---------- auth screen ---------- */
function authCard({ dismissible }) {
  const card = el('div', { class: 'auth-card' });
  card.append(el('div', { class: 'auth-mark' }, markSvg(40)));
  card.append(el('h1', { class: 'auth-title', text: CONFIG.appName }));
  card.append(el('p', { class: 'auth-sub', text: CONFIG.tagline }));

  const actions = el('div', { class: 'auth-actions' });

  const google = el('button', { class: 'oauth-btn', type: 'button' }, googleSvg(), 'Continue with Google');
  google.addEventListener('click', async () => {
    google.disabled = true;
    try { await auth.signInWithGoogle(); }
    catch (err) { toast(err.message || 'Sign-in failed.'); google.disabled = false; }
  });
  actions.append(google);

  actions.append(el('div', { class: 'auth-div', text: 'or' }));

  const email = el('input', { class: 'field', type: 'email', placeholder: 'you@example.com', 'aria-label': 'Email address' });
  const emailBtn = el('button', {
    class: 'btn btn-ghost', type: 'button',
    onclick: async () => {
      const v = email.value.trim();
      if (!v || !v.includes('@')) return toast('Enter a valid email address.');
      emailBtn.disabled = true;
      try { await auth.signInWithEmail(v); toast('Check your inbox for a sign-in link.'); }
      catch (err) { toast(err.message || 'Could not send the link.'); }
      emailBtn.disabled = false;
    },
  }, 'Email me a sign-in link');
  actions.append(email, emailBtn);

  if (dismissible) {
    actions.append(el('button', {
      class: 'btn btn-quiet', type: 'button', style: 'margin-top:4px',
      onclick: () => { document.getElementById('modalRoot').hidden = true; document.getElementById('modalRoot').replaceChildren(); },
    }, 'Keep using this browser only'));
  }

  card.append(actions);
  card.append(el('p', { class: 'auth-foot', text: 'No ads. No trackers. Nothing you write is ever shown to anyone else.' }));
  return card;
}

function showAuthScreen({ dismissible = false } = {}) {
  const root = document.getElementById('modalRoot');
  const box = el('div', { class: 'modal', style: 'max-width:430px' }, authCard({ dismissible }));
  root.replaceChildren(box);
  root.hidden = false;
}

/* ---------- little svgs ---------- */
function markSvg(size = 32) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 32 32'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.innerHTML = `<ellipse cx="16" cy="24" rx="9.5" ry="3.6"/><ellipse cx="16" cy="17.4" rx="7" ry="3.1"/><ellipse cx="16" cy="11.6" rx="4.6" ry="2.6"/><ellipse cx="16" cy="6.8" rx="2.8" ry="1.8"/>`;
  return s;
}
function googleSvg() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '18'); s.setAttribute('height', '18');
  s.innerHTML = `<path fill="#4285F4" d="M22.5 12.2c0-.8-.1-1.4-.2-2.1H12v4h6a5.1 5.1 0 0 1-2.2 3.4v2.8h3.6c2.1-1.9 3.1-4.8 3.1-8.1z"/><path fill="#34A853" d="M12 23c2.9 0 5.4-1 7.2-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.6 1.1-2.8 0-5.2-1.9-6-4.4H2.3v2.9A10.9 10.9 0 0 0 12 23z"/><path fill="#FBBC05" d="M6 14.2a6.5 6.5 0 0 1 0-4.2V7.1H2.3a11 11 0 0 0 0 9.8L6 14.2z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3 .6 4.1 1.6l3.1-3.1A10.9 10.9 0 0 0 12 1 10.9 10.9 0 0 0 2.3 7.1L6 10a6.5 6.5 0 0 1 6-4.6z"/>`;
  return s;
}

/* ---------- routing ---------- */
function routeFromHash() {
  const r = (location.hash || '').replace('#', '').split('?')[0];
  return ROUTES[r] ? r : 'today';
}

/** /join/<token> is a real URL so it can be pasted into a message. */
function joinTokenFromPath() {
  const m = location.pathname.match(/^\/join\/([A-Za-z0-9_-]{8,})\/?$/);
  return m ? m[1] : null;
}

/** /unsubscribe/<token>?k=<kind> is what sits at the bottom of every
    email. It has to work signed out, so it is a real path too. */
function unsubscribeFromPath() {
  const m = location.pathname.match(/^\/unsubscribe\/([A-Za-z0-9]{32,})\/?$/);
  if (!m) return null;
  const k = new URLSearchParams(location.search).get('k');
  return { token: m[1], kind: k || null };
}
window.addEventListener('hashchange', () => {
  const r = routeFromHash();
  if (r !== current.route) { current = { route: r, params: {} }; render(); }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-route]');
  if (btn) ctx.go(btn.dataset.route);
});

/* ---------- boot ---------- */
(async function boot() {
  applyTheme();
  try {
    await initStore();
  } catch (err) {
    console.error('[cairn] init failed', err);
  }

  const support = document.getElementById('supportBtn');
  if (support) support.href = CONFIG.kofiUrl;

  const joinToken = joinTokenFromPath();
  const unsub = unsubscribeFromPath();
  if (joinToken) current = { route: 'circles', params: { join: joinToken } };
  else if (unsub) current = { route: 'unsubscribe', params: unsub };
  else current = { route: routeFromHash(), params: {} };
  document.getElementById('boot')?.remove();
  document.getElementById('app').hidden = false;
  applyIcons(document);
  render();
  onChange(() => refreshChrome());
  syncProfile().catch(() => {});
  resumePendingJoin();

  // First visit with sync available and nothing saved yet: offer to sign in.
  if (!unsub && cloudCapable() && !store.user && !prefs.get('seenAuth', false) && !prayers.all().length) {
    prefs.set('seenAuth', true);
    showAuthScreen({ dismissible: true });
  }

  // Only the deployed site has a service worker; the single-file preview does not.
  /* Somebody who clicked an invite, then signed in, should land inside the
     circle rather than back at square one holding a link they already used. */
  async function resumePendingJoin() {
    if (!circlesAvailable()) return;
    const token = pendingJoin.take();
    if (!token) return;
    try {
      const info = await circlesApi.preview(token);
      const id = await circlesApi.join(token);
      toast(info ? `You are in ${info.name}.` : 'You joined the circle.');
      ctx.go('circles', { id, name: info?.name });
    } catch {
      toast('That invite could not be used. Ask whoever sent it for a fresh link.');
    }
  }

  const hasManifest = !!document.querySelector('link[rel="manifest"]');
  if (hasManifest && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
