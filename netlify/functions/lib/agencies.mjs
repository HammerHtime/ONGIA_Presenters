import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./contract.mjs";
import { getAgencyList, putAgencyList } from "./store.mjs";

/**
 * One name for each agency (Andrew 27 Oct 2026: "when people are registering … they will say I work for TPS, others
 * will say Toronto Police, others Toronto Police Service … OPP, Ontario Provincial Police, OPP - Gang Unit"). Every
 * event's registrations, survey and infographic use the standard name; what each person wrote is kept as they wrote it.
 *
 * The list is shared by every event and grows: a spelling the desk cannot place goes on a short review list, Claude
 * suggests where it belongs, Andrew confirms once, and from then on that spelling is known everywhere.
 */

// Where the list starts: the agencies ONGIA's events draw on most. Each with its usual short forms.
const SEED = [
  ["Toronto Police Service", "ON", ["TPS", "Toronto Police", "Toronto PS", "Toronto Police Services"]],
  ["Ontario Provincial Police", "ON", ["OPP", "Ontario Provincial Police Service"]],
  ["Royal Canadian Mounted Police", "", ["RCMP", "GRC", "Gendarmerie royale du Canada", "Mounties", "RCMP-GRC"]],
  ["Canada Border Services Agency", "", ["CBSA", "ASFC", "Agence des services frontaliers du Canada", "Canada Border Services", "Border Services"]],
  ["Correctional Service Canada", "", ["CSC", "SCC", "Correctional Service of Canada", "Correctional Services Canada", "Corrections Canada", "Service correctionnel Canada"]],
  ["Peel Regional Police", "ON", ["PRP", "Peel Police", "Peel Regional Police Service"]],
  ["York Regional Police", "ON", ["YRP", "York Police", "York Regional Police Service"]],
  ["Durham Regional Police Service", "ON", ["DRPS", "Durham Police", "Durham Regional Police"]],
  ["Halton Regional Police Service", "ON", ["HRPS", "Halton Police", "Halton Regional Police"]],
  ["Hamilton Police Service", "ON", ["HPS", "Hamilton Police"]],
  ["Ottawa Police Service", "ON", ["OPS", "Ottawa Police"]],
  ["Niagara Regional Police Service", "ON", ["NRPS", "Niagara Police", "Niagara Regional Police"]],
  ["Waterloo Regional Police Service", "ON", ["WRPS", "Waterloo Police", "Waterloo Regional Police"]],
  ["London Police Service", "ON", ["LPS", "London Police"]],
  ["Windsor Police Service", "ON", ["Windsor Police"]],
  ["Kingston Police", "ON", ["Kingston Police Service", "KPS"]],
  ["Barrie Police Service", "ON", ["Barrie Police"]],
  ["Guelph Police Service", "ON", ["Guelph Police"]],
  ["Greater Sudbury Police Service", "ON", ["Sudbury Police", "GSPS"]],
  ["Thunder Bay Police Service", "ON", ["Thunder Bay Police", "TBPS"]],
  ["Ministry of the Solicitor General (Ontario)", "ON", ["Solicitor General", "SolGen", "Ontario Ministry of the Solicitor General", "MSG"]],
  ["Akwesasne Mohawk Police Service", "ON", ["AMPS", "Akwesasne Police"]],
  ["Sûreté du Québec", "QC", ["SQ", "Surete du Quebec"]],
  ["Service de police de la Ville de Montréal", "QC", ["SPVM", "Montreal Police", "Montreal Police Service"]],
  ["Service de police de la Ville de Québec", "QC", ["SPVQ", "Quebec City Police"]],
  ["Service de police de Laval", "QC", ["Laval Police", "SPL"]],
  ["Service de police de l'agglomération de Longueuil", "QC", ["SPAL", "Longueuil Police"]],
  ["Gatineau Police Service", "QC", ["Service de police de la Ville de Gatineau", "SPVG", "Gatineau Police"]],
  ["Winnipeg Police Service", "MB", ["WPS", "Winnipeg Police"]],
  ["Brandon Police Service", "MB", ["Brandon Police"]],
  ["Manitoba Criminal Intelligence Centre", "MB", ["MCIC"]],
  ["Manitoba First Nations Police Service", "MB", ["MFNPS"]],
  ["Regina Police Service", "SK", ["RPS", "Regina Police"]],
  ["Saskatoon Police Service", "SK", ["SPS", "Saskatoon Police"]],
  ["Prince Albert Police Service", "SK", ["Prince Albert Police"]],
  ["Calgary Police Service", "AB", ["CPS", "Calgary Police"]],
  ["Edmonton Police Service", "AB", ["EPS", "Edmonton Police"]],
  ["Lethbridge Police Service", "AB", ["Lethbridge Police"]],
  ["Medicine Hat Police Service", "AB", ["Medicine Hat Police"]],
  ["Alberta Law Enforcement Response Teams", "AB", ["ALERT"]],
  ["Alberta Sheriffs", "AB", ["Alberta Sheriff", "Sheriffs Branch"]],
  ["Strathcona County Enforcement Services", "AB", ["Strathcona County"]],
  ["Government of Alberta", "AB", ["GOA", "Alberta Government"]],
  ["Vancouver Police Department", "BC", ["VPD", "Vancouver Police"]],
  ["Surrey Police Service", "BC", ["Surrey Police"]],
  ["Victoria Police Department", "BC", ["VicPD", "Victoria Police"]],
  ["Delta Police Department", "BC", ["Delta Police", "DPD"]],
  ["Abbotsford Police Department", "BC", ["Abbotsford Police", "APD"]],
  ["Combined Forces Special Enforcement Unit", "", ["CFSEU", "CFSEU-BC", "CFSEU BC"]],
  ["Halifax Regional Police", "NS", ["HRP", "Halifax Police"]],
  ["Royal Newfoundland Constabulary", "NL", ["RNC"]],
  ["Saint John Police Force", "NB", ["Saint John Police"]],
  ["Fredericton Police Force", "NB", ["Fredericton Police"]],
  ["Criminal Intelligence Service Canada", "", ["CISC", "Criminal Intelligence Service Ontario", "CISO"]],
  ["Canadian Armed Forces Military Police", "", ["Military Police", "CFMP", "Canadian Forces Military Police"]],
  ["Public Prosecution Service of Canada", "", ["PPSC"]],
  ["Ministry of the Attorney General (Ontario)", "ON", ["Crown Attorney", "Ontario Crown", "MAG"]],
  ["Canada Revenue Agency", "", ["CRA"]],
  ["FINTRAC", "", ["Financial Transactions and Reports Analysis Centre of Canada"]],
  ["Public Safety Canada", "", ["Public Safety and Emergency Preparedness Canada"]],
].map(([name, province, aliases]) => ({ name, province, aliases }));

