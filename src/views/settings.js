/* ============================================================
   Cairn — settings, support, suggestions, privacy, your data.
   ============================================================ */
import { CONFIG } from '../../config.js';
import { el } from '../util.js';
import { store, prefs, auth, cloudCapable, isConfigured, exportAll, importAll, clearEverything, submitSuggestion } from '../store.js';
import { modal, toast, confirmDialog } from '../ui.js';
import { emailAvailable, loadEmailPrefs, saveEmailPrefs, EMAIL_KINDS, CADENCES } from '../emails.js';

export function renderSettings(root, ctx) {
  const wrap = el('div', { class: 'wrap' });

  wrap.append(el('div', { class: 'page-head' },
    el('div', { class: 'eyebrow', text: 'Settings' }),
    el('h1', { class: 'page-title', text: 'Yours to adjust' }),
  ));

  /* ---------- account ---------- */
  wrap.append(el('div', { class: 'section-label', text: 'Account' }));
  const account = el('div', { class: 'card card-pad' });

  if (store.user) {
    account.append(row(
      store.user.email || 'Signed in',
      'Your prayers and journal sync to every browser you sign in from.',
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => auth.signOut().then(() => ctx.rerender()) }, 'Sign out'),
    ));
  } else if (cloudCapable()) {
    account.append(row(
      'Not signed in',
      'Everything is saved in this browser only. Sign in to carry it with you.',
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => ctx.showAuth() }, 'Sign in'),
    ));
  } else {
    account.append(row(
      'Saving to this browser',
      isConfigured()
        ? 'Sync is configured but could not be reached. Your data is safe in this browser in the meantime.'
        : 'Cloud sync is not set up yet. Everything works, it just lives in this browser. Export a backup any time below.',
      null,
    ));
  }
  wrap.append(account);

  /* ---------- appearance ---------- */
  wrap.append(el('div', { class: 'section-label', text: 'Appearance' }));
  const theme = prefs.get('theme', 'system');
  const appearance = el('div', { class: 'card card-pad' });
  const themeSeg = el('div', { class: 'seg' },
    ...['light', 'dark', 'system'].map((t) =>
      el('button', {
        type: 'button', 'aria-pressed': String(theme === t),
        onclick: () => { prefs.set('theme', t); ctx.applyTheme(); ctx.rerender(); },
      }, t[0].toUpperCase() + t.slice(1)),
    ));
  appearance.append(row('Theme', 'Cairn follows your device by default.', themeSeg));
  wrap.append(appearance);

  /* ---------- email ---------- */
  wrap.append(el('div', { class: 'section-label', text: 'Email' }));
  wrap.append(emailCard(ctx));

  /* ---------- support ---------- */
  wrap.append(el('div', { class: 'section-label', text: 'Support & community' }));
  const support = el('div', { class: 'card card-pad' });

  support.append(row(
    'Support the creator',
    'Cairn is free and has no ads. If it is useful to you, a one-time gift keeps it running.',
    el('a', { class: 'btn btn-primary btn-sm', href: CONFIG.kofiUrl, target: '_blank', rel: 'noopener' }, '♥ Ko-fi'),
  ));

  support.append(row(
    'Suggest a feature',
    'Tell me what is missing. I read every one of these.',
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => suggestModal() }, 'Send an idea'),
  ));

  if (CONFIG.emailListAction) {
    const email = el('input', { class: 'field', type: 'email', name: 'email', placeholder: 'you@example.com', required: true, style: 'max-width:230px' });
    const form = el('form', {
      class: 'row', action: CONFIG.emailListAction, method: 'post', target: '_blank',
      style: 'gap:8px', onsubmit: () => setTimeout(() => toast('Thanks, check your inbox to confirm.'), 200),
    }, email, el('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Join'));
    support.append(row('Occasional updates', 'A short email when something new ships. No spam, unsubscribe any time.', form));
  }

  if (CONFIG.social?.url) {
    support.append(row(CONFIG.social.label || 'Follow along', 'Come say hello.',
      el('a', { class: 'btn btn-ghost btn-sm', href: CONFIG.social.url, target: '_blank', rel: 'noopener' }, 'Open')));
  }
  wrap.append(support);

  /* ---------- privacy ---------- */
  wrap.append(el('div', { class: 'section-label', text: 'Privacy' }));
  wrap.append(el('div', { class: 'privacy' },
    el('div', { style: 'margin-bottom:8px' },
      el('strong', { text: 'Your prayers are yours.' }),
    ),
    el('div', { html:
      'There are no ads, no trackers, and no analytics in Cairn. Nothing you write is shown to anyone else, ever. There is no feed, no sharing, and no public wall. ' +
      (store.user
        ? 'Your entries are stored in your own row of the database, locked so that only your signed-in account can read them.'
        : 'Right now everything is stored in this browser and never leaves your device.') +
      ' You can export everything, or delete everything, at any time.',
    }),
  ));

  /* ---------- your data ---------- */
  wrap.append(el('div', { class: 'section-label', text: 'Your data' }));
  const data = el('div', { class: 'card card-pad' });

  data.append(row('Export a backup', 'Downloads everything as a single JSON file.',
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: doExport }, 'Export')));

  const fileInput = el('input', { type: 'file', accept: 'application/json', style: 'display:none' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0]; if (!f) return;
    try { importAll(JSON.parse(await f.text())); toast('Backup restored.'); ctx.rerender(); }
    catch (err) { toast(err.message || 'Could not read that file.'); }
    fileInput.value = '';
  });
  data.append(row('Restore a backup', 'Merges a previous export back in. Nothing is overwritten.',
    el('span', {}, fileInput, el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => fileInput.click() }, 'Choose file'))));

  data.append(row('Delete everything', 'Clears every prayer, entry and reading from this device.',
    el('button', {
      class: 'btn btn-danger btn-sm', type: 'button',
      onclick: () => confirmDialog({
        title: 'Delete everything?',
        subtitle: 'Every prayer, answered record and journal entry on this device. Export a backup first if you are not certain.',
        confirmLabel: 'Delete it all',
        onConfirm: () => { clearEverything(); toast('Cleared.'); ctx.rerender(); ctx.refreshChrome(); },
      }),
    }, 'Delete')));
  wrap.append(data);

  wrap.append(el('div', { style: 'text-align:center;margin-top:34px;font-size:12.5px;color:var(--muted)' },
    `${CONFIG.appName} · ${CONFIG.tagline}`,
  ));

  root.replaceChildren(wrap);
}

