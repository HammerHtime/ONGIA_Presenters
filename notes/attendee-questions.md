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
