/* ============================================================
   Cairn — journal.

   Two modes on one screen:
     Thankful — five slots, each with a guiding question drawn
                from a different corner of life so you don't
                write "my family" five times.
     Open     — a blank page.
   ============================================================ */
import { el, dayKey, fmtDate, debounce } from '../util.js';
import { journal, prefs } from '../store.js';
import { promptsForDay, rerollPrompt, OPEN_PROMPTS } from '../prompts.js';
import { modal, confirmDialog, toast } from '../ui.js';

export function renderJournal(root, ctx, params = {}) {
  const mode = params.mode ?? prefs.get('journalMode', 'gratitude');
  prefs.set('journalMode', mode);

  const head = el('div', { class: 'page-head' },
    el('div', { class: 'eyebrow', text: 'Journal' }),
    el('h1', { class: 'page-title', text: mode === 'gratitude' ? 'Five things' : 'A blank page' }),
    el('p', {
      class: 'page-sub',
      text: mode === 'gratitude'
        ? 'One from each corner of your life. You do not have to fill all five.'
        : 'No prompts, no structure. Say what you actually want to say.',
    }),
  );

  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Journal type' },
    el('button', {
      type: 'button', 'aria-pressed': String(mode === 'gratitude'),
      onclick: () => ctx.go('journal', { mode: 'gratitude' }),
    }, 'Thankful'),
    el('button', {
      type: 'button', 'aria-pressed': String(mode === 'open'),
      onclick: () => ctx.go('journal', { mode: 'open' }),
    }, 'Open'),
  );

  const bar = el('div', { class: 'row', style: 'margin-bottom:18px' }, seg, el('span', { class: 'spacer' }));
  if (mode === 'open') {
    bar.append(el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openEditor(null, ctx) }, '+ New entry'));
  }

  const wrap = el('div', { class: 'wrap' }, head, bar);
  wrap.append(mode === 'gratitude' ? gratitudeView(ctx) : openView(ctx));
  root.replaceChildren(wrap);
}

/* ================================================================
   Thankful
   ================================================================ */
function gratitudeView(ctx) {
  const today = dayKey();
  let entry = journal.ofKind('gratitude').find((e) => dayKey(new Date(e.createdAt)) === today);

  const prompts = entry?.prompts?.length ? entry.prompts : promptsForDay();
  const items = entry?.items?.length ? [...entry.items, '', '', '', '', ''].slice(0, 5) : ['', '', '', '', ''];

  const card = el('div', { class: 'card card-pad' });
  card.append(el('div', { class: 'row', style: 'margin-bottom:6px' },
    el('div', {},
      el('div', { style: 'font-family:var(--serif);font-size:19px', text: 'Today' }),
      el('div', { style: 'font-size:12.5px;color:var(--muted)', text: fmtDate(new Date(), { weekday: 'long', month: 'long', day: 'numeric' }) }),
    ),
  ));

  const save = debounce(() => {
    const filled = items.some((s) => s.trim());
    if (!filled) {
      if (entry) { journal.remove(entry.id); entry = null; }
      return;
    }
    if (entry) journal.update(entry.id, { items: [...items], prompts: [...prompts] });
    else entry = journal.create({ kind: 'gratitude', items: [...items], prompts: [...prompts], title: 'Thankful' });
    countEl.textContent = `${items.filter((s) => s.trim()).length} of 5`;
  }, 600);

  prompts.forEach((prompt, i) => {
    const promptEl = el('span', { text: prompt });
    const input = el('input', {
      class: 'grat-input', type: 'text', value: items[i] || '',
      placeholder: 'I am thankful for…', 'aria-label': `Thankful item ${i + 1}`,
    });
    input.addEventListener('input', () => { items[i] = input.value; save(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = card.querySelectorAll('.grat-input')[i + 1];
        next ? next.focus() : input.blur();
      }
    });

    card.append(el('div', { class: 'grat-item' },
      el('div', { class: 'grat-num', text: String(i + 1) }),
      el('div', { class: 'grat-fields' },
        el('div', { class: 'grat-prompt' },
          promptEl,
          el('button', {
            type: 'button', title: 'A different question',
            onclick: () => { prompts[i] = rerollPrompt(i, prompts[i]); promptEl.textContent = prompts[i]; save(); },
          }, 'another'),
        ),
        input,
      ),
    ));
  });

  const countEl = el('span', { style: 'font-size:12.5px;color:var(--muted)', text: `${items.filter((s) => s.trim()).length} of 5` });
  card.append(el('div', { class: 'row', style: 'margin-top:16px;padding-top:14px;border-top:1px solid var(--line)' },
    countEl,
    el('span', { class: 'spacer' }),
    el('span', { style: 'font-size:12.5px;color:var(--muted)', text: 'Saves as you type' }),
  ));

  const past = journal.ofKind('gratitude').filter((e) => dayKey(new Date(e.createdAt)) !== today);
  const wrap = el('div', {}, card);
  if (past.length) {
    wrap.append(el('div', { class: 'section-label', text: 'Earlier lists' }));
    const list = el('div', { class: 'entry-list' });
    past.forEach((e) => list.append(gratitudeCard(e, ctx)));
    wrap.append(list);
  }
  return wrap;
}

