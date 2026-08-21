/* ============================================================
   Cairn, the sender.

   Runs every hour. Each run it looks for the people whose local
   clock has just reached the sending hour, works out whether any
   of them is owed an email, and sends at most one.

   At most one is the whole trick. Three emails in a morning is
   how a thing that was meant to be kind starts feeling like a
   subscription somebody forgot to cancel. Priority runs:
   the anniversary first, because it is the only one that is about
   something that actually happened; then the look back; then the
   reading nudge, which is the least important and is off unless
   it was asked for.

   Nothing here is imported. No supabase client, no mail library,
   just fetch, so this deploys with no build and no package.json.

   Secrets live in Netlify environment variables. None of them
   belong anywhere near config.js, which is public.
   ============================================================ */
import { PLAN } from '../../src/readings.js';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const FROM_EMAIL    = process.env.MAIL_FROM      || 'hello@praycairn.com';
const FROM_NAME     = process.env.MAIL_FROM_NAME || 'Cairn';
const SITE          = (process.env.SITE_URL || 'https://praycairn.com').replace(/\/$/, '');
const OWNER_EMAIL   = process.env.OWNER_EMAIL || '';
const SEND_HOUR     = Number(process.env.SEND_HOUR || 7);
const DRY_RUN       = process.env.DRY_RUN === '1';

const CADENCE_DAYS = { weekly: 7, biweekly: 14, monthly: 30 };
const DAY = 86400000;

