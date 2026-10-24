# CFAOC website sync: decisions

Spec: HammerHtime/general, branch claude/chief-of-staff-advisor-fyhzd1, chief-of-staff/cfaoc-website-sync-spec.md

- 22 Oct 2026 (Andrew): the Website section and the "Update website" button appear only on events
  whose title starts with "Canadian Forum Against Organized Crime" (Western, Eastern, and later
  Central Symposium). Every other event is unchanged.
- Each event gets a "website page" field naming its section of the site. The current Western
  Symposium fills the existing `victoria` page. Eastern and Central get their page names when
  they are created.
- The token lives in Netlify as CFAOC_GITHUB_TOKEN (Functions scope, Production only), so test
  copies of the desk cannot publish to the live website.

## How it is built (22 Oct 2026)

- The desk never rewrites the website's events.json. It owns `desk/<page>.json` in cfaoc-symposium (plus
  photos under `static/assets/speakers/<page>/`); the site's build.js lays that file over the event with the
  same page name (slug, or region for a "to be announced" city) or adds a new city. Reason: the website's own
  wording (FAQ, themes, hotel photos and highlights) keeps being edited on the website side, and a whole-file
  rewrite from the desk would fight those edits.
- One press = one commit on main through the GitHub git data API, message naming the event and who pressed.
  Undo = revert that commit. The desk file has no timestamps, so pressing twice makes no commit.
- Consent: `lib/public.mjs` `publicConsent()` is the one rule, used by the presenter export and the website.
  Signed (submitted/approved) + yes to public summary; photo only with yes to public photos; bio per the new
  "Your biography" line on the agreement (yes; no = listed without a bio; not asked = "legacy", today's rule).
- The desk owns: date, start/end time, registration link (the Wix link if none typed), venue name/street/postal
  code, hotel name, public rate, booking link, group code, booking deadline, short description, program,
  presenters (name, job title, organization, bio, photo) and the French of each. Everything else stays on the site.
- The hotel's contract rate (event.hotel.rate) is never published; the public rate is its own field.
- French: Claude drafts on request (the existing ANTHROPIC_API_KEY); staff edit; a "checked" tick per presenter.
  Missing French falls back to English and is flagged in the summary; it does not block publishing.
- "Bring over what the website shows today" fills empty boxes once from events.json (times, address, rate,
  program with its French, job titles and French bios matched by name). French brought over is not marked checked.
- A presenter on the website with no signed, public agreement in the desk comes off the speaker cards on the
  first update (the summary names them). Names typed in a program line stay: that is staff's own text.
- Only the president and VP (mayCost), only events titled "Canadian Forum Against Organized Crime…".

- 23 Oct 2026 (Andrew): no headshots on the CFAOC website, whatever a presenter agreed to. The desk sends none, and
  takes down any under static/assets/speakers/<page>/. The summary names anyone whose photo comes off.
