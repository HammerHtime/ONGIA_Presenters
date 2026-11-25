/**
 * The one-page infographic from an event's survey, laid out like Andrew's Calgary 2025 example (17 Nov 2026): dark
 * navy and gold, the city and year over the event's name with a line drawing of the city; how many attended (not how
 * many answered) and from how many agencies; the sessions and days; the provinces in a ring; the agencies with a
 * sector line; the training summary; the survey's rating split and average beside 4 or 5 comments, each with that
 * person's rating; and an "at a glance" row. In English or French. `block` draws one section on its own as a square
 * image for social media.
 *
 * The page is plain HTML and inline SVG, so the event page can show it, let Andrew fix any wording on it, and turn it
 * into a PNG and a PDF.
 */

import { esc } from "./text.mjs";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { provinceOfEvent } from "./ongiayear.mjs";

// The ONGIA logo with its tagline (white leaf, gold letters, for a dark background), inside the page so the picture made from it has it too.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGO_FILE = [path.resolve(HERE, "../../../public/assets"), path.resolve(HERE, "../../public/assets"), path.resolve(process.cwd(), "public/assets"), "/var/task/public/assets"]
  .map((d) => path.join(d, "ongia-logo-tagline-dark.png")).find((f) => existsSync(f));
// Canada's provinces, already projected (the same map the year reports use), for the province map.
const MAP_FILE = [path.resolve(HERE, "../../../public/assets"), path.resolve(HERE, "../../public/assets"), path.resolve(process.cwd(), "public/assets"), "/var/task/public/assets"]
  .map((d) => path.join(d, "canada-map.json")).find((f) => existsSync(f));
const CANADA = MAP_FILE ? JSON.parse(readFileSync(MAP_FILE, "utf8")) : null;
/**
 * The province map (Andrew 17 Nov 2026: "I like … how you color the map and then highlight in yellow the actual
 * province with the number. Let's do that with everyone"): the provinces the audience came from in blue, deeper for a
 * bigger share; the province the event was held in, gold, with how many came on a badge just off it.
 */
