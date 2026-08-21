/* ============================================================
   Cairn, email preferences.

   Four kinds of email, each its own switch, plus a cadence for
   the check in and one pause that covers everything. Nothing is
   sent to somebody running in local only mode, because there is
   no account and so no address.

   The daily reading nudge starts off. That is on purpose. It is
   the one that would arrive whether or not anything happened, and
   an inbox that fills up with those is an inbox where the
   anniversary email, the one that is actually worth reading, gets
   muted along with it.
   ============================================================ */
import { store } from './store.js';

const sb = () => store.sb;

export const emailAvailable = () => Boolean(store.mode === 'cloud' && store.user && store.sb);

export const EMAIL_KINDS = [
  {
    key: 'remember',
    title: 'A prayer you forgot you prayed',
    sub: 'On the anniversary of an answered prayer, the words you wrote back then, and what happened.',
  },
  {
    key: 'checkin',
    title: 'A gentle look back',
    sub: 'What is still on your wall, what was answered, and how long you have been reading. No guilt, just the picture.',
    cadence: true,
  },
  {
    key: 'reading',
    title: "A nudge for the day's reading",
    sub: 'One line in the morning with the chapter you are up to. Only on days you have not already read.',
  },
  {
    key: 'product',
    title: 'When something new ships',
    sub: 'A short note, a few times a year at most, when Cairn gains something worth knowing about.',
  },
];

export const CADENCES = [
  ['weekly', 'Weekly'],
  ['biweekly', 'Every other week'],
  ['monthly', 'Monthly'],
];

const guessZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; }
  catch { return null; }
};

/* Reading the row also creates it if it is somehow missing, and
   quietly brings the address, name and time zone up to date. */
export async function loadEmailPrefs() {
  if (!emailAvailable()) return null;
  const u = store.user;
  const { data, error } = await sb().rpc('my_email_prefs', {
    p_email: u.email ?? null,
    p_name: u.user_metadata?.full_name || u.user_metadata?.name || null,
    p_timezone: guessZone(),
  });
  if (error) { console.warn('[cairn] email prefs', error); return null; }
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function saveEmailPrefs(patch) {
  if (!emailAvailable()) return false;
  const { error } = await sb()
    .from('email_prefs')
    .update(patch)
    .eq('user_id', store.user.id);
  if (error) { console.warn('[cairn] email prefs save', error); throw error; }
  return true;
}

/* ---------- the unsubscribe link, which works signed out ---------- */
export async function previewByToken(token) {
  if (!(store.mode === 'cloud' && store.sb)) return null;
  const { data, error } = await sb().rpc('email_prefs_by_token', { p_token: token });
  if (error) { console.warn('[cairn] unsubscribe lookup', error); return null; }
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function unsubscribeByToken(token, kind = 'all') {
  const { data, error } = await sb().rpc('email_unsubscribe', { p_token: token, p_kind: kind });
  if (error) throw error;
  return data === true;
}

export async function setByToken(token, kind, on) {
  const { data, error } = await sb().rpc('email_prefs_set_by_token', { p_token: token, p_kind: kind, p_on: on });
  if (error) throw error;
  return data === true;
}

export async function resubscribeByToken(token) {
  const { data, error } = await sb().rpc('email_resubscribe', { p_token: token });
  if (error) throw error;
  return data === true;
}
