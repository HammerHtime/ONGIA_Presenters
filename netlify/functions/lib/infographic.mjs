/**
 * The one-page infographic from an event's survey (Andrew 27 Oct 2026, from his Crime at the Crossroads and Calgary
 * 2025 examples): ONGIA navy and gold on a clean background, a line drawing that stands for the city, the attendees and
 * their agencies, provinces, experience, the overall rating, the topics, the key takeaways and 4 or 5 comments. In
 * English or French. `block` draws one section on its own as a square image for social media.
 *
 * The page is plain HTML and inline SVG, so the event page can show it, let Andrew fix any wording on it, and turn it
 * into a PNG and a PDF.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The ONGIA logo with its tagline (white leaf, gold letters, for a dark background), inside the page so the picture made from it has it too.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGO_FILE = [path.resolve(HERE, "../../../public/assets"), path.resolve(HERE, "../../public/assets"), path.resolve(process.cwd(), "public/assets"), "/var/task/public/assets"]
  .map((d) => path.join(d, "ongia-logo-tagline-dark.png")).find((f) => existsSync(f));
const LOGO = LOGO_FILE ? `data:image/png;base64,${readFileSync(LOGO_FILE).toString("base64")}` : "";
const logo = (h) => LOGO ? `<img src="${LOGO}" alt="ONGIA" style="height:${h}px;width:${Math.round(h * 1000 / 255)}px;display:block">` : `<span class="h" style="font-weight:700;font-size:${h * 0.8}px;letter-spacing:.12em;color:#fff">ONGIA</span>`;

const NAVY = "#14264d", DEEP = "#0e1a35", GOLD = "#c9a032", GOLDL = "#e2bf5c", PALE = "#f6f1e4", INK = "#14181f", MUTED = "#5d6577";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const L = {
  en: { rated: "rated this training 4 or 5 out of 5", attendees: "Attendees", from: (a, p) => `from <b>${a} agenc${a === 1 ? "y" : "ies"}</b>${p ? ` across <b>${p} province${p === 1 ? "" : "s"}</b>` : ""}`,
    answered: "answered the survey", tagline: "Building connections. Sharing intelligence. Strengthening communities.", experience: "Experience matters", yearsPlus: "16+ years", years: "years",
    quality: "Overall quality", averageOf: (n) => `average of <b>${n}</b> ratings`, provinces: "Province representation", agencies: "Agencies represented", more: (n) => `…and ${n} more.`,
    topics: "Topics trained", takeaways: "Key takeaways", said: "What participants said", foot: "Stronger together. Safer communities.", thanks: "Thank you to every participant and presenter.",
    rel: "Relevance to daily role", pace: "Pace of training", conf: "Confidence applying learnings", variety: "Variety & depth of topics", practical: "Practical strategies gained",
    top2: "rated 4 or 5", aboutRight: "“About right”", words: ["Poor", "Fair", "Good", "Very good", "Excellent"],
    trained: "Agencies trained", differentAgencies: "different agencies", trainedLine: (n) => `<b>${n}</b> registered attendees came from them`,
    sectors: { police: "Police & law enforcement", justice: "Corrections, courts & justice", education: "Education", community: "Community & social services", government: "Government", other: "Other" } },
  fr: { rated: "ont donné à cette formation une note de 4 ou 5 sur 5", attendees: "Participants", from: (a, p) => `de <b>${a} organisme${a === 1 ? "" : "s"}</b>${p ? ` dans <b>${p} province${p === 1 ? "" : "s"}</b>` : ""}`,
    answered: "ont répondu au sondage", tagline: "Créer des liens. Partager le renseignement. Renforcer les collectivités.", experience: "L'expérience compte", yearsPlus: "16 ans et plus", years: "ans",
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

function donut(parts, size = 220, w = 30, center = "") {
  const tot = parts.reduce((a, p) => a + p.v, 0) || 1, r = size / 2 - w / 2 - 2, cx = size / 2;
  let a = -Math.PI / 2;
  const arcs = parts.filter((p) => p.v > 0).map((p) => {
    const da = (2 * Math.PI * p.v) / tot, a2 = a + da - (parts.filter((x) => x.v > 0).length > 1 ? 0.0001 : 0.0001);
    const x1 = cx + r * Math.cos(a), y1 = cx + r * Math.sin(a), x2 = cx + r * Math.cos(a2), y2 = cx + r * Math.sin(a2);
    const d = `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${da > Math.PI ? 1 : 0} 1 ${x2.toFixed(1)},${y2.toFixed(1)}`; a += da;
    return `<path d="${d}" stroke="${p.c}" stroke-width="${w}" fill="none"/>`;
  }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle cx="${cx}" cy="${cx}" r="${r}" stroke="#ece7da" stroke-width="${w}" fill="none"/>${arcs}${center}</svg>`;
}
const PALETTE = [NAVY, GOLD, "#3f5a8f", GOLDL, "#8a94aa", "#c9cfdc", "#e9dcb4", "#6b7a99"];

function stars(v) {
  if (v === null || v === undefined) return "";
  const full = Math.floor(v), half = v - full >= 0.25 && v - full < 0.75, more = v - full >= 0.75 ? 1 : 0;
  const on = full + more;
  return `<div style="font-size:44px;letter-spacing:4px;line-height:1">${Array.from({ length: 5 }, (_, i) => `<span style="color:${i < on ? GOLD : i === on && half ? "#d8c58f" : "#d9dde6"}">★</span>`).join("")}</div>`;
}

/** The sections, each a piece of HTML, so the page can draw all of them or one at a time. */
function sections(event, R, analysis, lang, square = false) {
  const t = L[lang];
  const title = String(event.title ?? "").split(/\s*:\s*/)[0];
  const subtitle = String(event.title ?? "").includes(":") ? String(event.title).split(/\s*:\s*/).slice(1).join(": ") : "";
  const year = (event.dayOne ?? "").slice(0, 4);
  const when = whenOf(event.dayOne, event.lastDay, lang);
  const provName = (p) => (lang === "fr" ? PROV_FR[p.code] : p.name) ?? p.name;
  const exp = R.years.map((y, i) => ({ l: `${y.label} ${t.years}`, v: y.pct, c: [ "#c9cfdc", GOLDL, "#3f5a8f", GOLD, NAVY][i] })).reverse();
  const plus16 = R.years.slice(3).reduce((a, y) => a + y.pct, 0);
  const prov = R.provinces.map((p, i) => ({ l: provName(p), v: p.pct, c: PALETTE[i % PALETTE.length] }));
  const shown = R.agencies.filter((a) => a.known || a.count > 1).slice(0, 16);
  const T = R.trained, listed = T ? T.agencies.slice(0, square ? 8 : 16) : [];
  const take = [[t.rel, R.sessions.length ? avgTop2(R.sessions.map((s) => s.byQ.relevant)) : null, t.top2], [t.pace, R.overall.pace.n ? R.overall.pace.aboutRightPct : null, t.aboutRight],
    [t.conf, R.overall.confidence?.n ? R.overall.confidence.top2 : null, t.top2], [t.variety, R.overall.variety?.n ? R.overall.variety.top2 : null, t.top2], [t.practical, R.overall.practical?.n ? R.overall.practical.top2 : null, t.top2]].filter((x) => x[1] !== null);
  const topics = (event.survey?.sessions ?? []).filter((s) => s.title).slice(0, 8);
  const quotes = (analysis?.quotes ?? []).slice(0, 5);
  const h = R.headline;
  const sec = (name, inner, style = "") => `<section data-block="${name}" class="sec" style="${style}">${inner}</section>`;
  return {
    event: `<div style="background:${DEEP};padding:22px 56px;border-bottom:5px solid ${GOLD}">${logo(60)}</div>
      <div style="display:grid;grid-template-columns:1fr 420px;gap:10px;padding:40px 56px 30px;align-items:end">
        <div><div class="h" style="font-weight:700;font-size:${title.length > 22 ? 76 : 96}px;line-height:.92;color:${NAVY}">${esc(title)}</div>
          <div class="h" style="font-weight:700;font-size:96px;line-height:.92;color:${GOLD}">${esc(year)}</div>
          ${subtitle ? `<div style="font-size:24px;margin-top:18px;color:${NAVY};font-weight:500">${esc(subtitle)}</div>` : ""}
          <div class="h" style="font-size:24px;margin-top:10px;color:${MUTED}">${esc(String(event.city ?? "").split(",")[0])}${when ? ` · ${esc(when)}` : ""}</div></div>
        <div>${skyline(event)}</div></div>
      ${h.n ? `<div style="background:${GOLD};color:${DEEP};display:flex;align-items:center;gap:18px;padding:18px 56px"><span style="font-size:40px">★</span><span class="h" style="font-weight:700;font-size:54px">${h.top2}%</span><span class="h" style="font-size:26px;font-weight:600">${t.rated}</span></div>` : ""}`,
    stats: sec("stats", `<div class="grid3">
        <div><div class="label">${t.attendees}</div><div class="big">${R.respondents}</div><div style="font-size:20px;margin-top:8px">${t.answered}<br>${t.from(R.agencies.length, R.provinces.length)}</div><div class="muted" style="font-size:17px;margin-top:14px;font-style:italic">${t.tagline}</div></div>
        <div style="text-align:center"><div class="label">${t.experience}</div>${donut(exp, 220, 30, `<text x="110" y="104" text-anchor="middle" font-family="Oswald" font-size="44" font-weight="700" fill="${NAVY}">${plus16}%</text><text x="110" y="132" text-anchor="middle" font-family="DM Sans" font-size="15" fill="${MUTED}">${t.yearsPlus}</text>`)}
          <div class="legend" style="text-align:left">${exp.map((x) => `<div style="font-size:17px;margin:3px 0"><i style="background:${x.c}"></i>${esc(x.l)}<b style="font-size:20px">${x.v}%</b></div>`).join("")}</div></div>
        <div style="text-align:center"><div class="label">${t.quality}</div><div class="big" style="margin-top:14px">${h.avg ?? "–"}<span style="font-size:44px;color:${NAVY}">/5</span></div><div style="margin:14px 0">${stars(h.avg)}</div>
          <div style="font-size:19px">${t.averageOf(h.n)}</div><div class="h" style="font-size:34px;font-weight:700;color:${NAVY};margin-top:14px">${h.avg ? t.words[Math.min(4, Math.max(0, Math.round(h.avg) - 1))] : ""}</div></div></div>`, "border-top:0"),
    provinces: prov.length ? sec("provinces", `<h2>${t.provinces}</h2><div style="display:grid;grid-template-columns:1fr 330px;gap:40px;align-items:center">
        <div class="legend">${prov.map((x) => `<div><i style="background:${x.c}"></i>${esc(x.l)}<b>${x.v}%</b></div>`).join("")}</div>${donut(prov, 330, 46)}</div>`) : "",
    // The agencies trained, from who registered (Andrew 27 Oct 2026); without registrations, those who answered.
    agencies: T ? sec("agencies", `<h2>${t.trained}</h2>
        <div class="trained"><div><div class="big">${T.count}</div><div class="label">${t.differentAgencies}</div><div style="font-size:19px;margin-top:10px">${t.trainedLine(T.people)}</div></div>
          <div>${T.sectors.map((x, i) => `<div class="sbar"><div class="sl"><span>${esc(t.sectors[x.key])}</span><b>${x.count}</b></div><div class="track"><i style="width:${Math.max(4, Math.round((100 * x.count) / T.sectors[0].count))}%;background:${[NAVY, GOLD, "#3f5a8f", GOLDL, "#8b93a5", "#c9cfdc"][i % 6]}"></i></div></div>`).join("")}</div></div>
        <ul class="ag${listed.length <= 10 && !square ? " one" : ""}" style="margin-top:30px">${listed.map((a) => `<li>${esc(a.name)}</li>`).join("")}</ul>${T.count > listed.length ? `<div class="muted" style="font-size:18px;margin-top:12px">${t.more(T.count - listed.length)}</div>` : ""}`)
      : shown.length ? sec("agencies", `<h2>${t.agencies}</h2><ul class="ag${shown.length <= 10 ? " one" : ""}">${shown.map((a) => `<li>${esc(a.agency)}</li>`).join("")}</ul>${R.agencies.length > shown.length ? `<div class="muted" style="font-size:18px;margin-top:12px">${t.more(R.agencies.length - shown.length)}</div>` : ""}`) : "",
    topics: topics.length ? sec("topics", `<h2>${t.topics}</h2><div class="topics">${topics.map((s) => `<div><svg viewBox="0 0 64 64">${iconFor(s.title)}</svg><h3>${esc((lang === "fr" && s.titleFr) || s.title)}</h3></div>`).join("")}</div>`, "padding-bottom:0") : "",
    takeaways: take.length ? sec("takeaways", `<h2>${t.takeaways}</h2>${take.map(([a, v, s]) => `<div class="take"><div class="t">${esc(a)}</div><div class="v"><b>${v}%</b><span>${s}</span></div></div>`).join("")}`) : "",
    quotes: quotes.length ? sec("quotes", `<h2>${t.said}</h2>${quotes.map((q) => `<div class="q">“${esc(q.text)}”</div>`).join("")}`) : "",
    foot: `<div class="foot"><div><div class="h" style="font-size:28px;font-weight:600">${t.foot}</div><div style="color:${GOLDL};font-size:18px;margin-top:4px">${t.thanks}</div></div><div class="h" style="font-size:40px;font-weight:700;color:${GOLD}">ONGIA.CA</div></div>`,
  };
}
const avgTop2 = (list) => { const n = list.reduce((a, s) => a + s.n, 0); return n ? Math.round(list.reduce((a, s) => a + (s.top2 * s.n), 0) / n) : null; };

const CSS = `*{box-sizing:border-box} body{margin:0;background:#fff} body,#art{font-family:"DM Sans",Arial,sans-serif;color:${INK}}
.page{width:1080px;margin:0 auto;background:#fff}
.h{font-family:Oswald,"Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:.02em}
.sec{padding:44px 56px;border-top:6px solid ${GOLD}}
.sec h2{font-family:Oswald,sans-serif;font-weight:600;font-size:34px;color:${NAVY};margin:0 0 22px;text-transform:uppercase;letter-spacing:.03em;display:flex;align-items:center;gap:14px}
.sec h2:after{content:"";flex:1;height:2px;background:${GOLD};opacity:.6}
.grid3{display:grid;grid-template-columns:repeat(3,1fr)} .grid3>div{padding:6px 26px;border-left:1.5px solid #e2ddcf} .grid3>div:first-child{border-left:0;padding-left:0}
.big{font-family:Oswald,sans-serif;font-weight:700;font-size:96px;line-height:.95;color:${GOLD}}
.label{font-family:Oswald,sans-serif;font-size:22px;color:${NAVY};text-transform:uppercase;letter-spacing:.04em}
.muted{color:${MUTED}}
.legend div{display:flex;align-items:center;gap:12px;font-size:21px;margin:7px 0} .legend i{width:18px;height:18px;display:inline-block;flex:none} .legend b{margin-left:auto;font-family:Oswald,sans-serif;font-size:26px;color:${NAVY}}
.topics{display:grid;grid-template-columns:repeat(4,1fr);background:${DEEP};color:#fff;margin:0 -56px;padding:30px 40px}
.topics>div{padding:18px 16px;text-align:center;border-right:1px solid rgba(255,255,255,.15);border-bottom:1px solid rgba(255,255,255,.15)} .topics>div:nth-child(4n){border-right:0}
.topics svg{color:${GOLD};width:64px;height:64px} .topics h3{font-family:Oswald,sans-serif;text-transform:uppercase;font-weight:500;font-size:20px;margin:10px 0 6px;letter-spacing:.03em} .topics p{margin:0;font-size:15px;color:#c9cfdc;line-height:1.35}
.take{display:grid;grid-template-columns:1fr auto;border-bottom:1.5px solid #e2ddcf;padding:14px 0;align-items:center} .take:last-child{border:0}
.take .t{font-family:Oswald,sans-serif;text-transform:uppercase;font-size:24px;color:${NAVY}} .take .v{text-align:right} .take .v b{font-family:Oswald,sans-serif;font-size:48px;color:${GOLD};display:block;line-height:1} .take .v span{font-size:15px;color:${MUTED}}
.q{border-left:6px solid ${GOLD};background:${PALE};padding:20px 24px;margin:0 0 16px;font-size:22px;line-height:1.45}
.ag{columns:2;column-gap:40px;font-size:20px;line-height:1.75;margin:0;padding:0;list-style:none} .ag li:before{content:"■";color:${GOLD};font-size:12px;margin-right:12px;vertical-align:3px}
.trained{display:grid;grid-template-columns:300px 1fr;gap:44px;align-items:center}
.sbar{margin:0 0 14px} .sl{display:flex;justify-content:space-between;gap:16px;font-size:20px} .sl b{font-family:Oswald,sans-serif;font-size:24px;color:${NAVY}}
.track{height:14px;background:#ece6d6;border-radius:7px;overflow:hidden;margin-top:6px} .track i{display:block;height:100%;border-radius:7px}
.foot{background:${DEEP};color:#fff;display:flex;justify-content:space-between;align-items:center;padding:30px 56px}
.square{width:1080px;height:1080px;display:flex;flex-direction:column;overflow:hidden;background:#fff;border-top:16px solid ${GOLD}}
.square .fit{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;justify-content:center;margin:0 auto;width:1080px}
.square .badge{flex:none} .square .in{width:1080px;margin:0 auto}
.square .sec{border-top:0;padding:40px 64px}
.square .sec h2{font-size:58px;margin-bottom:34px} .square .sec h2:after{height:3px}
.square .big{font-size:170px} .square .label{font-size:32px}
.square .grid3{grid-template-columns:1fr 1fr;row-gap:36px}
.square .grid3>div:nth-child(3){grid-column:1/3;border-left:0;padding:30px 0 0;border-top:1.5px solid #e2ddcf;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;column-gap:34px;row-gap:4px}
.square .grid3>div:nth-child(3) .big{margin:0!important;font-size:140px;white-space:nowrap} .square .grid3>div:nth-child(3)>div:nth-child(3){margin:0 0 0 10px!important;zoom:1.4}
.square .grid3>div:nth-child(3)>div:nth-child(4){font-size:24px!important;flex-basis:100%;text-align:center} .square .grid3>div:nth-child(3) .h{font-size:46px!important;margin-top:0!important}
.square .legend div{font-size:32px;margin:12px 0} .square .legend i{width:26px;height:26px} .square .legend b{font-size:40px}
.square .ag{font-size:31px;line-height:1.6;column-gap:50px} .square .ag li:before{font-size:16px}
.square .ag.one{columns:1}
.square .topics{grid-template-columns:1fr 1fr;margin:0 -64px;padding:24px 50px} .square .topics>div{padding:26px 20px;border-right:1px solid rgba(255,255,255,.15)!important} .square .topics>div:nth-child(2n){border-right:0!important}
.square .topics svg{width:92px;height:92px} .square .topics h3{font-size:32px} .square .topics p{font-size:22px}
.square .take{padding:22px 0} .square .take .t{font-size:38px} .square .take .v b{font-size:76px} .square .take .v span{font-size:20px}
.square .q{font-size:32px;padding:26px 32px;margin-bottom:22px}
.square .trained{grid-template-columns:260px 1fr;gap:40px} .square .sl{font-size:28px} .square .sl b{font-size:34px} .square .track{height:18px}
.square .grid3 .legend div{font-size:24px!important;margin:6px 0!important} .square .grid3 .legend b{font-size:28px!important}
.square .grid3>div:first-child>div:nth-child(3){font-size:28px!important} .square .grid3>div:first-child>div:nth-child(4){font-size:22px!important}
.square .grid3 svg{width:280px;height:280px}`;

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
  const head = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap"><style>${CSS}</style></head><body>`;
  if (block) {
    const one = block === "event" ? s.event : s[block];
    if (!one) return null;
    const small = `<div class="badge" style="background:${DEEP};color:#fff;display:flex;justify-content:space-between;align-items:center;padding:20px 56px;border-top:5px solid ${GOLD}">${logo(52)}<span class="h" style="font-size:22px;letter-spacing:.06em;text-align:right">${esc(String(event.title).split(/\s*:\s*/)[0])}${event.dayOne ? ` · ${event.dayOne.slice(0, 4)}` : ""}<br><b style="font-size:26px;color:${GOLD}">ONGIA.CA</b></span></div>`;
    return `${head}<div class="square" id="art"><div class="fit"><div class="in">${one}</div></div>${block === "event" ? "" : small}</div></body></html>`;
  }
  return `${head}<div class="page" id="art">${s.event}${s.stats}${s.provinces}${s.agencies}${s.topics}${s.takeaways}${s.quotes}${s.foot}</div></body></html>`;
}

/** The sections that can be made into social media squares, in order, with their names. */
export const BLOCKS = [["event", "The event"], ["stats", "Attendees, experience and rating"], ["provinces", "Provinces"], ["agencies", "Agencies"], ["topics", "Topics"], ["takeaways", "Key takeaways"], ["quotes", "What participants said"]];
