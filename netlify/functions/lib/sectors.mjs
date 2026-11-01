import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./contract.mjs";
import { directory, setSectors, SECTOR_IDS as IDS } from "./agencies.mjs";

/**
 * Which sector each agency works in (Andrew 1 Nov 2026: "have claude sort agencies as best it can. It won't be perfect
 * and make the best guess"), for the reports' "who we trained, by sector". Claude sorts every agency on the list once;
 * new agencies are sorted when the reports are made or when someone presses "Sort into sectors". A sector Andrew sets in
 * Admin › Agencies is his (sectorBy "desk") and no later pass changes it.
 */
export const SECTORS = [
  { id: "police", en: "Police services", fr: "Services de police" },
  { id: "education", en: "Education and schools", fr: "Éducation et écoles" },
  { id: "corrections", en: "Corrections and probation", fr: "Services correctionnels et probation" },
  { id: "social", en: "Social and youth services", fr: "Services sociaux et jeunesse" },
  { id: "community", en: "Community organizations", fr: "Organismes communautaires" },
  { id: "justice", en: "Justice and prosecutors", fr: "Justice et poursuites" },
  { id: "federal", en: "Federal and border", fr: "Fédéral et frontières" },
  { id: "health", en: "Health", fr: "Santé" },
  { id: "other", en: "Other", fr: "Autres" },
];
export const SECTOR_IDS = IDS;
export const sectorName = (id, lang = "en") => SECTORS.find((s) => s.id === id)?.[lang] ?? SECTORS.at(-1)[lang];

/**
 * A best guess from the name alone, used where Claude isn't available (tests, a desk without a key) and as the
 * starting point Claude improves on. Order matters: "RCMP" before "police", "Crown" before "attorney".
 */
const RULES = [
  ["federal", /\b(rcmp|royal canadian mounted|gendarmerie|cbsa|border services|canada border|csis|security intelligence service|public safety canada|criminal intelligence service|cisc|fintrac|canada revenue|revenue agency|department of national defence|national defence|canadian armed forces|military police|immigration|ircc|transport canada|statistics canada|health canada|environment canada|fisheries|global affairs|privy council|government of canada|federal)\b/i],
  ["corrections", /\b(correction(s|al)?|probation|parole|youth custody|detention|jail|penitentiary|custody|csc|scc)\b/i],
  ["justice", /\b(crown|prosecut\w*|attorney|ministry of the attorney|justice|court(s)?|judge|judiciary|legal aid|law society|lawyer|barrister|public prosecution|ppsc|dpcp|procureur)\b/i],
  ["police", /\b(police|policing|constabulary|sheriff|opp|sq|sûreté|surete|spvm|tps|vpd|rps|service de police|regie de police|bylaw|by-law|security services?|transit (special )?constable|special constable)\b/i],
  ["education", /\b(school|schools|school board|district school|catholic district|board of education|commission scolaire|centre de services scolaire|college|collège|university|université|cegep|cégep|academy|education|teacher|student)\b/i],
  ["health", /\b(health|hospital|hôpital|medical|clinic|public health|nursing|addiction|mental health|cmha|santé|ciusss|cisss|paramedic|ems)\b/i],
  ["social", /\b(children'?s aid|child(ren)? and family|family services|social services|youth services|youth|jeunesse|child welfare|cas|community and social|social development|ministry of children|services sociaux|shelter|housing|victim services|victims?)\b/i],
  ["community", /\b(association|foundation|society|coalition|network|centre|center|church|mosque|temple|club|community|non-?profit|organization|organisation|alliance|council|boys and girls|big brothers|ymca|ywca|salvation army|united way|first nations?|métis|metis|inuit|indigenous|band council|friendship centre)\b/i],
];
export function guessSector(name) {
  const s = String(name ?? "");
  for (const [id, re] of RULES) if (re.test(s)) return id;
  return "other";
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["agencies"],
  properties: { agencies: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "sector"],
    properties: { name: { type: "string" }, sector: { type: "string", enum: SECTOR_IDS } } } } },
};
const SYSTEM = `You sort Canadian organizations into sectors for ONGIA, a non-profit that trains people who work on street gangs, youth violence, organized crime and human trafficking. Sectors:
- police: municipal, regional, provincial and First Nations police services, by-law and special constables (not the RCMP)
- education: school boards, schools, colleges, universities
- corrections: corrections, probation, parole, youth custody
- social: children's aid, child and family services, youth and social services, victim services, shelters, housing
- community: non-profits, associations, faith and cultural organizations, Indigenous community organizations
- justice: Crown and prosecution services, courts, attorneys general, legal aid
- federal: federal departments and agencies, the RCMP, the CBSA, intelligence services, the military
- health: hospitals, public health, addiction and mental health services
- other: anything else, including private companies
Give your best guess for every one; it doesn't have to be certain. Return each name exactly as given.`;

/** Claude's sectors for these agency names (batches of 150). `client` is for tests. */
export async function sortWithClaude(names, { client = null } = {}) {
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const out = new Map();
  for (let i = 0; i < names.length; i += 150) {
    const batch = names.slice(i, i + 150);
    const message = await api.messages.create({
      model: "claude-opus-5-5", max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: batch.map((n) => `- ${n}`).join("\n") }],
    });
    const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let got = [];
    try { got = JSON.parse(text).agencies ?? []; } catch { got = []; }
    const wanted = new Set(batch);
    for (const g of got) if (wanted.has(g.name) && SECTOR_IDS.includes(g.sector)) out.set(g.name, g.sector);
  }
  return out;
}

/**
 * Give a sector to every agency that has none (or, with `all`, every one not set by hand). Claude when the desk has a
 * key, the name-based guess otherwise, and the guess for any Claude skipped. Returns how many were sorted and how.
 */
export async function sortAgencies({ client = null, all = false, list = null } = {}) {
  const dir = list ?? (await directory());
  const todo = dir.filter((a) => a.sectorBy !== "desk" && (all || !a.sector)).map((a) => a.name);
  if (!todo.length) return { sorted: 0, by: null };
  let by = "guess", got = new Map();
  if (client || anthropicKey()) {
    try { got = await sortWithClaude(todo, { client }); by = "claude"; } catch (e) { console.log(`sectors: Claude couldn't sort them (${e.message}); using the best guess from the names`); }
  }
  const entries = todo.map((name) => got.has(name) ? { name, sector: got.get(name), by: "claude" } : { name, sector: guessSector(name), by: "guess" });
  await setSectors(entries);
  return { sorted: entries.length, by, claude: entries.filter((e) => e.by === "claude").length };
}
