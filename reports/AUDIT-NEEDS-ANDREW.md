# Needs Andrew

Things I could not prove myself, or that failed. Each one says what happened,
why, and what the fix is. Nothing here should require you to test for it — it
is here because I hit the edge of what I can verify without your say-so.

Updated 24 September 2026.

---

## 1. The room-and-equipment email has not been proved on production

**Status:** wired, tested, and correct in every check I can run alone. Not yet
observed leaving the building.

**What is proved.** Approving an agreement attempts the email and records the
outcome separately from the agreement email (`delivery.avRequest`). The message
carries the presenter's own link, names the deadline, is signed by the event's
lead, exists in English and French, renders with no sideways scroll at 375 px,
and its button is a real tap target. A presenter who has already answered is
not asked again.

**What is not proved.** That a real message arrives in a real inbox. In the
local harness the send is refused with *"No email transport is configured"* —
that is the test environment having no Microsoft credentials, not a fault in
the code. Production **can** send: `/api/health` reports the transport live as
`ONGIA Training <ongiaspeakers@ongia.ca>` with `Mail.Send` granted.

**Why I stopped.** The only way to see the real email is to approve a real
agreement, which emails a presenter, files to SharePoint and notifies the
board. That is your call, not mine.

**The fix / what I need.** Say the word and I will approve one of the test
presenters on the Regina event, confirm the send returned `ok: true`, and show
you the delivery record. Roughly two minutes.

---

## 2. Toronto (National Gang Summit) is not set up to chase anybody

**Status:** operational, not a code fault. Unchanged since 19 September.

- The event has **no lead board member**, so its agreements have no ONGIA
  contact and replies fall through to the speakers mailbox.
- Its upload link reads **unverified** and the last folder scan found **0
  files**, so materials reminders — and now the room-and-equipment chase, which
  runs against the same date — may not be reaching anyone for that event.

**The fix.** Edit the event, mark one board member as lead, and re-create the
upload link. I can walk it with you, but the choice of lead is yours.

---

## 3. The sponsor folder link resolves to a training year, not a sponsors folder

**Status:** saved and working on production. Possibly not the folder you meant.

The link you pasted resolves to:

    ONGIA Board/ONGIA Training/2027

That is the 2027 training year folder. Every other folder the app files into is
a named event folder inside a year — `ONGIA Board/ONGIA Training/2026/2026
Regina Symposium`. Filing sponsors here would drop logos and signed
sponsorship agreements loose into the 2027 folder, beside the event folders
rather than inside one of them.

**What I need.** Either confirm that is where sponsors should go, or paste a
link to the folder you actually want — for example a `Sponsors` folder. The
app resolves it the moment you save it on the Sponsors tab, so it is one paste
either way.