function provinceMap(host, shares, came, width, badgeScale = 1) {
  if (!CANADA) return "";
  const k = 1000 / width, max = Math.max(1, ...Object.values(shares));
  const mix = (t) => { const a = [0x1d, 0x3f, 0x72], b = [0x72, 0x9c, 0xdc]; return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(",")})`; };
  const fill = (code) => (code === host ? GOLD : shares[code] ? mix(Math.sqrt(shares[code] / max)) : "#122a4f");
  const paths = Object.entries(CANADA.paths).map(([code, d]) => `<path d="${d}" fill="${fill(code)}" stroke="#020d1c" stroke-width="${(1.6 * k).toFixed(1)}" stroke-linejoin="round"/>`).join("");
  let badge = "";
  const a = CANADA.anchors?.[host];
  if (a && came) {
    const z = k * badgeScale, r = 17 * z, bx = Math.min(CANADA.w - r - 4, a[0] + 26 * z), by = Math.max(r + 4, a[1] - 30 * z);
    badge = `<line x1="${a[0]}" y1="${a[1]}" x2="${bx}" y2="${by}" stroke="${GOLDL}" stroke-width="${1.4 * z}"/><circle cx="${a[0]}" cy="${a[1]}" r="${2.6 * z}" fill="${GOLDL}"/>
      <circle cx="${bx}" cy="${by}" r="${r}" fill="#020d1c" stroke="${GOLD}" stroke-width="${1.8 * z}"/>
      <text x="${bx}" y="${by + 5.2 * z}" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="${15 * z}" fill="#fff">${came}</text>`;
  }
  return `<svg class="pmap" viewBox="0 0 ${CANADA.w} ${CANADA.h}" width="${width}" height="${Math.round((width * CANADA.h) / CANADA.w)}">${paths}${badge}</svg>`;
}
const LOGO = LOGO_FILE ? `data:image/png;base64,${readFileSync(LOGO_FILE).toString("base64")}` : "";
const logo = (h) => LOGO ? `<img src="${LOGO}" alt="ONGIA" style="height:${h}px;width:${Math.round(h * 1000 / 255)}px;display:block">` : `<span class="h" style="font-weight:700;font-size:${h * 0.8}px;letter-spacing:.12em;color:#fff">ONGIA</span>`;

const NAVY = "#14264d", DEEP = "#0e1a35", GOLD = "#e0b34a", GOLDL = "#f0cd73", PALE = "#f6f1e4", INK = "#14181f", MUTED = "#5d6577";

const L = {
  en: { rated: "rated this training 4 or 5 out of 5", attendees: "Attendees", from: (a, p) => `from <b>${a} agenc${a === 1 ? "y" : "ies"}</b>${p ? ` across <b>${p} province${p === 1 ? "" : "s"}</b>` : ""}`,
    answered: "attended", averageRating: "average rating", tagline: "Building connections. Sharing intelligence. Strengthening communities.", experience: "Experience matters", yearsPlus: "16+ years", years: "years",
    quality: "Overall quality", averageOf: (n) => `average of <b>${n}</b> ratings`, provinces: "Province representation", agencies: "Agencies represented", more: (n) => `…and ${n} more.`,
    topics: "Topics trained", takeaways: "Key takeaways", said: "What participants said", foot: "Stronger together. Safer communities.", thanks: "Thank you to every participant and presenter.",
    rel: "Relevance to daily role", pace: "Pace of training", conf: "Confidence applying learnings", variety: "Variety & depth of topics", practical: "Practical strategies gained",
    top2: "rated 4 or 5", aboutRight: "“About right”", words: ["Poor", "Fair", "Good", "Very good", "Excellent"],
    trained: "Agencies trained", differentAgencies: "different agencies", trainedLine: (n) => `<b>${n}</b> registered attendees came from them`,
    sectors: { police: "Police & law enforcement", justice: "Corrections, courts & justice", education: "Education", community: "Community & social services", government: "Government", other: "Other" } },
  fr: { rated: "ont donné à cette formation une note de 4 ou 5 sur 5", attendees: "Participants", from: (a, p) => `de <b>${a} organisme${a === 1 ? "" : "s"}</b>${p ? ` dans <b>${p} province${p === 1 ? "" : "s"}</b>` : ""}`,
    answered: "ont participé", averageRating: "note moyenne", tagline: "Créer des liens. Partager le renseignement. Renforcer les collectivités.", experience: "L'expérience compte", yearsPlus: "16 ans et plus", years: "ans",
    quality: "Qualité globale", averageOf: (n) => `moyenne de <b>${n}</b> évaluations`, provinces: "Provinces représentées", agencies: "Organismes représentés", more: (n) => `…et ${n} autres.`,
    topics: "Sujets abordés", takeaways: "Points saillants", said: "Ce que les participants ont dit", foot: "Plus forts ensemble. Des collectivités plus sûres.", thanks: "Merci à tous les participants et présentateurs.",
    rel: "Pertinence pour le travail", pace: "Rythme de la formation", conf: "Confiance à appliquer les acquis", variety: "Variété et profondeur des sujets", practical: "Stratégies pratiques acquises",
    top2: "note de 4 ou 5", aboutRight: "« Juste bien »", words: ["Faible", "Passable", "Bien", "Très bien", "Excellent"],
    trained: "Organismes formés", differentAgencies: "organismes différents", trainedLine: (n) => `<b>${n}</b> participants inscrits en provenaient`,
    sectors: { police: "Police et application de la loi", justice: "Services correctionnels, tribunaux et justice", education: "Éducation", community: "Organismes communautaires et sociaux", government: "Gouvernement", other: "Autres" } },
};
const PROV_FR = { ON: "Ontario", QC: "Québec", MB: "Manitoba", SK: "Saskatchewan", AB: "Alberta", BC: "Colombie-Britannique", NS: "Nouvelle-Écosse", NB: "Nouveau-Brunswick", NL: "Terre-Neuve-et-Labrador", PE: "Île-du-Prince-Édouard", YT: "Yukon", NT: "Territoires du Nord-Ouest", NU: "Nunavut" };

// A line drawing for the city: its landmark over a simple skyline. Anywhere else, a plain skyline.
const LANDMARK = {
  toronto: '<path d="M210 8v40"/><path d="M200 48h20l-3 40h-14z"/><ellipse cx="210" cy="96" rx="22" ry="9"/><path d="M196 104l-6 150M224 104l6 150M210 104v150"/>',
  calgary: '<path d="M210 30v26"/><path d="M190 56h40l-6 22h-28z"/><path d="M200 78l-8 176M220 78l8 176"/><path d="M196 140h28M193 190h34"/>',
  winnipeg: '<path d="M210 40l0 214"/><path d="M210 40L40 230M210 40L80 230M210 40L120 230M210 40l170 190M210 40l130 190M210 40l90 190"/><path d="M20 230h380"/>',
  montreal: '<path d="M120 254c40-60 120-60 170 0"/><path d="M250 254l60-210 14 6-48 204"/><path d="M296 70l22 8"/>',
  ottawa: '<path d="M195 254V90h30v164"/><path d="M190 90l20-50 20 50"/><path d="M210 40V22"/><rect x="200" y="110" width="20" height="20"/><path d="M110 254v-60h200v60"/>',
  vancouver: '<path d="M10 200l60-70 50 50 70-90 80 80 60-40 80 70"/><path d="M60 254v-50M60 204l60 30M60 204l-40 30M340 254v-50M340 204l40 30M340 204l-60 30"/><path d="M20 236h380"/>',
  dome: '<path d="M150 254v-90h120v90"/><path d="M170 164c0-50 80-50 80 0"/><path d="M210 114V92"/><path d="M130 254v-60h20M270 194h20v60"/>',
};
const cityKey = (event) => {
  const c = String(event.city ?? "").toLowerCase();
  for (const k of ["toronto", "calgary", "winnipeg", "montreal", "ottawa", "vancouver"]) if (c.includes(k)) return k;
  if (/regina|edmonton|victoria|quebec|québec|halifax|fredericton/.test(c)) return "dome";
  return null;
};
function skyline(event, w = 420, h = 260) {
  const mark = LANDMARK[cityKey(event)] ?? "";
  return `<svg viewBox="0 0 420 260" width="${w}" height="${h}" fill="none" stroke="${GOLD}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">${mark}
    <path d="M10 254h400"/><path d="M30 254v-70h34v70M64 254v-100h40v100M110 254v-60h28v60M142 254v-120h36v120"/><path d="M244 254v-110h34v110M282 254v-80h40v80M326 254v-130h30v130M360 254v-60h40v60"/>
    <path d="M76 170h16M76 190h16M76 210h16M152 150h16M152 170h16M152 190h16M254 160h14M254 180h14M334 150h14M334 170h14M334 190h14" stroke-width="2"/></svg>`;
}

const ICONS = {
  money: '<circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="3"/><path d="M38 24c-2-3-11-3-12 2s12 4 12 9-10 6-13 2M32 18v28" fill="none" stroke="currentColor" stroke-width="3"/>',
  youth: '<circle cx="22" cy="20" r="7" fill="currentColor"/><circle cx="42" cy="20" r="7" fill="currentColor"/><path d="M10 46c0-9 6-14 12-14s12 5 12 14M30 46c0-9 6-14 12-14s12 5 12 14" fill="none" stroke="currentColor" stroke-width="3"/>',
  phone: '<rect x="20" y="8" width="24" height="46" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="32" cy="47" r="2.5" fill="currentColor"/><path d="M8 24c-3 6-3 12 0 18M56 24c3 6 3 12 0 18" fill="none" stroke="currentColor" stroke-width="3"/>',
  network: '<circle cx="32" cy="32" r="5" fill="currentColor"/><circle cx="12" cy="14" r="4" fill="currentColor"/><circle cx="52" cy="14" r="4" fill="currentColor"/><circle cx="12" cy="50" r="4" fill="currentColor"/><circle cx="52" cy="50" r="4" fill="currentColor"/><path d="M15 17l13 12M49 17L36 29M15 47l13-12M49 47L36 35" stroke="currentColor" stroke-width="3"/>',
  gun: '<path d="M8 22h40v8H30l-4 18h-9l3-18H8z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M48 22h6v5h-6" fill="none" stroke="currentColor" stroke-width="3"/>',
  border: '<path d="M32 6l20 8v14c0 14-9 24-20 30C21 52 12 42 12 28V14z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 18l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="currentColor"/>',
  bars: '<rect x="10" y="12" width="44" height="40" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><path d="M22 12v40M32 12v40M42 12v40" stroke="currentColor" stroke-width="3"/>',
  hands: '<path d="M6 36l12-10 10 4 8-4 12 10-14 12-8-6-8 6z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>',
  search: '<circle cx="27" cy="27" r="15" fill="none" stroke="currentColor" stroke-width="3"/><path d="M38 38l16 16" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  truck: '<rect x="6" y="18" width="32" height="22" fill="none" stroke="currentColor" stroke-width="3"/><path d="M38 26h12l6 8v6H38z" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="16" cy="44" r="4" fill="currentColor"/><circle cx="46" cy="44" r="4" fill="currentColor"/>',
  bike: '<circle cx="16" cy="40" r="10" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="48" cy="40" r="10" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16 40l12-16h12l8 16M28 24l-4-6h-6" fill="none" stroke="currentColor" stroke-width="3"/>',
};
function iconFor(title) {
  const t = String(title ?? "").toLowerCase();
  const pick = [["money", /money|financ|launder|fraud|asset/], ["youth", /youth|young|recruit|school|family|jeune/], ["phone", /digital|social media|online|phone|cyber|dark web|robocall|tech/],
    ["gun", /gun|firearm|weapon|3d|ghost|arme/], ["border", /border|cbsa|customs|frontière/], ["bars", /prison|correction|jail|custody|inside the walls|incarcer/],
    ["bike", /outlaw|motorcycle|biker|hells|omg/], ["truck", /drug|traffick|transport|smuggl|import|cartel|fentanyl/], ["network", /network|gang|alliance|organi[sz]ed|syndicate|expansion/],
    ["hands", /community|partner|prevent|victim|support/], ["search", /investigat|intelligence|case|operation|project/]].find(([, re]) => re.test(t));
  return ICONS[pick ? pick[0] : "border"];
}

function donut(parts, size = 220, w = 30, center = "", track = "#ece7da") {
  const tot = parts.reduce((a, p) => a + p.v, 0) || 1, r = size / 2 - w / 2 - 2, cx = size / 2;
  let a = -Math.PI / 2;
  const arcs = parts.filter((p) => p.v > 0).map((p) => {
    const da = (2 * Math.PI * p.v) / tot, a2 = a + da - (parts.filter((x) => x.v > 0).length > 1 ? 0.0001 : 0.0001);
    const x1 = cx + r * Math.cos(a), y1 = cx + r * Math.sin(a), x2 = cx + r * Math.cos(a2), y2 = cx + r * Math.sin(a2);
    const d = `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${da > Math.PI ? 1 : 0} 1 ${x2.toFixed(1)},${y2.toFixed(1)}`; a += da;
    return `<path d="${d}" stroke="${p.c}" stroke-width="${w}" fill="none"/>`;
  }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle cx="${cx}" cy="${cx}" r="${r}" stroke="${track}" stroke-width="${w}" fill="none"/>${arcs}${center}</svg>`;
}
const PALETTE = [NAVY, GOLD, "#3f5a8f", GOLDL, "#8a94aa", "#c9cfdc", "#e9dcb4", "#6b7a99"];

