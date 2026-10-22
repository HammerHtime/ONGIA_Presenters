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
