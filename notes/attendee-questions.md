# Housekeeping questions for attendees (food allergies, socials)

Andrew, 26 Oct 2026, for the National Gang Summit (9–12 Nov 2026).

- One email to everyone registered (attending, with an address; once per address), with one button to a short
  form at /q/<token>. The token belongs to the event, not the person, so one person can answer for a guest on
  their registration. The same name at the same address answering again replaces the earlier answer.
- The form: first name, last name, agency, email; "I have a food allergy, intolerance or dietary need" (only if
  they have one) with free text; yes or no to each social. English and French.
- Answers are two separate lists, each its own .xlsx:
  - Dietary list for the hotel, laid out like Andrew's sheet: "Allergy / Dietary List", "ONGIA – <event>, <dates>",
    a blank row, then First Name | Last Name | Allergy / Dietary | Table Number (If Applicable). Arial; A,B,D 16
    wide, C 48; header bold on D9D9D9 with thin borders. Only people who reported something.
  - Socials list: First Name | Last Name | Agency | yes/no per social, totals underneath. No food details.
- Reply-by date: Andrew's "end of this week" = Friday 30 Oct 2026, end of day. The form stays open after it (late
  answers say the date has passed) until it is closed on the event page.
- Sending is a button on the event's Communications tab, with a confirm; a run stops before Netlify's time limit
  and the page calls again until everyone is sent. After that, the nightly run sends it to anyone who registers
  later, up to the reply-by date, while automatic attendee emails are on.
- Each answer is its own record (reply:<eventId>:<id>), so two people answering at once never overwrite each other.

## 26 Oct 2026, second round (Andrew)
- Food allergies on every event; the socials only on the National Gang Summit (title match). An event with no socials
  sends a one-question email and has no socials list.
- The form opens with "Do you have a food allergy, intolerance or dietary need?" Yes / No (required). Yes shows the box.
- Each person's email carries their own link (/q/<token>/<id>, id = sha256(token:attendee key)), which fills in their
  name, email and agency (when the desk has it; Wix does not send agency) and anything they already answered.
- People who told Andrew before the form: "Add someone by hand", or "Add from your spreadsheet" (his hotel-layout
  .xlsx). They go on the dietary list only. Someone on both is listed once, with the latest answer and the sheet's table.
- The Summit email speaks to community partners (Nov 10–11) as well as full-Summit attendees.
- Community partners register on a separate Wix event. Decision: link it to the same desk event ("Also pull a second
  Wix event"), labelled "Community partners", rather than a one-off CSV, so later registrations arrive nightly. Each
  pull only withdraws people from its own Wix event.

## 26 Oct 2026, third round (Andrew)
- Agency comes across from the Wix registration form: any form field named like agency / organization / company /
  employer / service. The housekeeping form fills it in from there.
- "See the email" is now the editor too: words on one side, the email redrawn as you type (400 ms after the last
  key), checked the same way as a send (a misspelt blank shows). "Save these words" keeps them; closing does not.

## 26 Oct 2026: the community partners' Wix event is on a separate Wix site
- It is "National Gang Summit" (ngstoronto2026.ca), on the same Wix account as ongia.org. The desk reads a second
  site from WIX_SITE_ID_2 (WIX_API_KEY_2 only if a site is on another account; the account's key reaches every site
  it was given; WIX_SITE_2_NAME for how the desk names it). Each linked event remembers which site it is on.

## 26 Oct 2026: reminders (Andrew: "Wednesday and Friday, if they haven't completed the form")
- Dates per event, default two days before the reply-by date and the day itself (Summit: Wed 28 and Fri 30 Oct).
- The morning run (10 AM Eastern) sends the same email with one reminder line after the greeting, subject
  "Reminder: …", to registered addresses that had the email and where nobody has answered yet; once per address per
  date; never to someone first emailed in that same run; not after the reply-by date or while the form is closed.
- Like the late-registrant catch-up, reminders only go while automatic emails to attendees are on; the card says so.
- 26 Oct 2026 (Andrew): nobody who has already told us is emailed or reminded: anyone who answered the form, and
  anyone on his sheet or added by hand (no email, so matched to a registration by first and last name). The send
  button counts only who would actually get it, and says how many are skipped.
- The answers summary is one compact line each (food; each social with its date), counts and download on the line.

- 27 Oct 2026: Andrew supplied the Summit email wording himself ("A Few Quick Questions"). It is now the Summit's suggested wording, with headings Dietary Requirements / Social Events / How to Respond, button "Complete the survey", and the socials renamed "Networking Reception followed by a screening of the documentary WATTS" and "Evening Social at the hotel featuring a live performance by District 6". Pressing "Use the suggested wording" also refreshes the two social names (dates kept). Kept his text as written.

- 27 Oct 2026: Andrew dropped the long Summit title line from the top of the email (and its French twin). Earlier the same day he asked for the email in two halves: English with its link on top, French with its link below, the French link opening the questions in French. New blanks {replyButton} / {replyButtonFr} (a button where the line stands; with either in the body no button is added at the bottom), {replyLinkFr}, {replyByFr}, {social1Fr}, {social2Fr}. Links carry ?lang=en / ?lang=fr and the answer page follows it over a remembered choice. French button words are their own field. The French half is my translation of his English; reminders add the reminder line in both halves and the subject reads "Reminder / Rappel".

- 27 Oct 2026: the Summit questions email is signed "ONGIA Board", ngs@ongia.ca, and replies go there, for this email only (not the event's lead, Raj). "Signed by" and "Its email" are fields on the card; empty means the lead as before. "Use the suggested wording" fills them for the Summit.

- 27 Oct 2026: Andrew's test still went out in the original wording (he had not pressed "Use the suggested wording"). An untouched original Summit email is now brought up to his wording automatically the next time the card or the form is opened (freshenedReply). Edited emails and sent emails are left alone.
