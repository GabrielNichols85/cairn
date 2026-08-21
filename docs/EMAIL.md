# Cairn, email

Four letters, one switch each, and a link at the bottom of every
one of them that turns it off without signing in to anything.

## What gets sent

| Letter | Default | When |
|---|---|---|
| Welcome | on | Once, within an hour of signing up |
| A prayer you forgot you prayed | on | On the anniversary of an answered prayer |
| A gentle look back | on, weekly | Weekly, every other week, or monthly, their choice |
| A nudge for the day's reading | **off** | Mornings they have not already read |

The reading nudge starts off on purpose. It is the only one that
would arrive whether or not anything happened, and an inbox that
fills up with those is an inbox where the anniversary letter, the
one worth reading, gets muted along with it.

At most one letter per person per run. Priority is anniversary,
then look back, then reading nudge.

## The pieces

- `supabase/emails.sql` — the `email_prefs` table, one row per
  account, created automatically by a trigger on signup. Row level
  security means only you can read your own row. Three security
  definer functions let an unsubscribe link work with no session.
- `src/emails.js` — the client side of the same.
- `src/views/settings.js` — the Email section.
- `src/views/unsubscribe.js` — `/unsubscribe/<token>?k=<kind>`.
- `netlify/functions/send-emails.mjs` — runs hourly, sends at the
  right local hour for each person.
- `netlify/functions/unsubscribe.mjs` — `/api/unsubscribe`, the
  one click endpoint Gmail and Outlook POST to.

## Turning it on

1. Make a Resend account and add `praycairn.com` as a domain.
2. Add the DNS records Resend gives you at Porkbun. Note that
   Porkbun needs **Add Record** and then **Submit Records**; the
   first button only stages it.
3. Create an API key in Resend.
4. In Netlify, Site settings, Environment variables, add:

   | Name | Value |
   |---|---|
   | `RESEND_API_KEY` | the key from Resend |
   | `SUPABASE_URL` | `https://wifzclmbhowdcafotmtb.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase, Settings, API, service role |
   | `MAIL_FROM` | `hello@praycairn.com` |
   | `MAIL_FROM_NAME` | `Cairn` |
   | `SITE_URL` | `https://praycairn.com` |
   | `OWNER_EMAIL` | where feature ideas should land |
   | `SEND_HOUR` | `7`, optional |
   | `DRY_RUN` | `1` to log instead of send, for a first run |

   The service role key is the only real secret here. It bypasses
   row level security completely. It belongs in Netlify and
   nowhere else, never in `config.js`, which is public.

5. Deploy. Netlify picks up the schedule from the function itself.

## First run

Set `DRY_RUN=1`, trigger the function once from the Netlify
Functions tab, and read the log. It prints one line per letter it
would have sent. When that looks right, remove `DRY_RUN`.
