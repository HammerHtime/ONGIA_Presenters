# ONGIA Presenter Agreement Desk

Replaces the emailed PDF presenter agreement with a phone-friendly form, a
board review step, and a single signed final PDF that is emailed to the
presenter and filed to SharePoint.

## Flow

1. Coordinator creates an **event** (`/admin.html`): title, city, venue, dates,
   ONGIA contact, the board members involved (one marked **lead** — they review
   and sign; all are notified), the event's SharePoint folder (a pasted link or
   path; blank uses `ONGIA Board/ONGIA Training/<year>/<year> <City>`), and
   optionally the first presenters. With Microsoft connected the app creates the
   folder and an upload-only (Request files) link itself; a pasted link is
   accepted only if it is upload-only. Deadlines are derived
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

`netlify/functions/remind.mjs` runs daily at 14:00 UTC. Reminders tighten as a
deadline nears:

- **Agreements** (presenters who have been sent their link but not submitted):
  28, 14, 7, 4, 2 and 1 days before the deadline and on the day; overdue, every
  3 days for two weeks, then weekly. Each says how many days are left.
- **Materials** (agreement in, but no draft/final upload detected or ticked):
  14, 7, 3 and 1 days before each materials deadline and on the day; same
  overdue pattern. The request folder is scanned first.
- **Board**: an overdue digest 3 days past the agreement deadline, weekly after.
- **Board**: one Monday email covering every upcoming event (to `DIGEST_TO`,
  default president@ and vp_operations@): the numbers, what's overdue and who is
  still outstanding, what's next, and a button into each event on the admin page.

`GET /api/reminders?dry=1` (admin key) previews today's run without sending;
`?digest=1` includes the lead's summary whatever the weekday.

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
| `DIGEST_TO` | Optional; recipients of the Monday summary, comma-separated (default president@ongia.ca, vp_operations@ongia.ca) |

Environment changes only reach the functions on the next deploy — trigger one
after editing a variable. `GET /api/health` (admin key) confirms the Microsoft
sign-in and, with `?folder=`, that an event folder exists.

Missing email or Microsoft credentials never block an approval — the
dashboard shows what didn't land, and **Retry** re-runs just those parts.

## Running locally

`npm run dev:mock` serves the site and functions on http://localhost:8788 against
an in-memory store (admin key `testkey`). Email and SharePoint are skipped unless
the real environment variables are set, so it's safe for clicking through.
