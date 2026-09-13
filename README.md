# ONGIA Presenter Agreement Desk

Replaces the emailed PDF presenter agreement with a phone-friendly form, a
board review step, and a single signed final PDF that is emailed to the
presenter and filed to SharePoint.

## Flow

1. Coordinator creates an **event** (`/admin.html`): title, city, venue, dates,
   ONGIA contact, the board members involved (one marked **lead** — they review
   and sign; all are notified), the event's SharePoint folder (a pasted link or
   path; blank uses `ONGIA Board/ONGIA Training/<year>/<year> <City>`, which the
   event page can create), the file-request link for materials, and optionally
   the first presenters. Deadlines are derived
   from day one of training (agreement −90 days, draft materials −50, final
   materials −30; weekends, statutory holidays and the Dec 24–Jan 1 shutdown
   pull each one back to the previous working day).
2. Coordinator adds presenters (name, email, organization). Each gets a unique
   link `/a/<token>` — no account, no password. "Email link" sends it.
3. Presenter fills in the form (English or French — a switch in the top bar;
   Québec presenters' emails then follow their choice, while the filed PDF stays
   English), says which costs their **agency** covers, uploads a headshot, and
   signs by typing their name.
4. A board member opens **Review**, ticks what **ONGIA** covers, signs.
   Only then is the final PDF generated, emailed to the presenter, filed to
   `<event folder>/<First Last>/<Last>_Presenter Agreement.pdf` (plus the
   headshot) and the board notified.

## Reminders

`netlify/functions/remind.mjs` runs daily at 14:00 UTC. Presenters who have
been sent their link but not submitted are nudged 14, 7 and 1 days before the
agreement deadline, on the day, and every 7 days after; the board gets a digest
3 days past the deadline and weekly while anyone is still outstanding.
`GET /api/remind?dry=1` (admin key) previews today's run without sending.

## Hosting

Netlify: static `public/`, functions in `netlify/functions/`, data in Netlify
Blobs (store `ongia-agreements`). Pushes to `main` deploy.

Environment variables (Functions scope):

| Key | Purpose |
| --- | --- |
| `ADMIN_KEY` | Shared key for the admin screens |
| `APP_URL` | Public address used in every emailed link (e.g. `https://ongia-presenter-agreements.netlify.app`); update it if the site moves to a custom domain |
| `MS_MAIL_FROM` | Mailbox the app sends as through Microsoft 365 (e.g. `ongiaspeakers@ongia.ca`); needs `Mail.Send` (Application) with admin consent. Preferred transport |
| `MS_MAIL_FROM_NAME` | Display name for that sender; defaults to `ONGIA Training` |
| `RESEND_API_KEY`, `MAIL_FROM` | Fallback transport (Resend) when `MS_MAIL_FROM` is not set; needs a fully verified sending domain |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | Entra app (Sites.Selected) for SharePoint filing. The secret is the **Value** shown once at creation, not the Secret ID |
| `MS_SITE_URL` | Optional; defaults to the ONGIA Board Members site |

Environment changes only reach the functions on the next deploy — trigger one
after editing a variable. `GET /api/health` (admin key) confirms the Microsoft
sign-in and, with `?folder=`, that an event folder exists.

Missing email or Microsoft credentials never block an approval — the
dashboard shows what didn't land, and **Retry** re-runs just those parts.

## Running locally

`npm run dev:mock` serves the site and functions on http://localhost:8788 against
an in-memory store (admin key `testkey`). Email and SharePoint are skipped unless
the real environment variables are set, so it's safe for clicking through.