function stars(v) {
  if (v === null || v === undefined) return "";
  const full = Math.floor(v), half = v - full >= 0.25 && v - full < 0.75, more = v - full >= 0.75 ? 1 : 0;
  const on = full + more;
  return `<div style="font-size:44px;letter-spacing:4px;line-height:1">${Array.from({ length: 5 }, (_, i) => `<span style="color:${i < on ? GOLD : i === on && half ? "#d8c58f" : "#d9dde6"}">★</span>`).join("")}</div>`;
}

/* ---------- the page, laid out like Andrew's Calgary 2025 infographic (17 Nov 2026: "include all the elements that
   are in this one and add any that you think would be great to illustrate") ---------- */

// Words the new layout adds, English and French.
const W = {
  en: { tagline: "Bringing experts together. Sharing knowledge. Strengthening communities.", analysis: "Attendee analysis", moreThan: "More than", people: "people",
    attendedLine: (a) => `from across the country attended${a ? `, representing over ${a} agencies` : ""}.`, sessions: "Training sessions", heldOver: "were held over", days: (n) => `${n} day${n === 1 ? "" : "s"},`,
    oneDay: "in one day,", covering: "covering a wide range of topics.", provinces: "Province representation breakdown", agencies: "Service agencies attended", more: (n) => `…and ${n} more`,
    bySector: "By sector", experience: "Attendee experience", yearsOfService: "years of service", plus16: (p) => `of attendees have <b>16+ years</b> of experience`, summary: "Training summary", feedback: "Attendee feedback", ratings: "Survey ratings", average: "Average rating", glance: "At a glance",
    rated45: "rated the training 4 or 5", relevant: "found it relevant to their work", confident: "feel confident applying it", veterans: "have 16+ years' experience", recommend: "would recommend the sessions" },
  fr: { tagline: "Rassembler les experts. Partager le savoir. Renforcer les collectivités.", analysis: "Analyse des participants", moreThan: "Plus de", people: "personnes",
    attendedLine: (a) => `de partout au pays y ont participé${a ? `, de plus de ${a} organismes` : ""}.`, sessions: "Séances de formation", heldOver: "ont eu lieu sur", days: (n) => `${n} jour${n === 1 ? "" : "s"},`,
    oneDay: "en une journée,", covering: "sur un large éventail de sujets.", provinces: "Répartition par province", agencies: "Organismes représentés", more: (n) => `…et ${n} autres`,
    bySector: "Par secteur", experience: "Expérience des participants", yearsOfService: "années de service", plus16: (p) => `des participants ont <b>16 ans ou plus</b> d'expérience`, summary: "Résumé de la formation", feedback: "Commentaires des participants", ratings: "Évaluations", average: "Note moyenne", glance: "En un coup d'œil",
    rated45: "ont donné une note de 4 ou 5", relevant: "l'ont trouvée pertinente pour leur travail", confident: "se sentent prêts à l'appliquer", veterans: "ont 16 ans d'expérience ou plus", recommend: "recommanderaient les séances" },
};
const BG = "#020d1c", PANEL = "#06182f", RULE = "rgba(224,179,74,.32)", SOFT = "#9fb0d1", LINEC = "#5b6f99";