export const PROVINCES = { ON: "Ontario", QC: "Quebec", MB: "Manitoba", SK: "Saskatchewan", AB: "Alberta", BC: "British Columbia",
  NS: "Nova Scotia", NB: "New Brunswick", NL: "Newfoundland and Labrador", PE: "Prince Edward Island", YT: "Yukon", NT: "Northwest Territories", NU: "Nunavut" };

/** Words that name a part of an agency, not the agency: "OPP - Gang Unit", "TPS, Intelligence", "RCMP Major Crime Unit". */
const PART = /\b(gang|guns? and gangs?|intelligence|intel|major crimes?|drug|drugs|organized crime|biker enforcement|street crime|human trafficking|homicide|investigations?|investigative services|enforcement|special|tactical|operations|services?)?\s*(unit|section|branch|division|detachment|bureau|squad|team|office|program|department)\b.*$/;

/** A spelling reduced to what matters for matching: lower case, no accents, no punctuation, no "the", no unit. */
export function key(text) {
  let s = String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  s = s.split(/\s[-–—|/]\s|\s[-–—]|[-–—]\s|,|\(|;/)[0];           // "OPP - Gang Unit", "TPS, Intel", "RCMP (E Div)"
  s = s.replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\b(the|of|de|la|du|des|l)\b/g, " ").replace(/\s+/g, " ").trim();
  const cut = s.replace(PART, "").trim();
  return cut.length >= 2 ? cut : s;
}

