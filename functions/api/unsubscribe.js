/* ============================================================
   Cairn, one click unsubscribe. Cloudflare Pages Function.

   Gmail and Outlook put an "Unsubscribe" button of their own at
   the top of a message when the sender promises this endpoint
   exists. They POST to it and expect the sending to stop. No
   page, no confirmation, no signing in.

   Honouring it is what keeps mail out of spam folders, and it is
   the right thing anyway: somebody who is done should be done in
   one tap.

   Note for anyone porting more of these from Netlify: there is no
   process.env here. Secrets arrive on `env`, which Pages hands to
   the handler, and they are set under the project's Settings.
   ============================================================ */
const KINDS = new Set(['remember', 'checkin', 'reading', 'product', 'all']);

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('t') || '';
  const kind = KINDS.has(url.searchParams.get('k')) ? url.searchParams.get('k') : 'all';
  const site = (env.SITE_URL || 'https://praycairn.com').replace(/\/$/, '');

  /* A GET means a person is holding the link, so hand them the real
     page where they can see what they just turned off. */
  if (request.method === 'GET') {
    return Response.redirect(`${site}/unsubscribe/${encodeURIComponent(token)}?k=${kind}`, 302);
  }
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

  if (!token || token.length < 32) return new Response('bad token', { status: 400 });
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response('not configured', { status: 500 });
  }

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/email_unsubscribe`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
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
