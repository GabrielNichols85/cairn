/* ============================================================
   Cairn — the numbers.

   Only visible to whoever runs Cairn, and only ever counts. The
   database function behind this returns totals and dates. It does
   not return, and cannot be made to return, the text of anybody's
   prayer, journal entry, or name. The one thing a prayer app must
   never do is read the prayers.

   Every chart here is a single series, so identity comes from the
   heading above it rather than from a colour, and there is a table
   underneath for anyone who cannot read the bars.
   ============================================================ */
import { el, fmtDate } from '../util.js';
import { store } from '../store.js';
import { toast } from '../ui.js';

let cached = null;

export function renderStats(root, ctx) {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('div', { class: 'page-head' },
    el('div', { class: 'eyebrow', text: 'Private' }),
    el('h1', { class: 'page-title', text: 'How Cairn is doing' }),
    el('p', { class: 'page-sub', text: 'Counts only. Nothing here can show you what anybody wrote.' }),
  ));

  const body = el('div', { class: 'stats-body' }, el('div', { class: 'set-s', text: 'Counting…' }));
  wrap.append(body);
  root.replaceChildren(wrap);

  if (cached) draw(body, cached, ctx);

  load()
    .then((data) => { cached = data; draw(body, data, ctx); })
    .catch((err) => {
      body.replaceChildren(el('div', { class: 'card card-pad' },
        el('div', { class: 'set-t', text: 'These numbers are not for this account' }),
        el('div', { class: 'set-s', style: 'margin-top:6px',
          text: String(err?.message || err).includes('not permitted')
            ? 'Only the person who runs Cairn can see this page.'
            : 'The numbers could not be loaded right now.' }),
      ));
    });
}

async function load() {
  if (!(store.mode === 'cloud' && store.user && store.sb)) throw new Error('not permitted');
  const { data, error } = await store.sb.rpc('app_stats');
  if (error) throw error;
  return data;
}

/* ---------- drawing ---------- */
function draw(body, d, ctx) {
  const parts = [];

  parts.push(tiles([
    ['People', d.people.total, `${d.people.new_7d} joined this week`],
    ['Active this week', d.people.active_7d, `${d.people.active_today} today`],
    ['Prayers', d.prayers.total, `${d.prayers.added_7d} this week`],
    ['Answered', d.prayers.answered, waitPhrase(d.prayers.median_days_to_answer)],
    ['Chapters read', d.reading.chapters, `by ${d.reading.readers} ${d.reading.readers === 1 ? 'person' : 'people'}`],
    ['Circles', d.circles.total, `${d.circles.members} members`],
  ]));

  /* Retention, which is the only number that really matters early on. */
  const older = d.people.joined_over_a_week_ago;
  const kept = d.people.kept_after_a_week;
  parts.push(section('Do people stay',
    `Of the ${older} ${older === 1 ? 'person' : 'people'} who joined more than a week ago, ${kept} still wrote something in the last seven days.`,
    funnel([
      ['Signed up', d.people.total],
      ['Wrote something', d.people.total - d.people.never_wrote],
      ['Came back another day', d.people.came_back],
      ['Still here this week', d.people.active_7d],
    ]),
  ));

  /* Thirty days of shape. Small multiples rather than one chart with
     four scales fighting over a single axis. */
  const series = [
    ['Prayers written', 'prayers'],
    ['Prayers answered', 'answered'],
    ['Chapters read', 'chapters'],
    ['Journal entries', 'journal'],
    ['Prayed for someone', 'prayed_for'],
    ['New people', 'signups'],
  ];
  parts.push(section('The last thirty days', null,
    el('div', { class: 'spark-grid' }, ...series.map(([title, key]) => sparkCard(title, d.daily, key))),
  ));

  parts.push(section('Everything else', null, table([
    ['On walls right now', d.prayers.on_walls],
    ['Prayers per person', d.prayers.per_person],
    ['Longest wait for an answer', d.prayers.longest_wait_days != null ? `${d.prayers.longest_wait_days} days` : '—'],
    ['Thankful lists', d.journal.thankful],
    ['Open journal entries', d.journal.open],
    ['Furthest anyone has read', `${d.reading.furthest_along ?? 0} chapters`],
    ['Prayers shared into a circle', d.circles.shared_prayers],
    ['Times somebody prayed for another', d.circles.prayers_prayed],
    ['Reachable by email', d.email.reachable],
    ['Have paused email', d.email.paused],
    ['Want the reading nudge', d.email.wants_reading],
    ['Ideas sent in', d.ideas],
  ])));

  parts.push(el('div', { class: 'set-s', style: 'margin-top:22px' },
    `Counted ${fmtDate(d.generated_at)}. `,
    el('button', {
      class: 'link-btn', type: 'button',
      onclick: () => { cached = null; toast('Recounting…'); ctx.rerender(); },
    }, 'Count again'),
  ));

  body.replaceChildren(...parts);
}