/** The list as stored, merged over the starting one. */
export async function directory() {
  const saved = (await getAgencyList()) ?? [];
  const byName = new Map(SEED.map((a) => [a.name, { ...a, aliases: [...a.aliases] }]));
  for (const a of saved) {
    const had = byName.get(a.name);
    byName.set(a.name, had ? { ...had, ...a, aliases: [...new Set([...(had.aliases ?? []), ...(a.aliases ?? [])])] } : { province: "", aliases: [], ...a });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Every spelling that leads to each agency. */
function lookup(list) {
  const map = new Map();
  for (const a of list) for (const s of [a.name, ...(a.aliases ?? [])]) { const k = key(s); if (k && !map.has(k)) map.set(k, a); }
  return map;
}

/** The standard agency for what someone wrote, or null when the desk cannot place it. */
export function standardOf(raw, list) {
  const k = key(raw);
  if (!k) return null;
  const map = list._lookup ?? (list._lookup = lookup(list));
  if (map.has(k)) return map.get(k);
  // "Toronto Police Service Gang Unit" with no dash: try the words before a unit word, longest first.
  const words = k.split(" ");
  for (let n = words.length - 1; n >= 1; n--) { const p = words.slice(0, n).join(" "); if (map.has(p)) return map.get(p); }
  return null;
}

/** An event's registrations grouped by standard agency, and the spellings still to place. */
export function agenciesOf(people, list) {
  const known = new Map(), unknown = new Map();
  for (const p of people.filter((x) => x.status !== "WITHDRAWN")) {
    const raw = String(p.organization ?? "").trim();
    if (!raw) continue;
    const a = standardOf(raw, list);
    if (a) {
      const g = known.get(a.name) ?? { agency: a.name, province: a.province || "", count: 0, spellings: new Set() };
      g.count++; g.spellings.add(raw); known.set(a.name, g);
    } else {
      const u = unknown.get(key(raw)) ?? { raw, count: 0 };
      u.count++; unknown.set(key(raw), u);
    }
  }
  return {
    agencies: [...known.values()].map((g) => ({ ...g, spellings: [...g.spellings] })).sort((a, b) => b.count - a.count || a.agency.localeCompare(b.agency)),
    unplaced: [...unknown.values()].sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw)),
  };
}

/** Remember that a spelling means an agency (new to the list if needed). */
export async function teach(raw, agencyName, province = "") {
  const name = String(agencyName ?? "").trim().slice(0, 160);
  const spelling = String(raw ?? "").trim().slice(0, 160);
  if (!name || !spelling) throw new Error("Which agency?");
  const saved = (await getAgencyList()) ?? [];
  const list = await directory();
  const existing = list.find((a) => a.name.toLowerCase() === name.toLowerCase());
  const target = existing?.name ?? name;
  const row = saved.find((a) => a.name === target) ?? { name: target, province: existing?.province || (PROVINCES[province] ? province : ""), aliases: [] };
  if (key(spelling) !== key(target) && !row.aliases.includes(spelling)) row.aliases.push(spelling);
  if (!existing && PROVINCES[province]) row.province = province;
  await putAgencyList([...saved.filter((a) => a.name !== target), row]);
  return target;
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["matches"],
  properties: { matches: { type: "array", items: { type: "object", additionalProperties: false, required: ["raw", "agency", "isNew", "province"],
    properties: { raw: { type: "string" }, agency: { type: "string" }, isNew: { type: "boolean" }, province: { type: "string" } } } } },
};

/**
 * Claude's suggestion for each spelling the desk could not place: one of the agencies on the list, or, when it is
 * plainly an agency not on it, that agency's full official name. A suggestion only; Andrew confirms each.
 */
export async function suggest(raws, list, { client = null } = {}) {
  if (!raws.length) return [];
  if (!client && !anthropicKey()) throw new Error("The desk has no Anthropic API key, so Claude cannot suggest matches. Pick each one by hand.");
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const message = await api.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: "You standardize the names of Canadian law enforcement, corrections, border, justice and government agencies as people typed them on a conference registration form. For each spelling, give the agency it means: use a name from the given list exactly when it is that agency (ignore units, divisions and sections: 'OPP - Gang Unit' is Ontario Provincial Police). If it is an agency not on the list, give its full official name and set isNew. If it is not an agency at all, or you cannot tell, give an empty agency. Province is the two-letter code for a provincial or municipal agency, empty for a federal one.",
    messages: [{ role: "user", content: `The list:\n${list.map((a) => a.name).join("\n")}\n\nThe spellings:\n${raws.map((r) => `- ${r}`).join("\n")}` }],
  });
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let out;
  try { out = JSON.parse(text).matches ?? []; } catch { throw new Error("Claude's answer could not be read. Try again."); }
  return raws.map((raw) => {
    const m = out.find((x) => x.raw === raw);
    return { raw, agency: m?.agency ?? "", isNew: !!m?.isNew && !list.some((a) => a.name === m?.agency), province: PROVINCES[m?.province] ? m.province : "" };
  });
}