// Round down for "More than …": 545 is 500, 123 is 120, 93 agencies is 90.
const downTo = (n) => (n >= 200 ? Math.floor(n / 50) * 50 : n >= 20 ? Math.floor(n / 10) * 10 : n >= 10 ? Math.floor(n / 5) * 5 : n);

const BIG_ICONS = {
  people: `<svg viewBox="0 0 120 90" width="120" height="90" fill="none" stroke="${GOLD}" stroke-width="5"><circle cx="60" cy="22" r="13"/><path d="M36 82c0-18 10-30 24-30s24 12 24 30z"/><circle cx="24" cy="32" r="10"/><path d="M6 82c0-14 8-24 18-24 5 0 9 2 12 5"/><circle cx="96" cy="32" r="10"/><path d="M114 82c0-14-8-24-18-24-5 0-9 2-12 5"/></svg>`,
  calendar: `<svg viewBox="0 0 90 90" width="96" height="96" fill="none" stroke="${GOLD}" stroke-width="5"><rect x="8" y="16" width="74" height="64" rx="8"/><path d="M8 34h74M28 8v16M62 8v16"/><path d="M22 48h8M40 48h8M58 48h8M22 62h8M40 62h8"/><circle cx="66" cy="66" r="13" fill="${BG}"/><path d="M60 66l5 5 8-9"/></svg>`,
  shield: `<svg viewBox="0 0 64 64" width="44" height="44" fill="none" stroke="${GOLD}" stroke-width="3.5"><path d="M32 4l24 9v17c0 16-11 26-24 31C19 56 8 46 8 30V13z"/><path d="M32 18l4 8 9 1-6 6 1 9-8-4-8 4 1-9-6-6 9-1z"/></svg>`,
  cap: `<svg viewBox="0 0 64 64" width="48" height="48" fill="none" stroke="${GOLD}" stroke-width="3.5"><path d="M4 24l28-12 28 12-28 12z"/><path d="M16 30v14c8 6 24 6 32 0V30M56 26v16"/></svg>`,
  chat: `<svg viewBox="0 0 64 64" width="48" height="48" fill="none" stroke="${GOLD}" stroke-width="3.5"><path d="M8 12h40a6 6 0 016 6v20a6 6 0 01-6 6H26l-12 10V44H8a6 6 0 01-6-6V18a6 6 0 016-6z"/><circle cx="20" cy="28" r="2.5" fill="${GOLD}"/><circle cx="30" cy="28" r="2.5" fill="${GOLD}"/><circle cx="40" cy="28" r="2.5" fill="${GOLD}"/></svg>`,
  star: `<svg viewBox="0 0 64 64" width="40" height="40"><path d="M32 4l8 18 20 2-15 13 5 20-18-11-18 11 5-20L4 24l20-2z" fill="${GOLD}"/></svg>`,
  hands: `<svg viewBox="0 0 160 120" width="170" height="128" fill="none" stroke="${LINEC}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"><path d="M4 40l26-22 18 10M156 40l-26-22-18 10"/><path d="M30 18l-14 46 12 10M130 18l14 46-12 10"/><path d="M48 28l22 0 22 14 18-8 20 30-28 26c-4 4-10 4-13 0l-4-4-6 6c-4 4-10 3-12-1l-4-6-6 4c-4 2-9 0-10-4l-4-8-6 2c-4 1-8-2-8-6L28 74"/><path d="M70 28L46 50c-4 4 2 12 8 8l18-14 30 28"/></svg>`,
  glance: `<svg viewBox="0 0 64 64" width="46" height="46" fill="none" stroke="${GOLD}" stroke-width="3.5"><path d="M8 54V30M24 54V18M40 54V34M56 54V10"/><path d="M4 58h56"/></svg>`,
};
const leaf = `<path d="M110 52l6 14 12-7-4 22 12-4-2 10 14 2-18 16 4 8-24-4v22h-4V109l-24 4 4-8-18-16 14-2-2-10 12 4-4-22 12 7z" fill="${GOLD}"/>`;
const goldStars = (v, size = 26) => {
  const full = Math.floor(v), half = v - full >= 0.25 && v - full < 0.75, on = full + (v - full >= 0.75 ? 1 : 0);
  return Array.from({ length: 5 }, (_, i) => `<span style="font-size:${size}px;color:${i < on ? GOLD : i === on && half ? "#8f7a3d" : "#3a4a6e"}">★</span>`).join("");
};
const sessionIcon = (title) => `<svg viewBox="0 0 64 64" width="70" height="70" style="color:${LINEC}">${iconFor(title)}</svg>`;

