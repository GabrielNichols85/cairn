/* ============================================================
   Cairn, the unsubscribe page.

   This is the screen somebody lands on from a link at the bottom
   of an email, six months from now, on a phone, signed out. So it
   asks for nothing. No account, no password, no "log in to manage
   your preferences". The token in the link is the whole key, and
   it can only ever touch the one row it belongs to.

   The one thing it does not do is make you hunt. If the link said
   which email it came from, that one is already off by the time
   the page finishes loading, and everything else is left alone.
   ============================================================ */
import { el } from '../util.js';
import { store } from '../store.js';
import { EMAIL_KINDS, CADENCES, previewByToken, setByToken } from '../emails.js';
import { toast } from '../ui.js';

const LABEL = Object.fromEntries(EMAIL_KINDS.map((k) => [k.key, k.title]));

export function renderUnsubscribe(root, ctx, params = {}) {
  const token = params.token;
  const kind = EMAIL_KINDS.some((k) => k.key === params.kind) ? params.kind : null;

  const wrap = el('div', { class: 'wrap wrap-narrow' });
  const card = el('div', { class: 'card card-pad' },
    el('div', { class: 'set-s', text: 'One moment…' }),
  );
  wrap.append(
    el('div', { class: 'page-head' },
      el('div', { class: 'eyebrow', text: 'Email' }),
      el('h1', { class: 'page-title', text: 'Your email settings' }),
    ),
    card,
  );
  root.replaceChildren(wrap);

  if (!(store.mode === 'cloud' && store.sb)) {
    card.replaceChildren(el('div', { class: 'set-s', text: 'This link cannot be checked right now. You may be offline.' }));
    return;
  }

  (async () => {
    /* Act first, ask later. Somebody who clicked "unsubscribe" has
       already made their decision; making them click again is rude. */
    let acted = false;
    if (kind) {
      try { acted = await setByToken(token, kind, false); }
      catch { acted = false; }
    }

    const p = await previewByToken(token);
    if (!p) {
      card.replaceChildren(
        el('div', { class: 'set-t', text: 'That link has expired' }),
        el('div', { class: 'set-s', style: 'margin-top:6px',
          text: 'It may have been cut short by your email app. Open Cairn, sign in, and you can change all of this under Settings.' }),
        el('div', { style: 'margin-top:16px' },
          el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => ctx.go('settings') }, 'Open Cairn')),
      );
      return;
    }

    const parts = [];

    if (acted) {
      parts.push(el('div', { class: 'callout callout-good' },
        el('strong', { text: 'Done. ' }),
        `You will not get "${LABEL[kind]}" again.`,
        ' ',
        el('button', {
          class: 'link-btn', type: 'button',
          onclick: async (e) => {
            try {
              await setByToken(token, kind, true);
              e.currentTarget.replaceWith(el('span', { text: 'Put back.' }));
              const box = card.querySelector(`input[data-kind="${kind}"]`);
              if (box) box.checked = true;
              toast('Put back on.');
            } catch { toast('That could not be changed. Try the switch below.'); }
          },
        }, 'Undo'),
      ));
    }

    parts.push(el('div', { class: 'set-s', style: 'margin-bottom:4px' },
      p.masked_email ? `Settings for ${p.masked_email}` : 'Settings for this address'));

    /* the master pause */
    parts.push(switchRow({
      title: 'Send me email',
      sub: 'One switch over everything. Off means Cairn goes completely quiet.',
      on: !p.paused, kind: 'all', token,
      onSaved: (on) => { dimAll(card, !on); },
    }));

    EMAIL_KINDS.forEach((k) => {
      parts.push(switchRow({
        title: k.title, sub: k.sub, on: Boolean(p[k.key]), kind: k.key, token, dim: p.paused,
      }));
    });

    if (p.checkin_every) {
      const label = (CADENCES.find(([v]) => v === p.checkin_every) || [])[1] || p.checkin_every;
      parts.push(el('div', { class: 'set-s', style: 'padding-top:12px',
        text: `The look back is set to ${label.toLowerCase()}. Sign in to change how often it comes.` }));
    }

    parts.push(el('div', { style: 'margin-top:18px' },
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => ctx.go('today') }, 'Back to Cairn')));

    card.replaceChildren(...parts);
  })().catch(() => {
    card.replaceChildren(el('div', { class: 'set-s', text: 'Something went wrong reading that link. Try it again in a moment.' }));
  });
}

function dimAll(card, dim) {
  card.querySelectorAll('.set-row[data-kindrow]').forEach((r) => r.classList.toggle('is-dim', dim));
}

function switchRow({ title, sub, on, kind, token, dim, onSaved }) {
  const input = el('input', { type: 'checkbox', 'data-kind': kind });
  input.checked = on;
  input.addEventListener('change', async () => {
    const want = input.checked;
    try {
      const ok = await setByToken(token, kind, want);
      if (!ok) throw new Error('no row');
      onSaved?.(want);
      toast(want ? 'On.' : 'Off.');
    } catch {
      input.checked = !want;
      toast('That could not be saved. Try again in a moment.');
    }
  });

  const row = el('div', { class: 'set-row' },
    el('div', {},
      el('div', { class: 'set-t', text: title }),
      sub ? el('div', { class: 'set-s', text: sub }) : null,
    ),
    el('span', { class: 'spacer' }),
    el('label', { class: 'switch' }, input, el('span', { class: 'switch-track' })),
  );
  if (kind !== 'all') {
    row.dataset.kindrow = '1';
    if (dim) row.classList.add('is-dim');
  }
  return row;
}