function gratitudeCard(e, ctx) {
  const filled = (e.items || []).filter((s) => s && s.trim());
  return el('button', {
    class: 'entry', type: 'button',
    onclick: () => modal({
      title: fmtDate(e.createdAt, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      subtitle: 'Thankful for',
      content: el('div', {}, ...filled.map((s, i) =>
        el('div', { class: 'grat-item' },
          el('div', { class: 'grat-num', text: String(i + 1) }),
          el('div', { class: 'grat-fields', style: 'font-family:var(--serif);font-size:15.5px', text: s }),
        ))),
      actions: [
        { label: 'Delete', variant: 'danger', onClick: () => { journal.remove(e.id); ctx.rerender(); } },
        { label: 'Close', variant: 'primary' },
      ],
    }),
  },
    el('div', { class: 'entry-top' },
      el('span', { class: 'entry-kind', text: 'Thankful' }),
      el('span', { class: 'entry-date', text: fmtDate(e.createdAt) }),
    ),
    el('div', { class: 'entry-preview', text: filled.join(' · ') }),
  );
}

/* ================================================================
   Open
   ================================================================ */
function openView(ctx) {
  const entries = journal.ofKind('open');
  if (!entries.length) {
    return el('div', { class: 'empty' },
      el('div', { class: 'empty-title', text: 'Nothing written yet' }),
      el('p', { text: OPEN_PROMPTS[Math.floor(Math.random() * OPEN_PROMPTS.length)] }),
      el('div', { style: 'margin-top:18px' },
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openEditor(null, ctx) }, 'Start writing'),
      ),
    );
  }
  const list = el('div', { class: 'entry-list' });
  entries.forEach((e) => {
    list.append(el('button', {
      class: 'entry', type: 'button', onclick: () => openEditor(e, ctx),
    },
      el('div', { class: 'entry-top' },
        el('span', { class: 'entry-kind open', text: 'Journal' }),
        el('span', { class: 'entry-date', text: fmtDate(e.createdAt) }),
      ),
      e.title ? el('div', { class: 'entry-title', text: e.title }) : null,
      el('div', { class: 'entry-preview', text: (e.body || '').slice(0, 220) }),
    ));
  });
  return list;
}

function openEditor(entry, ctx) {
  const placeholder = OPEN_PROMPTS[Math.floor(Math.random() * OPEN_PROMPTS.length)];
  const title = el('input', { class: 'field', type: 'text', placeholder: 'Title (optional)', 'data-autofocus': '' });
  const body = el('textarea', { class: 'field', rows: 12, placeholder, style: 'margin-top:10px;min-height:220px;font-family:var(--serif);font-size:15.5px;line-height:1.7' });
  title.value = entry?.title || '';
  body.value = entry?.body || '';

  const actions = [{ label: 'Cancel' }];
  if (entry) {
    actions.push({
      label: 'Delete', variant: 'danger',
      onClick: () => {
        confirmDialog({
          title: 'Delete this entry?', subtitle: 'This cannot be undone.',
          onConfirm: () => { journal.remove(entry.id); ctx.rerender(); },
        });
        return true; // keep the confirm dialog on top
      },
    });
  }
  actions.push({
    label: 'Save', variant: 'primary',
    onClick: () => {
      const t = title.value.trim(), b = body.value.trim();
      if (!t && !b) return;
      if (entry) journal.update(entry.id, { title: t, body: b });
      else journal.create({ kind: 'open', title: t, body: b });
      toast('Saved.');
      ctx.rerender();
    },
  });

  modal({
    title: entry ? fmtDate(entry.createdAt, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'New entry',
    content: el('div', {}, title, body),
    actions, width: '620px',
  });
}
