# ONGIA Presenter Agreement Desk

Replaces the emailed PDF presenter agreement with a phone-friendly form, a
board review step, and a single signed final PDF that is emailed to the
presenter and filed to SharePoint.

## Flow

1. Coordinator creates an **event** (`/admin.html`): title, city, venue, dates,
   the board members involved (exactly one marked **lead**, which is required —
   they are the contact presenters reply to and whose name, email and phone
   print on the agreement; they review and sign; all are notified), and
   optionally the first presenters. The lead's name, email and phone number are
   their entry on the board list (`/api/roster`) and nowhere else — there is no
   per-event contact to type, so a number can never be recorded against the
   wrong person. Change the number on the board list and every event using that
   lead picks it up, with no re-saving. Events read back before this rule are
   reconciled on read, so a contact left behind by a previous lead is replaced. Nothing about SharePoint is typed: the app
   creates `ONGIA Board/ONGIA Training/<year>/<year> <City>` and an upload-only
   (Request files) link itself. A "use an existing folder or upload link"
   toggle on the form takes a pasted folder link/path or a Request-files link;
   a pasted link is accepted only if it is upload-only, and an app-made link is
   re-made if the folder is later moved. Deadlines are derived
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
   `<event folder>/Presenter Agreements/<First Last> <year>/<Last>_Presenter Agreement.pdf` (plus the
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
| `ADMIN_KEY` | Shared key for the admin screens. To change it: edit the value in Netlify, then trigger a deploy — functions only pick up variables at deploy time. Everyone signed in with the old key is signed out |
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

## Typed signatures

A presenter or board member signs by typing their name. It is drawn in a script
face (Great Vibes, SIL Open Font Licence — `public/assets/fonts/OFL-GreatVibes.txt`)
on the signature line, with the plain typed name printed beside it so the
signature is always legible. The PDF falls back to an italic face if the font
file is missing from the bundle.

## Unsent answers

The presenter form keeps answers in the browser's local storage as they are
typed, under `ongia-draft-<token>`, and restores them on the way back in. Phones
discard background tabs and the form only reaches the server when it is signed,
so without this a 250-word biography is lost on a tab switch. The copy is keyed
by the link's token, so a shared device never shows one presenter's answers to
another, and it is deleted the moment the agreement is sent. A record on the
server that is newer than the device copy wins, which covers signing on a second
device.

## What the desk flags

The admin home opens with **Needs you now**, built from the events list alone:
agreements waiting for a signature (each links straight to that presenter),
presenters whose link was never sent, agreements that never reached SharePoint,
emails that could not be sent, blocked events, and overdue agreements. When
there is nothing, it says so.

Three states used to hide:

- **Never sent.** A presenter with no mail history gets no reminders, ever. They
  now have their own state, filter, count and a line in the board's overdue
  digest.
- **Blocked event.** No lead, no upload link or no SharePoint folder each break
  something quietly (no contact on the agreement, no materials reminders at all,
  nothing filed). The event page names them and offers the fix.
- **Approved but not filed.** A filing failure no longer counts as finished; the
  row carries **Retry filing**.

Rows say how hard the desk has chased and when the next automatic reminder goes
out. **Called them** logs a phone call and pauses reminders for a week, since
after four emails a call is what works. Navy means waiting on ONGIA, amber
waiting on the presenter, so the two read differently in greyscale.