/* ---------- talking to Postgres over the REST layer ---------- */
async function db(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: init.method === 'PATCH' ? 'return=minimal' : 'return=representation',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/* ---------- talking to Resend ----------
   The two List-Unsubscribe headers are not decoration. They are
   what puts a real "Unsubscribe" button at the top of the message
   in Gmail, and honouring them is most of what keeps mail out of
   the spam folder. */
async function send({ to, name, subject, html, text, token, kind }) {
  if (DRY_RUN) { console.log(`[dry] ${kind} → ${to}: ${subject}`); return true; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
      text,
      headers: {
        'List-Unsubscribe': `<${SITE}/api/unsubscribe?t=${token}&k=${kind}>, <mailto:${FROM_EMAIL}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });
  if (!res.ok) { console.error('resend', res.status, await res.text()); return false; }
  return true;
}

/* ---------- what time is it where they are ---------- */
function localParts(timezone) {
  const tz = timezone || 'UTC';
  let fmt;
  try { fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }); }
  catch { fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }); }
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return {
    dayKey: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour === '24' ? '0' : p.hour),
    month: Number(p.month),
    day: Number(p.day),
    year: Number(p.year),
  };
}

const olderThan = (iso, days) => !iso || Date.now() - new Date(iso).getTime() > days * DAY - 6 * 3600000;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const firstName = (n, email) => (n || (email || '').split('@')[0] || 'friend').split(' ')[0];

/* ============================================================
   The shell every email sits in. Plain, readable in dark mode,
   no images, no tracking pixel, no "view in browser".
   ============================================================ */
function shell({ body, token, kind, footNote }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#FAF8F5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #EDE8E1;border-radius:16px;padding:32px">
<tr><td style="font-family:Georgia,'Times New Roman',serif;color:#2B2A31;font-size:16px;line-height:1.62">
${body}
</td></tr>
<tr><td style="padding-top:28px;border-top:1px solid #EDE8E1;margin-top:24px;
  font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;line-height:1.6;color:#8A857E">
${footNote ? esc(footNote) + '<br/>' : ''}
<a href="${SITE}/unsubscribe/${token}?k=${kind}" style="color:#8A857E">Turn this email off</a>
&nbsp;·&nbsp;
<a href="${SITE}/#settings" style="color:#8A857E">All email settings</a>
<br/>Cairn · a place to remember what God has done.
</td></tr>
</table></td></tr></table></body></html>`;
}

const h1 = (t) => `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#8A857E;margin-bottom:10px">${esc(t)}</div>`;
const btn = (label, href) => `<div style="margin-top:26px"><a href="${href}" style="display:inline-block;background:#4F6F5E;color:#fff;text-decoration:none;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;font-weight:500;padding:11px 20px;border-radius:10px">${esc(label)}</a></div>`;

/* ============================================================
   The four letters
   ============================================================ */
function welcomeMail(p) {
  const name = firstName(p.name, p.email);
  const body = `${h1('Welcome')}
<p style="margin:0 0 14px">Hello ${esc(name)},</p>
<p style="margin:0 0 14px">Cairn is a quiet place to put the things you are praying for, and a much better place to find them again later.</p>
<p style="margin:0 0 14px">Most prayer apps are built around what you owe them today. This one is built around what has already been answered. Write a prayer on the wall, and when it is answered, drag it across. Months from now Cairn will bring it back to you, with the date you first wrote it and how long you waited.</p>
<p style="margin:0 0 14px">Nothing you write is shown to anyone. There are no ads and no trackers.</p>
${btn('Open Cairn', SITE)}`;
  return {
    subject: 'Welcome to Cairn',
    html: shell({ body, token: p.token, kind: 'product', footNote: 'You are getting this because you just made a Cairn account.' }),
    text: `Hello ${name},\n\nCairn is a quiet place to put the things you are praying for, and a better place to find them again later.\n\nWrite a prayer on the wall. When it is answered, drag it across. Months from now Cairn will bring it back to you.\n\n${SITE}\n\nTurn this off: ${SITE}/unsubscribe/${p.token}?k=product`,
  };
}

function rememberMail(p, prayer, years) {
  const name = firstName(p.name, p.email);
  const when = years === 1 ? 'a year ago today' : `${years} years ago today`;
  const body = `${h1(`Answered ${when}`)}
<p style="margin:0 0 18px">${esc(name)}, this is what you wrote:</p>
<div style="border-left:3px solid #4F6F5E;padding:2px 0 2px 16px;margin:0 0 18px;font-size:18px;line-height:1.55;color:#2B2A31">${esc(prayer.body)}</div>
${prayer.answered_note ? `<p style="margin:0 0 14px;color:#5E5A54"><em>${esc(prayer.answered_note)}</em></p>` : ''}
<p style="margin:0 0 6px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:#8A857E">Prayed ${fmt(prayer.created_at)} · answered ${fmt(prayer.answered_at)}</p>
${btn('See your answered prayers', `${SITE}/#answered`)}`;
  return {
    subject: `${when.charAt(0).toUpperCase() + when.slice(1)}, this was answered`,
    html: shell({ body, token: p.token, kind: 'remember', footNote: 'You are getting this because an answered prayer on your wall has an anniversary today.' }),
    text: `${name}, ${when} this prayer was answered:\n\n"${prayer.body}"\n\n${prayer.answered_note || ''}\n\nPrayed ${fmt(prayer.created_at)}, answered ${fmt(prayer.answered_at)}.\n\n${SITE}/#answered\n\nTurn this off: ${SITE}/unsubscribe/${p.token}?k=remember`,
  };
}

function checkinMail(p, { active, answered, streak, recent }) {
  const name = firstName(p.name, p.email);
  const lines = [];
  if (answered) lines.push(`<li style="margin-bottom:6px">${answered} ${answered === 1 ? 'prayer has' : 'prayers have'} been answered and marked so far.</li>`);
  if (active) lines.push(`<li style="margin-bottom:6px">${active} ${active === 1 ? 'thing is' : 'things are'} still on your wall.</li>`);
  if (streak) lines.push(`<li style="margin-bottom:6px">${streak} ${streak === 1 ? 'day' : 'days'} of reading behind you.</li>`);

  const body = `${h1('A look back')}
<p style="margin:0 0 14px">Hello ${esc(name)}, no action needed here. Just the picture.</p>
${lines.length ? `<ul style="margin:0 0 16px;padding-left:20px;color:#2B2A31">${lines.join('')}</ul>`
  : '<p style="margin:0 0 16px">Your wall is empty at the moment. Whenever you are ready, there is room on it.</p>'}
${recent ? `<p style="margin:0 0 8px;color:#5E5A54">Still waiting on this one:</p>
<div style="border-left:3px solid #C6BFB5;padding:2px 0 2px 16px;margin:0 0 16px;color:#5E5A54">${esc(recent.body)}</div>` : ''}
${btn('Open Cairn', SITE)}`;
  return {
    subject: answered ? `${answered} answered so far` : 'A quiet look back at your wall',
    html: shell({ body, token: p.token, kind: 'checkin', footNote: `You chose to get this ${p.checkin_every}.` }),
    text: `Hello ${name}.\n\n${answered} answered, ${active} still on your wall, ${streak} days of reading.\n\n${SITE}\n\nTurn this off: ${SITE}/unsubscribe/${p.token}?k=checkin`,
  };
}

function readingMail(p, reference) {
  const name = firstName(p.name, p.email);
  const body = `${h1("Today's reading")}
<p style="margin:0 0 10px">Good morning ${esc(name)}.</p>
<div style="font-size:26px;line-height:1.3;margin:0 0 14px">${esc(reference)}</div>
<p style="margin:0 0 14px;color:#5E5A54">A few minutes, that is all.</p>
${btn('Read it', SITE)}`;
  return {
    subject: `Today: ${reference}`,
    html: shell({ body, token: p.token, kind: 'reading', footNote: 'You turned this one on yourself. It only comes on days you have not already read.' }),
    text: `Good morning ${name}.\n\nToday: ${reference}\n\n${SITE}\n\nTurn this off: ${SITE}/unsubscribe/${p.token}?k=reading`,
  };
}

const fmt = (iso) => {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
};

/* ============================================================
   One person, one run
   ============================================================ */
async function handlePerson(p, results) {
  if (!p.email) return;
  const now = new Date().toISOString();

  /* Welcome goes out promptly, whatever the hour. */
  if (!p.welcomed_at) {
    const m = welcomeMail(p);
    if (await send({ ...m, to: p.email, name: p.name, token: p.token, kind: 'product' })) {
      await db(`email_prefs?user_id=eq.${p.user_id}`, { method: 'PATCH', body: JSON.stringify({ welcomed_at: now }) });
      results.welcome++;
    }
    return;                       // never two on the first morning
  }

  const t = localParts(p.timezone);
  if (t.hour !== SEND_HOUR) return;

  /* --- 1. an anniversary --- */
  if (p.remember && (!p.last_remember_at || p.last_remember_at.slice(0, 10) !== t.dayKey)) {
    const answered = await db(`prayers?user_id=eq.${p.user_id}&status=eq.answered&answered_at=not.is.null&select=body,answered_note,created_at,answered_at&order=answered_at.desc&limit=400`);
    const hit = (answered || []).find((pr) => {
      const d = new Date(pr.answered_at);
      return d.getUTCMonth() + 1 === t.month && d.getUTCDate() === t.day && d.getUTCFullYear() < t.year;
    });
    if (hit) {
      const years = t.year - new Date(hit.answered_at).getUTCFullYear();
      const m = rememberMail(p, hit, years);
      if (await send({ ...m, to: p.email, name: p.name, token: p.token, kind: 'remember' })) {
        await db(`email_prefs?user_id=eq.${p.user_id}`, { method: 'PATCH', body: JSON.stringify({ last_remember_at: now }) });
        results.remember++;
      }
      return;
    }
  }

  /* --- 2. the look back --- */
  if (p.checkin && olderThan(p.last_checkin_at, CADENCE_DAYS[p.checkin_every] ?? 7)) {
    const [all, reads] = await Promise.all([
      db(`prayers?user_id=eq.${p.user_id}&select=body,status,created_at&order=created_at.desc&limit=400`),
      db(`readings?user_id=eq.${p.user_id}&completed_at=not.is.null&select=day_key`),
    ]);
    const active = (all || []).filter((x) => x.status === 'active');
    const stats = {
      active: active.length,
      answered: (all || []).length - active.length,
      streak: streakOf((reads || []).map((r) => r.day_key), t.dayKey),
      recent: active[0] || null,
    };
    if (stats.active || stats.answered) {
      const m = checkinMail(p, stats);
      if (await send({ ...m, to: p.email, name: p.name, token: p.token, kind: 'checkin' })) {
        await db(`email_prefs?user_id=eq.${p.user_id}`, { method: 'PATCH', body: JSON.stringify({ last_checkin_at: now }) });
        results.checkin++;
      }
      return;
    }
  }

  /* --- 3. the reading nudge --- */
  if (p.reading && (!p.last_reading_at || p.last_reading_at.slice(0, 10) !== t.dayKey)) {
    const reads = await db(`readings?user_id=eq.${p.user_id}&completed_at=not.is.null&select=day_key,reference&order=day_key.desc&limit=400`);
    const done = reads || [];
    if (done.some((r) => r.day_key === t.dayKey)) return;   // already read today
    const reference = PLAN[done.length % PLAN.length];
    const m = readingMail(p, reference);
    if (await send({ ...m, to: p.email, name: p.name, token: p.token, kind: 'reading' })) {
      await db(`email_prefs?user_id=eq.${p.user_id}`, { method: 'PATCH', body: JSON.stringify({ last_reading_at: now }) });
      results.reading++;
    }
  }
}

function streakOf(dayKeys, todayKey) {
  const set = new Set(dayKeys);
  let n = 0;
  let d = new Date(`${todayKey}T12:00:00Z`);
  if (!set.has(todayKey)) d = new Date(d.getTime() - DAY);   // yesterday still counts
  for (;;) {
    const k = d.toISOString().slice(0, 10);
    if (!set.has(k)) break;
    n++;
    d = new Date(d.getTime() - DAY);
  }
  return n;
}

/* ---------- new ideas, forwarded to whoever runs this ---------- */
async function forwardSuggestions(results) {
  if (!OWNER_EMAIL) return;
  const rows = await db('suggestions?notified_at=is.null&select=id,body,created_at&order=created_at.asc&limit=25');
  if (!rows?.length) return;
  const list = rows.map((r) => `<li style="margin-bottom:12px">${esc(r.body)}<br/><span style="font-size:12px;color:#8A857E">${fmt(r.created_at)}</span></li>`).join('');
  const ok = await send({
    to: OWNER_EMAIL, name: 'Cairn', kind: 'product', token: 'owner',
    subject: rows.length === 1 ? 'A new idea for Cairn' : `${rows.length} new ideas for Cairn`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#2B2A31"><ul style="padding-left:18px">${list}</ul></div>`,
    text: rows.map((r) => `- ${r.body}`).join('\n'),
  });
  if (ok) {
    const now = new Date().toISOString();
    await db(`suggestions?id=in.(${rows.map((r) => r.id).join(',')})`, { method: 'PATCH', body: JSON.stringify({ notified_at: now }) });
    results.ideas += rows.length;
  }
}

/* ============================================================
   The run
   ============================================================ */
export default async function handler() {
  if (!SUPABASE_URL || !SERVICE_KEY || (!RESEND_KEY && !DRY_RUN)) {
    console.error('[cairn] sender is missing its environment variables');
    return new Response('not configured', { status: 500 });
  }

  const results = { welcome: 0, remember: 0, checkin: 0, reading: 0, ideas: 0, errors: 0 };

  try {
    const people = await db('email_prefs?paused=eq.false&email=not.is.null&select=*&limit=5000');
    for (const p of people || []) {
      try { await handlePerson(p, results); }
      catch (err) { results.errors++; console.error('[cairn]', p.user_id, err.message); }
    }
    await forwardSuggestions(results);
  } catch (err) {
    console.error('[cairn] run failed', err);
    return new Response(`failed: ${err.message}`, { status: 500 });
  }

  console.log('[cairn]', JSON.stringify(results));
  return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
}

export const config = { schedule: '0 * * * *' };
