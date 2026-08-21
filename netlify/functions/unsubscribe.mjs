/* ============================================================
   Cairn, one click unsubscribe.

   Gmail and Outlook put an "Unsubscribe" button of their own at
   the top of a message when the sender promises this endpoint
   exists. They POST to it and expect the sending to stop. No
   page, no confirmation, no signing in.

   Honouring it properly is what keeps mail out of spam folders,
   and it is the right thing anyway: somebody who is done should
   be done in one tap.
   ============================================================ */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = (process.env.SITE_URL || 'https://praycairn.com').replace(/\/$/, '');

const KINDS = new Set(['remember', 'checkin', 'reading', 'product', 'all']);

export default async function handler(req) {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') || '';
  const kind = KINDS.has(url.searchParams.get('k')) ? url.searchParams.get('k') : 'all';

  /* A GET means a person is holding the link, so hand them the
     real page where they can see what they just turned off. */
  if (req.method === 'GET') {
    return Response.redirect(`${SITE}/unsubscribe/${encodeURIComponent(token)}?k=${kind}`, 302);
  }

  if (!token || token.length < 32) return new Response('bad token', { status: 400 });
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response('not configured', { status: 500 });

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/email_unsubscribe`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_token: token, p_kind: kind }),
    });
    if (!res.ok) throw new Error(await res.text());
  } catch (err) {
    console.error('[cairn] one-click unsubscribe failed', err);
    return new Response('error', { status: 500 });
  }

  return new Response('unsubscribed', { status: 200 });
}
