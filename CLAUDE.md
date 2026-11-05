# ONGIA Briefing Room — working agreement

Live site: https://ongia-presenter-agreements.netlify.app
Owner: Andrew Hammond (president@ongia.ca)

## Definition of done (Andrew's standing expectation)

A change is not finished when the code is written, and not when it deploys.
It is finished when the **end result** has been checked from the user's side and
shown to do what was asked. Every change:

1. **Write it**, matching the surrounding code.
2. **Verify the code path** — unit/harness test, or read the diff adversarially.
3. **Test the end result as the user experiences it.** For a presenter-facing or
   admin-facing change that means driving the real page and looking at what
   renders; for a PDF change it means opening the produced PDF; for a mail change
   it means reading the produced message.
4. **Check it on production against real records**, not just locally. A deploy
   marker turning green is not evidence the feature works.
5. Report what was actually observed. If a step could not be run, say so.

Never report something as fixed on the strength of a local test plus a
successful deploy.

## Own the output, not just the code

Andrew should never be the one who discovers that an email is ugly on a phone,
that the wording is off, or that it never arrived. For every change:

- **Audit the diff.** Read it back adversarially before calling it done.
- **Produce the actual artefact.** Not a unit test standing in for it — the real
  PDF, the real page, the real email, from real data.
- **For anything that emails:** render the message at phone width and look at
  it. Check the layout, the font sizes, the tap targets, and that it reads well
  in both languages. Run the wording through the `humanizer` skill and correct
  what it flags.
- **If a send fails**, it does not get buried in a log. Add it to
  `reports/AUDIT-NEEDS-ANDREW.md` with what failed, why, and the fix — so the
  gap is visible without him testing for it.

He owns the decisions. I own the code, the output, the wording and the layout.

## How to test against production

Netlify Functions read live Blobs, so the only honest check uses real records.

- Read the live data:
  `curl -H "x-admin-key: $KEY" "$SITE/api/events?id=<eventId>"`
- Pull a stored headshot: `$SITE/api/headshot?event=…&presenter=…` (admin only).
- Pull an issued PDF: `$SITE/api/download?event=…&presenter=…` (409 until approved).
- Inspect a PDF: `pdfimages -list f.pdf`, `pdftoppm -png -r 110 f.pdf out`, then look.
- Drive a page headlessly: `scripts/dev-mirror.mjs` serves the local `public/`
  files and proxies `/api/*` to production, so a headless browser can exercise a
  page you just edited against real data over plain `http://127.0.0.1`.

## Rules of the road

- Approving an agreement is outward-facing: it emails the presenter, files to
  SharePoint and notifies the board. Ask before approving anything on Andrew's
  behalf.
- A presenter's headshot is embedded top-right on page 1 of the agreement and
  filed beside the PDF. Agreements submitted before that shipped have no photo —
  that is not a bug, and `Rebuild the PDF` on the review screen re-issues one.
- Board contact details (name, email, phone) come from the board roster, never
  from a per-event field.

## Layout standard: nice and tight (Andrew, 5 Nov 2026)

"All builds and screens need to be like this. Nice and tight." The model is the
welcome letter's *Who's had it* list. Every new screen, and any screen touched:

- **One line per row.** Name and detail on the left (cut off with … rather than
  wrapping), then the status as short coloured text (not a big pill), then one
  small button. About 38px a row on a phone.
- **Short labels.** "Not yet / Bounced / All", "Send / Resend", "Sent 3 Nov".
  No sentences inside buttons or filters.
- **Filters on one row**, small chips. A search box under them.
- **Settings and help folded away** behind one summary line that opens on click
  ("Goes Tue, Nov 3 · signed ONGIA Board · Change").
- **One thing at a time:** buttons that switch what shows, not long stacked cards.
- **On a phone:** nothing scrolls sideways; drop secondary detail (like a
  "4 days" count) before squeezing the main text into four lines.
- Check it at 390px wide on real data before calling it done.