/* "half within 0.1 days" is a number pretending to be a sentence. */
function waitPhrase(days) {
  if (days == null) return 'none yet';
  if (days < 1) return 'usually the same day';
  if (days < 2) return 'usually within a day';
  if (days < 45) return `half within ${Math.round(days)} days`;
  const months = Math.round(days / 30);
  return `half within ${months} months`;
}

const section = (title, sub, ...kids) =>
  el('div', { class: 'stats-section' },
    el('h2', { class: 'section-label', text: title }),
    sub ? el('p', { class: 'set-s', style: 'margin:-4px 0 14px;max-width:60ch' , text: sub }) : null,
    ...kids,
  );

const tiles = (rows) =>
  el('div', { class: 'tile-grid' }, ...rows.map(([label, value, note]) =>
    el('div', { class: 'tile' },
      el('div', { class: 'tile-label', text: label }),
      el('div', { class: 'tile-num', text: String(value ?? 0) }),
      el('div', { class: 'tile-note', text: note }),
    )));

/* A funnel is magnitude, so it is bars, and the label carries the
   identity. One hue throughout; the length is the information. */
function funnel(rows) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return el('div', { class: 'card card-pad' },
    ...rows.map(([label, n]) =>
      el('div', { class: 'funnel-row' },
        el('div', { class: 'funnel-label', text: label }),
        el('div', { class: 'funnel-track' },
          el('div', { class: 'funnel-fill', style: `width:${Math.max(2, (n / max) * 100)}%` }),
        ),
        el('div', { class: 'funnel-num', text: String(n) }),
      )),
  );
}

function sparkCard(title, daily, key) {
  const values = daily.map((r) => r[key] ?? 0);
  const total = values.reduce((a, b) => a + b, 0);
  const card = el('div', { class: 'spark-card' },
    el('div', { class: 'spark-head' },
      el('span', { class: 'spark-title', text: title }),
      el('span', { class: 'spark-total', text: String(total) }),
    ),
    bars(daily, key),
  );
  return card;
}

/* Thin bars, 2px of surface between them, rounded at the data end,
   anchored to the baseline. A recessive rule where zero sits. */
function bars(daily, key) {
  const W = 260, H = 54, n = daily.length;
  const gap = 2;
  const bw = Math.max(2, (W - gap * (n - 1)) / n);
  const max = Math.max(1, ...daily.map((r) => r[key] ?? 0));

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${key} per day for the last ${n} days`);
  svg.setAttribute('preserveAspectRatio', 'none');

  const base = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  base.setAttribute('x1', 0); base.setAttribute('x2', W);
  base.setAttribute('y1', H - 0.5); base.setAttribute('y2', H - 0.5);
  base.setAttribute('class', 'spark-base');
  svg.append(base);

  daily.forEach((row, i) => {
    const v = row[key] ?? 0;
    const h = v === 0 ? 0 : Math.max(3, (v / max) * (H - 6));
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    if (h > 0) {
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', i * (bw + gap));
      r.setAttribute('y', H - h);
      r.setAttribute('width', bw);
      r.setAttribute('height', h);
      r.setAttribute('rx', Math.min(2, bw / 2));
      r.setAttribute('class', 'spark-bar');
      g.append(r);
    }

    /* A full-height invisible target, so hovering a zero day works
       and small bars are not a game of skill. */
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hit.setAttribute('x', i * (bw + gap) - gap / 2);
    hit.setAttribute('y', 0);
    hit.setAttribute('width', bw + gap);
    hit.setAttribute('height', H);
    hit.setAttribute('class', 'spark-hit');
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = `${fmtDate(row.date, { month: 'short', day: 'numeric' })}: ${v}`;
    hit.append(t);
    g.append(hit);

    svg.append(g);
  });

  return el('div', { class: 'spark-wrap' }, svg);
}

const table = (rows) =>
  el('div', { class: 'card card-pad' },
    ...rows.map(([label, value]) =>
      el('div', { class: 'set-row' },
        el('div', { class: 'set-t', text: label }),
        el('span', { class: 'spacer' }),
        el('div', { class: 'stat-value', text: String(value ?? 0) }),
      )),
  );
