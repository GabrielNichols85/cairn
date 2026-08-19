/* ============================================================
   Cairn — the answered list. A record, not a to-do.
   ============================================================ */
import { el, fmtDate, waitText } from '../util.js';
import { prayers } from '../store.js';
import { modal, confirmDialog, toast } from '../ui.js';

export function renderAnswered(root, ctx) {
  const list = prayers.answered();

  const head = el('div', { class: 'page-head' },
    el('div', { class: 'eyebrow', text: 'Answered' }),
    el('h1', { class: 'page-title', text: list.length ? 'What God has done' : 'Nothing here yet' }),
    el('p', {
      class: 'page-sub',
      text: list.length
        ? 'These come back to you on the Today screen, especially on their anniversaries.'
        : 'When a prayer on your wall is answered, drag it down to the answered ribbon. It will live here, and Cairn will resurface it later.',
    }),
  );

  const body = el('div', { class: 'answered-list' });

  if (!list.length) {
    body.append(el('div', { class: 'empty' },
      el('div', { class: 'empty-title', text: 'The record starts with your first answer' }),
      el('p', { text: 'It is worth writing down what happened, not just that it happened.' }),
      el('div', { style: 'margin-top:18px' },
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.go('wall') }, 'Go to the wall'),
      ),
    ));
  } else {
    let lastYear = null;
    list.forEach((p) => {
      const year = new Date(p.answeredAt).getFullYear();
      if (year !== lastYear) { body.append(el('div', { class: 'year-head', text: String(year) })); lastYear = year; }
      body.append(item(p, ctx));
    });
  }

  root.replaceChildren(el('div', { class: 'wrap' }, head, body));
}

function item(p, ctx) {
  const node = el('div', { class: 'answered-item' },
    el('div', { class: 'answered-body', text: (p.body || '').trim() }),
    p.answeredNote ? el('div', { class: 'answered-note', text: p.answeredNote }) : null,
    el('div', { class: 'answered-meta' },
      el('span', { class: 'pill' }, '✓ answered'),
      el('span', { text: `Prayed ${fmtDate(p.createdAt)}` }),
      el('span', { text: `Answered ${fmtDate(p.answeredAt)}` }),
      el('span', { text: waitText(p.createdAt, p.answeredAt) }),
    ),
  );

  node.append(el('div', { class: 'answered-actions' },
    el('button', {
      class: 'btn btn-quiet btn-sm', type: 'button',
      onclick: () => editNote(p, ctx),
    }, p.answeredNote ? 'Edit note' : 'Add note'),
    el('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', title: 'Put this back on the wall',
      onclick: () => { prayers.reopen(p.id); toast('Back on the wall.'); ctx.rerender(); ctx.refreshChrome(); },
    }, 'Reopen'),
    el('button', {
      class: 'btn btn-quiet btn-sm', type: 'button',
      onclick: () => confirmDialog({
        title: 'Delete this record?',
        subtitle: 'This one will not come back on the Today screen again.',
        onConfirm: () => { prayers.remove(p.id); ctx.rerender(); ctx.refreshChrome(); },
      }),
    }, 'Delete'),
  ));

  return node;
}

function editNote(p, ctx) {
  const ta = el('textarea', {
    class: 'field', rows: 4, 'data-autofocus': '',
    placeholder: 'How did God answer this one?',
  });
  ta.value = p.answeredNote || '';
  modal({
    title: 'How was it answered?',
    subtitle: p.body,
    content: ta,
    actions: [
      { label: 'Cancel' },
      { label: 'Save', variant: 'primary', onClick: () => { prayers.update(p.id, { answeredNote: ta.value.trim() || null }); ctx.rerender(); } },
    ],
  });
}
