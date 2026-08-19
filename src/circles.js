/* ============================================================
   Cairn, prayer circles: the data layer.

   Circles need an account, so everything here is a no-op when
   the app is running in local-only mode. Views check
   circlesAvailable() before offering anything.
   ============================================================ */
import { store } from './store.js';

const sb = () => store.sb;
export const me = () => store.user?.id ?? null;
export const circlesAvailable = () => Boolean(store.mode === 'cloud' && store.user && store.sb);

const todayKey = () => new Date().toISOString().slice(0, 10);
const fail = (label) => (err) => { console.warn(`[cairn] ${label}`, err); throw err; };

/* ---------- profile, so circle mates see a name not an id ---------- */
export async function syncProfile() {
  if (!circlesAvailable()) return;
  const u = store.user;
  const row = {
    id: u.id,
    display_name: u.user_metadata?.full_name || u.user_metadata?.name || (u.email || '').split('@')[0],
    avatar_url: u.user_metadata?.avatar_url ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb().from('profiles').upsert(row);
  if (error) console.warn('[cairn] profile sync failed', error);
}

/* ================================================================
   Circles
   ================================================================ */
export const circles = {
  async list() {
    if (!circlesAvailable()) return [];
    const { data, error } = await sb()
      .from('circles')
      .select('id,name,owner_id,join_token,created_at')
      .order('created_at', { ascending: true });
    if (error) fail('list circles')(error);
    const ids = (data ?? []).map((c) => c.id);
    const counts = await memberCounts(ids);
    return (data ?? []).map((c) => ({ ...c, memberCount: counts[c.id] ?? 1, isOwner: c.owner_id === me() }));
  },

  async create(name) {
    const { data, error } = await sb().rpc('create_circle', { p_name: name });
    if (error) fail('create circle')(error);
    return data;
  },

  async members(circleId) {
    const { data, error } = await sb()
      .from('circle_members')
      .select('user_id,role,joined_at')
      .eq('circle_id', circleId);
    if (error) fail('members')(error);
    const rows = data ?? [];
    const names = await profileMap(rows.map((r) => r.user_id));
    return rows.map((r) => ({ ...r, ...(names[r.user_id] ?? {}) }));
  },

  /** Leaving pulls your own shared prayers out of the circle first. */
  async leave(circleId) {
    const { data: mineHere } = await sb().from('prayers').select('id').eq('user_id', me());
    const ids = (mineHere ?? []).map((r) => r.id);
    if (ids.length) {
      await sb().from('prayer_circles').delete().eq('circle_id', circleId).in('prayer_id', ids);
    }
    const { error } = await sb().from('circle_members').delete()
      .eq('circle_id', circleId).eq('user_id', me());
    if (error) fail('leave')(error);
  },

  async removeMember(circleId, userId) {
    const { error } = await sb().from('circle_members').delete()
      .eq('circle_id', circleId).eq('user_id', userId);
    if (error) fail('remove member')(error);
  },

  async rename(circleId, name) {
    const { error } = await sb().from('circles').update({ name }).eq('id', circleId);
    if (error) fail('rename')(error);
  },

  /** Invalidates every link already handed out. */
  async regenerateLink(circleId) {
    const token = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    const { error } = await sb().from('circles')
      .update({ join_token: token, token_revoked: false }).eq('id', circleId);
    if (error) fail('regenerate link')(error);
    return token;
  },

  async remove(circleId) {
    const { error } = await sb().from('circles').delete().eq('id', circleId);
    if (error) fail('delete circle')(error);
  },

  /** What an invite points at, before you commit to joining it. */
  async preview(token) {
    const { data, error } = await sb().rpc('circle_preview', { p_token: token });
    if (error) fail('preview')(error);
    return (data ?? [])[0] ?? null;
  },

  async join(token) {
    const { data, error } = await sb().rpc('join_circle', { p_token: token });
    if (error) throw error;
    return data;
  },

  linkFor(token) {
    return `${location.origin}/join/${token}`;
  },
};

async function memberCounts(circleIds) {
  if (!circleIds.length) return {};
  const { data } = await sb().from('circle_members').select('circle_id').in('circle_id', circleIds);
  const out = {};
  (data ?? []).forEach((r) => { out[r.circle_id] = (out[r.circle_id] ?? 0) + 1; });
  return out;
}

async function profileMap(userIds) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return {};
  const { data } = await sb().from('profiles').select('id,display_name,avatar_url').in('id', ids);
  const out = {};
  (data ?? []).forEach((p) => { out[p.id] = { name: p.display_name || 'Someone', avatar: p.avatar_url }; });
  ids.forEach((id) => { if (!out[id]) out[id] = { name: 'Someone', avatar: null }; });
  return out;
}

/* ================================================================
   Sharing individual prayers
   ================================================================ */
