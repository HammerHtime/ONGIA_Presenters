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

## The infographic (Andrew 27 Oct 2026, from the Crime at the Crossroads and Calgary 2025 examples)

- **Style.** ONGIA navy and gold. A clean white (or navy) background with the palette, not a photo. The header carries a simple line drawing that signifies the city: the CN Tower for Toronto, the Esplanade Riel bridge for Winnipeg, the Calgary Tower, and so on, or the event's own graphic if one is uploaded. Plain if there's neither.
- **Blocks, all from the survey and the event:**
  - title and dates;
  - attendees: how many answered, and the agencies they're from;
  - province breakdown, grouped by real province, never cities;
  - years of experience;
  - overall quality, as a percentage rating 4 or 5 plus the average out of 5;
  - topics, from the presenters' talk titles, each with an icon;
  - key takeaways: relevance, pace, confidence, variety, practical strategies;
  - 4 or 5 of the best comments, picked by Claude and shown anonymously.
- **Survey questions this needs.** Province and agency are asked **in the survey** (Andrew: "for sure"), along with: overall quality; relevance to role; pace (too slow, about right, too fast); confidence applying; variety and depth; practical strategies (each 1–5 unless noted); years of experience (0–5, 6–10, 11–15, 16–20, 20+); each presenter rated 1–5 with an optional comment; and an open "anything else". Andrew's past surveys may add to this list.
- **Outputs, always in English and French:**
  - one tall PDF and the same as a PNG;
  - a "Make social media images" button that splits it into about seven square images, one per block: the event, agencies, provinces, experience, overall rating, topics, takeaways, and quotes;
  - every output shown on screen first, so wording can be fixed before download.

## The questions (from Andrew's 2025 Kingston Day 1, 2 and 3 SurveyMonkey surveys)

The Kingston surveys asked, every day: **About you** (agency; province; years of service: less than 3, 4–8, 9–15, 16–20, 21+; attended ONGIA before; considering attending again; how did you hear), then for each presenter, with the talk title and the presenter's name, six statements on a Strongly disagree – Strongly agree scale (some with N/A):
relevant to my work; improved my knowledge; met my expectations; the presenter was knowledgeable; engaging and compelling; rate the delivery. Then "Any additional comments?"

Fixed in the desk's version:

- **One scale, one direction.** Kingston's scales flipped between Strongly agree first and Strongly disagree first, and had typos ("Diagree", "Disgree", "Agree" in place of "Disagree", "Strongly Disagree" at both ends). That invites wrong clicks and spoils the numbers. Here it is always 1 Strongly disagree → 5 Strongly agree, left to right, with N/A at the end.
- **"Rate the delivery"** on an agree scale doesn't read. It becomes the statement "The presentation was well delivered."
- **Years of service** had a gap (exactly 3 years fit nowhere). It becomes 0–3, 4–8, 9–15, 16–20, 21+.
- **Province** is a list of provinces and territories, so cities can't end up in it.
- **About you is asked once,** on the person's first survey. Their own link remembers it was answered, without storing who they are, so on a four-day daily survey they aren't asked four times.
- **An "Overall" section** (needed for the infographic and missing from Kingston): overall quality, pace (too slow, about right, too fast), confidence applying what was learned, variety and depth of topics, practical strategies, and anything else. In daily mode it goes on the last day's survey; after the event, on the one survey.

## Agencies, one name each (Andrew 27 Oct 2026)

- People type their agency many ways: TPS, Toronto Police and Toronto Police Service; OPP, Ontario Provincial Police and OPP - Gang Unit. The desk keeps one master list, shared by every event. Each agency has its standard name, province (blank for federal) and the spellings people use. Units after a dash, comma or bracket, or named as a unit, are ignored for matching.
- Each event's People → Who's coming → Agencies box groups the registrations by standard name. Anything it can't place goes on a short review list, with a Claude suggestion, to be confirmed once. After that it's known for every event. What each person typed is kept as they typed it.
- **Master list:** Andrew downloads the spellings of the last two years of Wix registrations from that box ("Every Wix event", "Download the spellings for Claude"; no names or emails) and uploads the file in chat. Claude compiles the master list from every variation and builds it into the desk as the starting list.
- The survey's agency question is a pick-list of the standard agencies registered for the event, plus "Other".
- **Required answers:** all six statements per presenter are required, each with N/A, plus a "Didn't attend this session" skip per presenter. Comments stay optional.

## Deliverables, in order

1. [ ] Survey: bilingual, anonymous, daily or after the event, sent by email from the event's Communications tab.
2. [ ] Results: PDF, chart summary, individual responses, Claude's analysis, one-page infographic.
3. [ ] **Text messages (Twilio). Deferred: remind Andrew once he's happy with the survey.**
   - Andrew makes the phone number required on each event's Wix registration form, and adds an "OK to text me about this event" consent checkbox (Canada's anti-spam law).
   - The desk pulls the phone number (and the consent) from Wix with the rest of the registration.
   - Andrew creates a Twilio account and buys a Canadian number, roughly a few dollars a month plus a cent or two per text. Expect a short verification step before texts can go out. He adds the keys in Netlify himself; never paste them into chat.
   - Each person gets the survey by email and by text, each with their own short link.
   - Phone numbers are deleted from the desk 30 days after the event.
   - Why: attendees often register with work emails that sit on out-of-office until the conference is over.

## Waiting on Andrew

- Nothing; examples received 27 Oct 2026.
