/* ============================================================
   Cairn — Today.

   The Remember card sits at the top on purpose. Every other app
   in this category opens with what you owe it; this one opens
   with what God already did.
   ============================================================ */
import { el, fmtLongDate, fmtDate, greeting, dayKey, waitText, relativeYears } from '../util.js';
import { prayers, readings, journal, prefs } from '../store.js';
import { readingFor, fetchPassage, gatewayUrl, TRANSLATION } from '../readings.js';
import { checkSvg, toast } from '../ui.js';

/* ---------- choosing what to remember ----------
   Anniversaries first (something answered on this day in a past
   year), then rotate. Never the same one twice in a row.        */
function pickRemembered(list, cursor) {
  if (!list.length) return null;
  const anniversaries = list.filter((p) => {
    const a = relativeYears(p.answeredAt);
    return a.sameDay && a.years >= 1;
  });
  const pool = anniversaries.length ? anniversaries : list;
  return { item: pool[cursor % pool.length], pool, isAnniversary: anniversaries.length > 0 };
}

export function renderToday(root, ctx) {
  const answered = prayers.answered();
  const grid = el('div', { class: 'today-grid' });

  grid.append(el('div', {},
    el('h1', { class: 'greeting', text: greeting() + '.' }),
    el('div', { class: 'greeting-date', text: fmtLongDate() }),
  ));

  /* ---------- Remember ---------- */
  let cursor = Number(prefs.get('rememberCursor', 0)) || 0;
  const rememberSlot = el('div');
  grid.append(rememberSlot);

  const drawRemember = () => {
    if (!answered.length) {
      rememberSlot.replaceChildren(el('div', { class: 'card card-pad' },
        el('div', { class: 'eyebrow', text: 'Remember' }),
        el('p', {
          class: 'page-sub', style: 'margin-top:2px',
          text: 'When a prayer on your wall is answered, drag it to the answered ribbon. Cairn will bring it back to you here, months and years later, so you do not forget what God did.',
        }),
      ));
      return;
    }
    const picked = pickRemembered(answered, cursor);
    const p = picked.item;
    const yrs = relativeYears(p.answeredAt);

    const card = el('div', { class: 'remember' },
      el('div', { class: 'remember-eyebrow' },
        picked.isAnniversary && yrs.years >= 1
          ? `Answered on this day, ${yrs.years} ${yrs.years === 1 ? 'year' : 'years'} ago`
          : 'Remember',
      ),
      el('div', { class: 'remember-body', text: '“' + (p.body || '').trim() + '”' }),
      p.answeredNote ? el('div', { class: 'remember-answer', text: p.answeredNote }) : null,
      el('div', { class: 'remember-meta' },
        el('span', { text: `Prayed ${fmtDate(p.createdAt)}` }),
        el('span', { text: `Answered ${fmtDate(p.answeredAt)}` }),
        el('span', { text: waitText(p.createdAt, p.answeredAt) }),
      ),
    );
    if (picked.pool.length > 1) {
      card.append(el('button', {
        class: 'remember-next', type: 'button', title: 'Show another', 'aria-label': 'Show another answered prayer',
        onclick: () => { cursor = (cursor + 1) % picked.pool.length; prefs.set('rememberCursor', cursor); drawRemember(); },
      }, '↻'));
    }
    rememberSlot.replaceChildren(card);
  };
  drawRemember();

  /* ---------- numbers ---------- */
  const streak = readings.streak();
  grid.append(el('div', { class: 'stat-row' },
    stat(prayers.active().length, 'on the wall'),
    stat(answered.length, answered.length === 1 ? 'answered prayer' : 'answered prayers'),
    stat(streak, streak === 1 ? 'day reading' : 'days reading'),
  ));

  /* ---------- scripture ---------- */
  const key = dayKey();
  const r = readingFor(readings.all(), key);
  const card = el('div', { class: 'card card-pad' });

  card.append(
    el('div', { class: 'eyebrow', text: "Today's reading" }),
    el('div', { class: 'scripture-day' },
      el('span', { text: `Day ${r.dayNumber} of ${r.total} · the New Testament, start to finish` }),
      el('span', { class: 'translation-pill', title: 'Public domain, free to read and share' }, TRANSLATION),
    ),
  );

  card.append(passageBlock(r.primary, { primary: true }));
  card.append(el('div', { class: 'passage-divider' }));
  card.append(passageBlock(r.psalm, { primary: false }));

  const cb = el('input', { type: 'checkbox' });
  cb.checked = r.doneToday;
  cb.addEventListener('change', () => {
    readings.setDone(key, r.primary, cb.checked);
    if (cb.checked) toast('Marked as read. Nice.');
    ctx.rerender();
  });

  card.append(el('div', { class: 'scripture-foot' },
    el('label', { class: 'check' }, cb, checkSvg(), el('span', { text: 'I read this today' })),
    el('span', { class: 'spacer' }),
    el('span', {
      class: 'next-up',
      text: r.doneToday ? `Next: ${r.nextUp}` : '',
    }),
  ));
  grid.append(card);

  /* ---------- quick actions ---------- */
  const todayGratitude = journal.ofKind('gratitude').find((e) => dayKey(new Date(e.createdAt)) === key);
  grid.append(el('div', { class: 'quick-row' },
    el('button', { class: 'quick', type: 'button', onclick: () => ctx.go('wall') },
      el('span', { class: 'quick-ico' }, quickIcon('pen')),
      el('span', {},
        el('div', { class: 'quick-t', text: 'Add a prayer' }),
        el('div', { class: 'quick-s', text: 'Put it on the wall' }),
      ),
    ),
    el('button', { class: 'quick', type: 'button', onclick: () => ctx.go('journal', { mode: 'gratitude' }) },
      el('span', { class: 'quick-ico' }, quickIcon('sun')),
      el('span', {},
        el('div', { class: 'quick-t', text: todayGratitude ? 'Thankful list, done today' : 'Five things you are thankful for' }),
        el('div', { class: 'quick-s', text: todayGratitude ? 'Tap to look back at it' : 'Guided, takes two minutes' }),
      ),
    ),
  ));

  root.replaceChildren(el('div', { class: 'wrap' }, grid));
}