export const sharing = {
  /** Which circles a given prayer is currently shared into. */
  async forPrayer(prayerId) {
    if (!circlesAvailable()) return [];
    const { data } = await sb().from('prayer_circles').select('circle_id').eq('prayer_id', prayerId);
    return (data ?? []).map((r) => r.circle_id);
  },

  /** Circle ids for many prayers at once, so the wall can badge them. */
  async forPrayers(prayerIds) {
    if (!circlesAvailable() || !prayerIds.length) return {};
    const { data } = await sb().from('prayer_circles').select('prayer_id,circle_id').in('prayer_id', prayerIds);
    const out = {};
    (data ?? []).forEach((r) => { (out[r.prayer_id] ??= []).push(r.circle_id); });
    return out;
  },

  async share(prayerId, circleId) {
    const { error } = await sb().from('prayer_circles').insert({ prayer_id: prayerId, circle_id: circleId });
    if (error && error.code !== '23505') fail('share')(error);
  },

  async unshare(prayerId, circleId) {
    const { error } = await sb().from('prayer_circles').delete()
      .eq('prayer_id', prayerId).eq('circle_id', circleId);
    if (error) fail('unshare')(error);
  },
};

/* ================================================================
   The circle wall
   ================================================================ */
export const circleWall = {
  /**
   * @param sort 'newest' | 'needs' | 'most' | 'answered'
   */
  async prayers(circleId, sort = 'newest') {
    if (!circlesAvailable()) return [];

    const { data: shares } = await sb()
      .from('prayer_circles').select('prayer_id,shared_at').eq('circle_id', circleId);
    const ids = (shares ?? []).map((s) => s.prayer_id);
    if (!ids.length) return [];

    const { data: rows, error } = await sb()
      .from('prayers')
      .select('id,user_id,body,status,created_at,answered_at,answered_note')
      .in('id', ids);
    if (error) fail('circle prayers')(error);

    const [counts, mine, names] = await Promise.all([
      prayerCounts(ids),
      myPrayersToday(ids),
      profileMap((rows ?? []).map((r) => r.user_id)),
    ]);

    const sharedAt = Object.fromEntries((shares ?? []).map((s) => [s.prayer_id, s.shared_at]));
    const list = (rows ?? []).map((r) => ({
      id: r.id,
      authorId: r.user_id,
      author: names[r.user_id]?.name ?? 'Someone',
      avatar: names[r.user_id]?.avatar ?? null,
      isMine: r.user_id === me(),
      body: r.body,
      status: r.status,
      createdAt: r.created_at,
      answeredAt: r.answered_at,
      answeredNote: r.answered_note,
      sharedAt: sharedAt[r.id],
      prayerCount: counts[r.id] ?? 0,
      prayedToday: mine.has(r.id),
    }));

    const active = list.filter((p) => p.status === 'active');
    const answered = list.filter((p) => p.status === 'answered');

    if (sort === 'answered') return answered.sort((a, b) => new Date(b.answeredAt) - new Date(a.answeredAt));
    if (sort === 'needs')    return active.sort((a, b) => a.prayerCount - b.prayerCount || new Date(b.sharedAt) - new Date(a.sharedAt));
    if (sort === 'most')     return active.sort((a, b) => b.prayerCount - a.prayerCount || new Date(b.sharedAt) - new Date(a.sharedAt));
    return active.sort((a, b) => new Date(b.sharedAt) - new Date(a.sharedAt));
  },

  /** Record that you prayed. One per person per prayer per day. */
  async pray(prayerId) {
    const { error } = await sb().from('intercessions')
      .insert({ prayer_id: prayerId, user_id: me(), prayed_on: todayKey() });
    if (error && error.code !== '23505') throw error;
  },

  async unpray(prayerId) {
    const { error } = await sb().from('intercessions').delete()
      .eq('prayer_id', prayerId).eq('user_id', me()).eq('prayed_on', todayKey());
    if (error) fail('unpray')(error);
  },

  /** Who has prayed for this, ever. */
  async whoPrayed(prayerId) {
    const { data } = await sb().from('intercessions').select('user_id').eq('prayer_id', prayerId);
    const ids = [...new Set((data ?? []).map((r) => r.user_id))];
    const names = await profileMap(ids);
    return ids.map((id) => names[id]?.name ?? 'Someone');
  },
};

/** Distinct people, not raw rows: praying daily for a month is one person. */
async function prayerCounts(prayerIds) {
  const { data } = await sb().from('intercessions').select('prayer_id,user_id').in('prayer_id', prayerIds);
  const seen = {};
  (data ?? []).forEach((r) => { (seen[r.prayer_id] ??= new Set()).add(r.user_id); });
  const out = {};
  Object.entries(seen).forEach(([k, v]) => { out[k] = v.size; });
  return out;
}

async function myPrayersToday(prayerIds) {
  const { data } = await sb().from('intercessions')
    .select('prayer_id').eq('user_id', me()).eq('prayed_on', todayKey()).in('prayer_id', prayerIds);
  return new Set((data ?? []).map((r) => r.prayer_id));
}
