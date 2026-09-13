# ONGIA Presenter Agreement Desk

Replaces the emailed PDF presenter agreement with a phone-friendly form, a
board review step, and a single signed final PDF that is emailed to the
presenter and filed to SharePoint.

## Flow

1. Coordinator creates an **event** (`/admin.html`): title, city, venue, dates,
   ONGIA contact, board emails to notify, the event's SharePoint folder, and
   the file-request link for presentation materials. Deadlines are derived
   from day one of training (agreement −90 days, draft materials −50, final
   materials −30; weekends, statutory holidays and the Dec 24–Jan 1 shutdown
   pull each one back to the previous working day).
2. Coordinator adds presenters (name, email, organization). Each gets a unique
   link `/a/<token>` — no account, no password. "Email link" sends it.
3. Presenter fills in the form, says which costs their **agency** covers,
   uploads a headshot, and signs by typing their name.
4. A board member opens **Review**, ticks what **ONGIA** covers, signs.
   Only then is the final PDF generated, emailed to the presenter, filed to
   `<event folder>/<First Last>/<Last>_Presenter Agreement.pdf` (plus the
   headshot) and the board notified.

## Hosting

Netlify: static `public/`, functions in `netlify/functions/`, data in Netlify
Blobs (store `ongia-agreements`). Pushes to `main` deploy.

Environment variables (Functions scope):

| Key | Purpose |
| --- | --- |
| `ADMIN_KEY` | Shared key for the admin screens |
| `RESEND_API_KEY` | Outbound email (Resend); without it sends are skipped and recorded |
| `MAIL_FROM` | Optional; defaults to `ONGIA Training <agreements@send.ongia.ca>` |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | Entra app (Sites.Selected) for SharePoint filing |
| `MS_SITE_URL` | Optional; defaults to the ONGIA Board Members site |

Missing email or Microsoft credentials never block an approval — the
dashboard shows what didn't land, and **Retry** re-runs just those parts.
