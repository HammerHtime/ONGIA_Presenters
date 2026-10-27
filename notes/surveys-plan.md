# Event surveys: plan and deliverables

Andrew, 27 Oct 2026. Surveys are built into the desk, replacing SurveyMonkey.

## Decided

- **Bilingual.** The survey has an English/Français switch at the top, like the food-allergy form. The email carries both languages.
- **Anonymous.** Answers are stored with no name attached. The desk only records that someone answered, so they aren't reminded.
- **Questions.** Based on past ONGIA surveys (Andrew is uploading examples). There's a 1–5 rating block for each presenter, with the presenter's name and topic filled in from the event's presenter list.
- **When it goes.** A switch on each event:
  - *After the event*: one survey covering every session, sent on a chosen day.
  - *Daily*: a survey on that day's presenters only, sent **15 minutes after the day's last session ends** (Andrew 27 Oct 2026). The end time is the one saved for that day under Agenda and daily times, in the event's local time zone. If a day has no end time saved, the survey card says so and holds that day back until one is set; it does not guess. Sending this often needs a short check every 15 minutes, separate from the once-a-day morning run.
- **National Gang Summit.** Community partners (Nov 10–11) only see, and are only sent, their own days' sessions.
- **Results.** Download as PDF, a summary with charts, and individual responses (Excel). Claude's analysis of what attendees liked and didn't, backed by numbers and quotes. A one-page infographic button that matches Andrew's past ONGIA infographics (he is uploading examples).

## Deliverables, in order

1. [ ] Survey: bilingual, anonymous, daily or after the event, sent by email from the event's Communications tab.
2. [ ] Results: PDF, chart summary, individual responses, Claude's analysis, one-page infographic. Waits on Andrew's example surveys and infographics.
3. [ ] **Text messages (Twilio). Deferred: remind Andrew once he's happy with the survey.**
   - Andrew makes the phone number required on each event's Wix registration form, and adds an "OK to text me about this event" consent checkbox (Canada's anti-spam law).
   - The desk pulls the phone number (and the consent) from Wix with the rest of the registration.
   - Andrew creates a Twilio account and buys a Canadian number, roughly a few dollars a month plus a cent or two per text. Expect a short verification step before texts can go out. He adds the keys in Netlify himself; never paste them into chat.
   - Each person gets the survey by email and by text, each with their own short link.
   - Phone numbers are deleted from the desk 30 days after the event.
   - Why: attendees often register with work emails that sit on out-of-office until the conference is over.

## Waiting on Andrew

- Example surveys from past events.
- Example infographics.