/** The sections, each a piece of HTML, so the page can draw all of them or one at a time. */
function sections(event, R, analysis, lang, square = false) {
  const t = L[lang], w = W[lang];
  const name = String(event.title ?? "").split(/\s*:\s*/)[0].replace(/^Canadian Forum Against Organized Crime\s*-\s*/i, "");
  const city = String(event.city ?? "").split(",")[0].trim(), year = (event.dayOne ?? "").slice(0, 4);
  const when = whenOf(event.dayOne, event.lastDay, lang);
  const provName = (p) => (lang === "fr" ? PROV_FR[p.code] : p.name) ?? p.name;
  const PAL = [GOLD, "#1f3a75", "#3f5a8f", GOLDL, "#6b7fa8", "#9fb0d1", "#c9a76a", "#2c4a86"];
  const host = provinceOfEvent(event);
  const shares = Object.fromEntries(R.provinces.filter((p) => p.code).map((p) => [p.code, p.pct]));
  const shareMax = Math.max(1, ...Object.values(shares));
  const blue = (v) => { const a = [0x1d, 0x3f, 0x72], b = [0x72, 0x9c, 0xdc], t = Math.sqrt(v / shareMax); return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(",")})`; };
  void PAL;
  const prov = R.provinces.slice(0, 8).map((p) => ({ l: provName(p), v: p.pct, c: p.code === host ? GOLD : blue(p.pct) }));
  const came = R.attended?.count || R.trained?.people || R.respondents;
  const agN = R.trained?.count || R.agencies.length;
  const T = R.trained;
  const agList = T ? T.agencies.map((a) => a.name) : R.agencies.filter((a) => a.known || a.count > 1).map((a) => a.agency);
  const shownAg = agList.slice(0, square ? 14 : 18);
  const topics = (event.survey?.sessions ?? []).filter((s) => s.title).slice(0, 8);
  const days = event.dayOne ? Math.round((Date.parse(event.lastDay || event.dayOne) - Date.parse(event.dayOne)) / 86400000) + 1 : 0;
  const quotes = (analysis?.quotes ?? []).slice(0, square ? 3 : 5);
  const starOf = (q) => R.commentStars?.[String(q.text ?? "").toLowerCase().replace(/[“”"’‘']/g, "").replace(/\s+/g, " ").trim()]
    ?? Object.entries(R.commentStars ?? {}).find(([k]) => k.includes(String(q.text ?? "").toLowerCase().replace(/[“”"’‘']/g, "").replace(/\s+/g, " ").trim().slice(0, 40)))?.[1];
  const h = R.headline, dist = h.dist ?? [0, 0, 0, 0, 0], dn = dist.reduce((a, b) => a + b, 0) || 1;
  const rec = R.sessions.filter((s) => s.n).reduce((a, s) => ({ y: a.y + s.rebook.yes, n: a.n + s.rebook.yes + s.rebook.maybe + s.rebook.no }), { y: 0, n: 0 });
  const plus16 = R.years.slice(3).reduce((a, y) => a + y.pct, 0);
  const glance = [[h.n ? h.top2 : null, w.rated45], [R.sessions.length ? avgTop2(R.sessions.map((s) => s.byQ.relevant)) : null, w.relevant],
    [R.overall.confidence?.n ? R.overall.confidence.top2 : null, w.confident], [rec.n ? Math.round((100 * rec.y) / rec.n) : null, w.recommend],
    [R.years.some((y) => y.count) ? plus16 : null, w.veterans]].filter((x) => x[0] !== null && x[0] !== undefined).slice(0, 4);
  const head = (icon, text) => `<h2>${icon}<span>${esc(text)}</span></h2>`;
  const sec = (key, inner, extra = "") => `<section data-block="${key}" class="sec ${extra}">${inner}</section>`;
  return {
    event: `<div class="hero"><div class="sky">${skyline(event, 520, 320)}</div>
        <div class="kick">${esc([city, year].filter(Boolean).join(" "))}</div>
        <div class="title" style="font-size:${name.length > 28 ? 74 : name.length > 20 ? 92 : 112}px">${esc(name)}</div>
        <div class="rule"></div><div class="tag">${esc(w.tagline)}</div>${when ? `<div class="when">${esc(when)}</div>` : ""}</div>`,
    stats: sec("stats", `<div class="three">
        <div><div class="ph">${esc(w.analysis)}</div><div style="display:flex;gap:22px;align-items:center;margin-top:18px">${BIG_ICONS.people}
          <div><div class="sm">${esc(w.moreThan)}</div><div class="num">${downTo(came)}+</div><div class="ph" style="font-size:30px;margin:0">${esc(w.people)}</div>
          <div class="body">${esc(w.attendedLine(agN ? downTo(agN) : 0))}</div></div></div></div>
        <div><div style="display:flex;gap:16px;align-items:center"><div class="num">${topics.length || R.sessions.length}</div><div class="h" style="font-size:38px;line-height:1;color:#fff">${esc(w.sessions)}</div></div>
          <div class="sm" style="margin-top:20px">${esc(w.heldOver)}</div><div style="display:flex;gap:18px;align-items:center"><div class="num" style="font-size:58px;white-space:nowrap">${days > 1 ? esc(w.days(days)).toUpperCase() : esc(w.oneDay).toUpperCase()}</div>${BIG_ICONS.calendar}</div>
          <div class="sm" style="text-transform:uppercase">${esc(w.covering)}</div></div>
        <div><div class="ph">${esc(w.provinces)}</div><div class="pwrap"><div style="margin-top:10px">${provinceMap(host, shares, came, 330)}</div>
          <div class="legend two" style="margin-top:6px">${prov.map((x) => `<div><i style="background:${x.c}"></i>${esc(x.l)}<b>${x.v}%</b></div>`).join("")}</div></div></div></div>`, "top"),
    experience: R.years.some((y) => y.count) ? sec("experience", `${head(BIG_ICONS.people.replace('width="120" height="90"', 'width="56" height="42"'), w.experience)}<div class="exp">
        <div><div class="bars">${R.years.map((y) => { const top = Math.max(...R.years.map((x) => x.pct)) || 1; return `<div><b>${y.pct}%</b><i style="height:${Math.max(3, Math.round((210 * y.pct) / top))}px"></i><span>${esc(y.label)}</span></div>`; }).join("")}</div>
          <div class="axis">${esc(w.yearsOfService)}</div></div>
        <div class="callout"><div class="num">${plus16}%</div><div class="body" style="font-size:20px">${w.plus16(plus16)}</div></div></div>`) : "",
    provinces: prov.length ? sec("provinces", `${head(BIG_ICONS.glance, w.provinces)}<div style="display:grid;grid-template-columns:1fr 300px;gap:30px;align-items:center">
        ${provinceMap(host, shares, came, 640, 2)}
        <div class="legend big">${prov.map((x) => `<div><i style="background:${x.c}"></i>${esc(x.l)}<b>${x.v}%</b></div>`).join("")}</div></div>`) : "",
    agencies: agList.length ? sec("agencies", `${head(BIG_ICONS.shield, w.agencies)}<div style="display:grid;grid-template-columns:1fr 200px;gap:20px;align-items:center">
        <div><ul class="ag">${shownAg.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>${agList.length > shownAg.length ? `<div class="more">${esc(w.more(agList.length - shownAg.length))}</div>` : ""}
        ${T?.sectors?.length ? `<div class="sectors"><b>${esc(w.bySector)}:</b> ${T.sectors.map((x) => `${esc(t.sectors[x.key])} <span>${x.count}</span>`).join(" · ")}</div>` : ""}</div>
        <div style="text-align:center;border-left:1.5px solid ${RULE};height:100%;display:flex;align-items:center;justify-content:center">${BIG_ICONS.hands}</div></div>`) : "",
    topics: topics.length ? sec("topics", `${head(BIG_ICONS.cap, w.summary)}<div class="tgrid">${topics.map((s, i) => `<div><div style="display:flex;gap:12px;align-items:flex-start"><span class="n">${i + 1}</span>
        <span class="tt">${esc((lang === "fr" && s.titleFr) || s.title)}</span></div>${(lang === "fr" ? s.aboutFr || s.about : s.about) ? `<p class="ab">${esc(lang === "fr" ? s.aboutFr || s.about : s.about)}</p>` : ""}<div style="text-align:center;margin-top:14px">${sessionIcon(s.title)}</div></div>`).join("")}</div>`) : "",
    takeaways: glance.length ? sec("takeaways", `${head(BIG_ICONS.glance, w.glance)}<div class="glance" style="grid-template-columns:repeat(${glance.length},1fr)">${glance.map(([v, l]) => `<div><b>${v}%</b><span>${esc(l)}</span></div>`).join("")}</div>`) : "",
    quotes: (h.n || quotes.length) ? sec("quotes", `${head(BIG_ICONS.chat, w.feedback)}<div class="fb">
        ${h.n ? `<div class="box"><div class="bh">${BIG_ICONS.star}<span>${esc(w.ratings)}</span></div>
          ${[5, 4, 3, 2, 1].map((k) => `<div class="srow"><span class="k">${k}/5</span><span class="st">${goldStars(k, 26)}</span><b>${Math.round((100 * dist[k - 1]) / dn)}%</b></div>`).join("")}
          <div class="avg"><span>${esc(w.average)}</span><b>${h.avg ?? "–"}/5</b></div></div>` : "<div></div>"}
        <div class="quotes">${quotes.map((q) => { const s = starOf(q); return `<div class="qq"><span class="qm">“</span><span class="qt">${esc(q.text)}</span>${s ? `<b>${s}/5</b>` : "<b></b>"}</div>`; }).join("")}</div></div>`) : "",
    foot: `<div class="foot"><div class="h" style="font-size:34px;font-weight:600;color:${GOLD};letter-spacing:.04em">ONGIA.CA</div>${logo(64)}</div>`,
  };
}
const avgTop2 = (list) => { const n = list.reduce((a, s) => a + s.n, 0); return n ? Math.round(list.reduce((a, s) => a + (s.top2 * s.n), 0) / n) : null; };

const CSS = `*{box-sizing:border-box} body{margin:0;background:${BG}} body,#art{font-family:"DM Sans",Arial,sans-serif;color:#fff}
.page{width:1080px;margin:0 auto;background:radial-gradient(ellipse 70% 14% at 50% 12%,rgba(28,72,128,.38),transparent),radial-gradient(ellipse 80% 10% at 30% 52%,rgba(22,58,104,.30),transparent),radial-gradient(ellipse 80% 10% at 60% 82%,rgba(22,58,104,.26),transparent),linear-gradient(180deg,#010915 0%,#03132a 35%,#020c1b 70%,#03152b 100%);color:#fff}
.h{font-family:Oswald,"Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:.02em}
.hero{position:relative;padding:56px 52px 40px;overflow:hidden;min-height:330px}
.hero .sky{position:absolute;right:-10px;top:10px;opacity:.55} .hero .sky svg{stroke:${LINEC}}
.hero .kick{position:relative;font-family:Oswald,sans-serif;font-weight:600;font-size:44px;color:${GOLD};text-transform:uppercase;letter-spacing:.03em}
.hero .title{position:relative;font-family:Oswald,sans-serif;font-weight:700;line-height:.95;text-transform:uppercase;color:#fff;max-width:900px;margin-top:4px}
.hero .rule{position:relative;height:4px;width:640px;background:${GOLD};margin:20px 0 16px}
.hero .tag{position:relative;font-size:19px;letter-spacing:.06em;text-transform:uppercase;font-weight:500}
.hero .when{position:relative;font-size:18px;color:${SOFT};margin-top:6px}
.sec{margin:0 18px;border-top:1.5px solid ${RULE};padding:34px 34px}
.sec.top{border:1.5px solid ${RULE};padding:0;background:rgba(6,26,52,.55)}
.sec h2{font-family:Oswald,sans-serif;font-weight:500;font-size:32px;color:${GOLD};margin:0 0 22px;text-transform:uppercase;letter-spacing:.03em;display:flex;align-items:center;gap:14px}
.three{display:grid;grid-template-columns:1fr 1fr 1.3fr} .three>div{min-width:0} .three>div{padding:28px 26px;border-left:1.5px solid ${RULE}} .three>div:first-child{border-left:0}
.ph{font-family:Oswald,sans-serif;font-size:24px;color:${GOLD};text-transform:uppercase;letter-spacing:.03em}
.num{font-family:Oswald,sans-serif;font-weight:700;font-size:88px;line-height:.95;color:${GOLD}}
.three>div:first-child .num{color:#fff}
.sm{font-family:Oswald,sans-serif;font-size:22px;letter-spacing:.03em;text-transform:uppercase;color:#fff}
.body{font-size:17px;line-height:1.35;margin-top:10px;color:#dfe5f2}
.legend div{display:flex;align-items:center;gap:10px;font-size:17px;margin:5px 0} .legend i{width:14px;height:14px;display:inline-block;flex:none}
.square .pwrap{display:grid;grid-template-columns:470px 1fr;gap:34px;align-items:center} .square .pwrap .pmap{width:470px} .square .pwrap .legend.two{grid-template-columns:1fr} .square .pwrap .legend.two div{font-size:19px;margin:6px 0} .square .pwrap .legend.two b{font-size:21px}
.legend.two{display:grid;grid-template-columns:1fr 1fr;column-gap:16px} .legend.two div{font-size:13px;margin:3px 0;white-space:nowrap} .legend.two b{font-size:15px;padding-left:6px} .pmap{display:block;max-width:100%;height:auto}
.legend.big div{font-size:26px;margin:10px 0} .legend.big i{width:20px;height:20px} .legend.big b{font-size:30px} .legend b{margin-left:auto;font-family:Oswald,sans-serif;font-size:20px;color:#fff}
.ag{columns:2;column-gap:34px;font-size:19px;line-height:1.7;margin:0;padding:0;list-style:none}
.ag li{break-inside:avoid} .ag li:before{content:"•";color:${GOLD};font-size:22px;margin-right:12px}
.more{color:${SOFT};font-size:17px;margin-top:8px} .sectors{margin-top:16px;font-size:16px;color:#dfe5f2} .sectors b{color:${GOLD};font-weight:600} .sectors span{font-family:Oswald,sans-serif;color:${GOLD};font-size:18px}
.exp{display:grid;grid-template-columns:1fr 300px;gap:40px;align-items:end} .bars{display:flex;gap:26px;align-items:flex-end;height:270px;border-bottom:2px solid ${RULE};padding:0 10px}
.bars>div{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%} .bars i{display:block;width:100%;background:${GOLD}} .bars b{font-family:Oswald,sans-serif;font-size:28px;margin-bottom:8px}
.bars span{position:relative;top:0;order:3;font-family:Oswald,sans-serif;font-size:22px;color:#dfe5f2;margin-top:10px;height:0;overflow:visible;white-space:nowrap} .axis{text-align:center;color:${SOFT};font-size:16px;margin-top:44px}
.callout{border-left:1.5px solid ${RULE};padding:0 0 40px 34px} .callout b{color:${GOLD}}
.tgrid{display:grid;grid-template-columns:repeat(4,1fr);border-top:1.5px solid ${RULE}} .tgrid>div{padding:20px 16px;border-right:1.5px solid ${RULE};border-bottom:1.5px solid ${RULE}} .tgrid>div:nth-child(4n){border-right:0}
.tgrid .n{flex:none;background:${GOLD};color:${BG};font-family:Oswald,sans-serif;font-weight:700;font-size:24px;width:34px;height:38px;display:flex;align-items:center;justify-content:center}
.tgrid .tt{font-size:18px;line-height:1.3} .tgrid .ab{font-size:14.5px;line-height:1.35;color:${SOFT};margin:8px 0 0}
.glance{display:grid;gap:0} .glance>div{text-align:center;padding:8px 14px;border-left:1.5px solid ${RULE}} .glance>div:first-child{border-left:0}
.glance b{display:block;font-family:Oswald,sans-serif;font-size:72px;color:${GOLD};line-height:1} .glance span{display:block;font-size:17px;color:#dfe5f2;margin-top:8px}
.fb{display:grid;grid-template-columns:350px 1fr;gap:34px}
.box{border:1.5px solid ${RULE};background:rgba(4,20,42,.85);align-self:start} .bh{display:flex;align-items:center;gap:12px;padding:20px 22px 10px;font-family:Oswald,sans-serif;font-size:24px;text-transform:uppercase;letter-spacing:.03em}
.srow{display:flex;align-items:center;gap:12px;padding:6px 22px} .srow .k{font-family:Oswald,sans-serif;font-size:24px;width:44px} .srow .st{flex:1;letter-spacing:1px;border-left:1.5px solid ${RULE};padding-left:12px}
.srow b{font-family:Oswald,sans-serif;font-size:30px}
.avg{background:linear-gradient(90deg,#c0922f,${GOLD} 55%,${GOLDL});color:${BG};display:flex;justify-content:space-between;align-items:center;padding:16px 22px;margin-top:14px} .avg span{font-family:Oswald,sans-serif;font-size:22px;text-transform:uppercase;letter-spacing:.03em} .avg b{font-family:Oswald,sans-serif;font-size:50px}
.quotes .qq{display:grid;grid-template-columns:34px 1fr 90px;gap:10px;align-items:center;padding:14px 0;border-bottom:1.5px solid ${RULE}} .quotes .qq:last-child{border:0}
.qm{font-family:Oswald,sans-serif;color:${GOLD};font-size:54px;line-height:.6;align-self:start} .qt{font-size:18px;line-height:1.45;color:#eef1f8}
.qq b{font-family:Oswald,sans-serif;color:${GOLD};font-size:36px;text-align:right}
.foot{display:flex;justify-content:space-between;align-items:center;padding:30px 52px;border-top:1.5px solid ${RULE};margin-top:10px}
.square{width:1080px;height:1080px;display:flex;flex-direction:column;overflow:hidden;background:radial-gradient(ellipse 80% 40% at 50% 40%,rgba(28,72,128,.32),transparent),${BG};color:#fff;border-top:16px solid ${GOLD}}
.square .fit{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;justify-content:center;margin:0 auto;width:1080px}
.square .badge{flex:none} .square .in{width:1080px;margin:0 auto}
.square .sec{border:0;margin:0;padding:30px 50px} .square .sec.top{background:none}
.square .in>section{zoom:1.3} .square .in>section[data-block="quotes"]{zoom:1.05} .square .fb{grid-template-columns:330px 1fr} .square .in>section[data-block="stats"]{zoom:1.02} .square .in>section[data-block="agencies"]{zoom:1.15} .square .in>.hero{zoom:1.2}
.square .three{grid-template-columns:1fr 1fr} .square .three>div:nth-child(3){grid-column:1/3;border-left:0;border-top:1.5px solid ${RULE}}`;

/** "November 9–12, 2026" / "9 au 12 novembre 2026"; across two months, both are named. */
export function whenOf(first, last, lang = "en") {
  if (!first) return "";
  const at = (iso) => new Date(`${iso}T12:00:00Z`);
  const month = (iso) => at(iso).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { month: "long", timeZone: "UTC" });
  const day = (iso) => (lang === "fr" && at(iso).getUTCDate() === 1 ? "1er" : at(iso).getUTCDate()), year = first.slice(0, 4);
  if (!last || last === first) return lang === "fr" ? `${day(first)} ${month(first)} ${year}` : `${month(first)} ${day(first)}, ${year}`;
  const same = first.slice(0, 7) === last.slice(0, 7);
  if (lang === "fr") return same ? `${day(first)} au ${day(last)} ${month(last)} ${year}` : `${day(first)} ${month(first)} au ${day(last)} ${month(last)} ${year}`;
  return same ? `${month(first)} ${day(first)}–${day(last)}, ${year}` : `${month(first)} ${day(first)} – ${month(last)} ${day(last)}, ${year}`;
}

/** The whole page, or one section as a 1080 × 1080 square. */
export function infographicHtml(event, R, analysis, { lang = "en", block = "" } = {}) {
  const s = sections(event, R, analysis, lang === "fr" ? "fr" : "en", !!block);
  const head = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/fonts/fonts.css"><style>${CSS}</style></head><body>`;
  if (block) {
    const one = block === "event" ? s.event + s.foot : s[block];
    if (!one) return null;
    const small = `<div class="badge" style="background:#010915;color:#fff;display:flex;justify-content:space-between;align-items:center;padding:20px 56px;border-top:3px solid ${GOLD}">${logo(52)}<span class="h" style="font-size:22px;letter-spacing:.06em;text-align:right">${esc(String(event.title).split(/\s*:\s*/)[0])}${event.dayOne ? ` · ${event.dayOne.slice(0, 4)}` : ""}<br><b style="font-size:26px;color:${GOLD}">ONGIA.CA</b></span></div>`;
    return `${head}<div class="square" id="art"><div class="fit"><div class="in">${one}</div></div>${block === "event" ? "" : small}</div></body></html>`;
  }
  return `${head}<div class="page" id="art">${s.event}${s.stats}${s.experience}${s.agencies}${s.topics}${s.quotes}${s.takeaways}${s.foot}</div></body></html>`;
}

/** The sections that can be made into social media squares, in order, with their names. */
export const BLOCKS = [["event", "The event"], ["stats", "Attendees, sessions and provinces"], ["experience", "Years of experience"], ["provinces", "Provinces"], ["agencies", "Agencies"], ["topics", "Topics"], ["takeaways", "At a glance"], ["quotes", "Ratings and comments"]];
