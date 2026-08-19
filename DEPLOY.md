# Getting Cairn online

Nothing here costs money, and none of it needs a credit card.

---

## 1. Put the code on GitHub

Create a new repository (name it `cairn`), then from this folder:

```bash
git remote add origin https://github.com/YOUR_USERNAME/cairn.git
git branch -M main
git push -u origin main
```

## 2. Deploy it on Netlify

1. netlify.com → **Add new site → Import an existing project** → GitHub → pick `cairn`.
2. Leave the build command empty and the publish directory as `.` — `netlify.toml`
   already says so. There is no build step.
3. Deploy. You get a URL like `cairn-abc123.netlify.app`.
4. Site configuration → **Change site name** to something you'd say out loud.

Every push to `main` redeploys automatically from here on.

**Write your final URL down — the next two steps both need it.**

## 3. Create the database

1. supabase.com → your `cairn` project → **SQL Editor** → New query.
2. Paste all of `supabase/schema.sql` and **Run**. It's safe to run twice.
3. **Settings → API** → copy the **Project URL** and the **anon public** key
   into `config.js`:

```js
supabaseUrl:     'https://xxxxxxxxxxxx.supabase.co',
supabaseAnonKey: 'eyJhbGciOi...',
```

Both are meant to live in public frontend code. The database is protected by the
row-level security policies in the schema, not by hiding these.

Push that change and Netlify redeploys. Sign-in now appears in the app.

## 4. Turn on Google sign-in

**In Google Cloud Console** (console.cloud.google.com):

1. New project → name it Cairn.
2. **APIs & Services → OAuth consent screen** → External → fill in app name,
   your support email, and your developer email. Save through to the end.
3. **Credentials → Create credentials → OAuth client ID** → Web application.
4. **Authorised JavaScript origins:** `https://YOUR-SITE.netlify.app`
5. **Authorised redirect URIs:** `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
   (Supabase shows you this exact URL in the next step — copy it from there.)
6. Copy the **Client ID** and **Client secret**.

**In Supabase:**

1. **Authentication → Sign In / Providers → Google** → enable.
2. Paste the Client ID and secret. Save.
3. **Authentication → URL Configuration → Site URL:** `https://YOUR-SITE.netlify.app`
4. Add the same URL under **Redirect URLs**.

Sign in with Google now works, and everything syncs across devices.

> While the OAuth consent screen is in "Testing", only accounts you list as test
> users can sign in. Publish it when you're ready for real people. For basic
> name/email scopes, publishing does not require Google's verification review.

## 5. The finishing touches

- **Ko-fi** — already set in `config.js`.
- **Email list** — Buttondown's free tier covers your first 100 subscribers. Put the
  form action URL in `CONFIG.emailListAction` and the signup box appears in Settings.
- **Custom domain** — Netlify → Domain management. HTTPS is automatic and free.

## If something breaks

| Symptom | Cause |
|---|---|
| "Saved in this browser" won't go away | `config.js` keys are empty, or the browser blocked the Supabase CDN. |
| Google sign-in returns to a blank page | Site URL / Redirect URLs in Supabase don't exactly match the live site. |
| Nothing syncs, but sign-in works | The schema wasn't run, or RLS policies are missing. Re-run `schema.sql`. |
| Scripture card shows a Bible Gateway link instead of the text | bible-api.com was unreachable. The app is meant to degrade this way. |