/* ============================================================
   A passage: heading, then the text, fetched and folded down if
   it runs long. Never a link to somewhere else — if it is part
   of today's reading it belongs on this screen.
   ============================================================ */
function passageBlock(reference, { primary }) {
  const wrap = el('div', { class: `passage ${primary ? 'passage-primary' : 'passage-secondary'}` });
  wrap.append(el('div', { class: 'passage-ref', text: reference }));

  const slot = el('div', { class: 'scripture-loading', text: 'Loading…' });
  wrap.append(slot);

  fetchPassage(reference)
    .then((passage) => {
      const box = el('div', { class: 'scripture-text' });
      passage.verses.forEach((v) => {
        box.append(el('p', {},
          el('span', { class: 'vn', text: String(v.verse) }),
          v.text.replace(/\s+/g, ' '),
        ));
      });

      const holder = el('div', {}, box);
      slot.replaceWith(holder);

      const limit = primary ? 320 : 240;
      requestAnimationFrame(() => {
        if (box.scrollHeight <= limit + 40) return;
        box.style.setProperty('--fold', `${limit}px`);
        box.classList.add('clamped');
        const btn = el('button', { type: 'button' }, `Read all of ${reference} ↓`);
        btn.addEventListener('click', () => {
          const folded = box.classList.toggle('clamped');
          btn.textContent = folded ? `Read all of ${reference} ↓` : 'Show less ↑';
          if (folded) wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        holder.append(el('div', { class: 'scripture-more' }, btn));
      });
    })
    .catch(() => {
      slot.replaceWith(el('div', { class: 'callout', style: 'margin-top:12px' },
        'The text could not be loaded right now. You may be offline. ',
        el('a', { href: gatewayUrl(reference), target: '_blank', rel: 'noopener', text: `Read ${reference} elsewhere →` }),
      ));
    });

  return wrap;
}

function quickIcon(kind) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = kind === 'pen'
    ? `<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14.5 6.5l3 3"/>`
    : `<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M3 12h2M19 12h2M6.6 17.4l-1.4 1.4M18.8 5.2l-1.4 1.4"/>`;
  return s;
}

const stat = (num, label) =>
  el('div', { class: 'stat' },
    el('div', { class: 'stat-num', text: String(num) }),
    el('div', { class: 'stat-lbl', text: label }),
  );