/* ============================================================
   Email.

   One switch per kind, a cadence for the check in, and a single
   pause that covers all of it. Every change saves the moment it
   is made, because a settings screen with a Save button is a
   settings screen people leave without saving.
   ============================================================ */
function emailCard(ctx) {
  const card = el('div', { class: 'card card-pad email-card' });

  if (!emailAvailable()) {
    card.append(row(
      'Sign in to turn on email',
      cloudCapable()
        ? 'Cairn needs an account to know where to write to. Nothing is sent unless you ask for it.'
        : 'Email needs cloud sync, which is not set up in this copy of Cairn.',
      cloudCapable()
        ? el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => ctx.showAuth() }, 'Sign in')
        : null,
    ));
    return card;
  }

  card.append(el('div', { class: 'set-s', text: 'Loading your settings…' }));

  loadEmailPrefs()
    .then((p) => {
      if (!p) {
        card.replaceChildren(el('div', { class: 'set-s', text: 'Your email settings could not be loaded right now. Try again in a moment.' }));
        return;
      }
      card.replaceChildren(...emailRows(p));
    })
    .catch(() => {
      card.replaceChildren(el('div', { class: 'set-s', text: 'Your email settings could not be loaded right now. Try again in a moment.' }));
    });

  return card;
}

function emailRows(p) {
  const parts = [];
  const kindRows = [];

  /* the master pause, first, so it is never hunted for */
  const pauseSwitch = toggle(!p.paused, (on) => {
    p.paused = !on;
    persist({ paused: p.paused });
    kindRows.forEach((r) => r.classList.toggle('is-dim', p.paused));
    toast(p.paused ? 'Email paused. Cairn will not write to you.' : 'Email on.');
  });
  parts.push(row(
    'Send me email',
    'One switch over everything below. Turn it off and Cairn goes quiet, without changing any of your other choices.',
    pauseSwitch,
  ));

  EMAIL_KINDS.forEach((k) => {
    const control = el('span', { class: 'email-control' });

    if (k.cadence) {
      let sw;
      const seg = el('div', { class: 'seg seg-sm' },
        ...CADENCES.map(([value, label]) =>
          el('button', {
            type: 'button', 'aria-pressed': String(p.checkin_every === value),
            onclick: (ev) => {
              p.checkin_every = value;
              persist({ checkin_every: value });
              [...seg.children].forEach((b) => b.setAttribute('aria-pressed', String(b === ev.currentTarget)));
              if (!p[k.key]) { /* choosing a cadence means you want it */
                p[k.key] = true;
                persist({ [k.key]: true });
                sw.querySelector('input').checked = true;
                seg.classList.remove('is-dim');
              }
            },
          }, label),
        ));
      if (!p[k.key]) seg.classList.add('is-dim');
      control.append(seg);

      sw = toggle(Boolean(p[k.key]), (on) => {
        p[k.key] = on;
        persist({ [k.key]: on });
        seg.classList.toggle('is-dim', !on);
      });
      control.append(sw);
    } else {
      control.append(toggle(Boolean(p[k.key]), (on) => {
        p[k.key] = on;
        persist({ [k.key]: on });
      }));
    }

    const r = row(k.title, k.sub, control);
    if (p.paused) r.classList.add('is-dim');
    kindRows.push(r);
    parts.push(r);
  });

  parts.push(el('div', { class: 'set-s', style: 'padding-top:14px',
    text: 'Every email carries a link that turns it off in one tap, no signing in. Your address is never sold, shared or handed to anyone.' }));

  return parts;
}

/* Saves quietly. A failure says so once rather than nagging. */
let saveTimer = null;
let pending = {};
function persist(patch) {
  pending = { ...pending, ...patch };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const body = pending; pending = {};
    saveEmailPrefs(body).catch(() => toast('That change could not be saved. Check your connection.'));
  }, 400);
}

function toggle(on, onChange) {
  const input = el('input', { type: 'checkbox' });
  input.checked = on;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'switch' }, input, el('span', { class: 'switch-track' }));
}

function row(title, sub, control) {
  return el('div', { class: 'set-row' },
    el('div', {},
      el('div', { class: 'set-t', text: title }),
      sub ? el('div', { class: 'set-s', text: sub }) : null,
    ),
    el('span', { class: 'spacer' }),
    control,
  );
}

function doExport() {
  const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cairn-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup downloaded.');
}

function suggestModal() {
  const ta = el('textarea', { class: 'field', rows: 5, 'data-autofocus': '', placeholder: 'What would make Cairn more useful to you?' });
  modal({
    title: 'Suggest a feature',
    subtitle: 'Short and specific is best. What were you trying to do?',
    content: ta,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Send', variant: 'primary',
        onClick: () => {
          const text = ta.value.trim();
          if (!text) return true;
          submitSuggestion(text)
            .then((how) => toast(how === 'email' ? 'Opening your email app…' : 'Sent. Thank you.'))
            .catch((err) => toast(err.message || 'Could not send that.'));
        },
      },
    ],
  });
}
