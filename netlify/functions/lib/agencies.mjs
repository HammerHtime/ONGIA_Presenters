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

// Where the list starts: compiled by Claude on 27 Oct 2026 from every agency typed on two years of ONGIA's Wix
// registrations (3,898 registrations, 296 spellings), plus the main Canadian agencies. Each: standard name, province
// (blank for federal, national or outside Canada), and the ways people write it. Units, detachments and sections are
// dropped by the matching, so "RCMP F Division" and "OPP - POIB" need no line of their own.
const SEED = [
  // Federal and national
  ["Royal Canadian Mounted Police", "", ["RCMP", "GRC", "Gendarmerie royale du Canada", "Mounties", "RCMP-GRC", "Royal Canadian Mounted Police (RCMP) - Regular Members", "Nanaimo RCMP", "Oceanside RCMP", "RCMP SERT"]],
  ["Canada Border Services Agency", "", ["CBSA", "ASFC", "Agence des services frontaliers du Canada", "Canada Border Services", "Canada Border Service Agency", "Border Services"]],
  ["Correctional Service Canada", "", ["CSC", "SCC", "Correctional Service of Canada", "Correctional Services Canada", "Corrections Canada", "Service correctionnel Canada"]],
  ["Parole Board of Canada", "", ["PBC", "Commission des libérations conditionnelles du Canada"]],
  ["Criminal Intelligence Service Canada", "", ["CISC"]],
  ["Canadian Forces National Investigation Service", "", ["CFNIS", "CFNIS - Military Police"]],
  ["Canadian Armed Forces Military Police", "", ["Military Police", "Military Police Criminal Intelligence Section", "Canadian Armed Forces", "CFMP", "Canadian Forces Military Police", "National Defence/Canadian Military", "National Defence / Canadian Military", "Department of National Defence", "DND"]],
  ["Public Prosecution Service of Canada", "", ["PPSC"]],
  ["Canada Revenue Agency", "", ["CRA"]],
  ["FINTRAC", "", ["Financial Transactions and Reports Analysis Centre of Canada"]],
  ["Public Safety Canada", "", ["Public Safety and Emergency Preparedness Canada"]],
  ["Fisheries and Oceans Canada", "", ["DFO", "Fisheries and Oceans", "Fisheries and ocean Canada", "Department of Fisheries", "Department of Fisheries and Oceans"]],
  ["Transport Canada", "", []],
  ["Canadian Centre for Safer Communities", "", ["CCSC"]],
  ["CN Police", "", ["CN Police Service", "Canadian National Railway Police"]],
  ["Combined Forces Special Enforcement Unit – British Columbia", "BC", ["CFSEU", "CFSEU-BC", "CFSEU BC", "Combined Forces Special Enforcement Unit", "Combined Forces Special Enforcement Unit British Columbia", "Organized Crime Agency of British Columbia", "OCABC", "OCA-BC", "OCA-BC w/in CFSEU-BC"]],
  // Ontario
  ["Toronto Police Service", "ON", ["TPS", "Toronto Police", "Toronto PS", "Toronto Police Services"]],
  ["Ontario Provincial Police", "ON", ["OPP", "Ontario Provincial Police Service", "Police provinciale de l'Ontario", "PPO"]],
  ["Ministry of the Solicitor General (Ontario)", "ON", ["Ministry of the Solicitor General", "Ministry of Solicitor General", "Solicitor General", "SolGen", "MSG", "Ministry of the Soliciotr General",
    "Ministry of the Solicitor General (SOLGEN)", "Ministry of the Solicitor General (Ontario Correctional Services)", "Ministry of the Solicitor General of Ontario", "Ontario Solicitor General Corrections",
    "Ministry of Community Safety and Correctional Services", "Ontario Correctional Services", "Ontario Corrections", "Corrections Ontario", "Correctional Service Ontario", "Ministry of correctional services",
    "OCIU", "Ontario Correctional Intelligence Unit", "London South Probation and Parole", "Probation & Parole - Anti-Guns & Gangs"]],
  ["Ministry of the Attorney General (Ontario)", "ON", ["Ministry of the Attorney General", "Minstry of the Attorney General", "MAG", "Crown Attorney", "Ontario Crown", "Victim/Witness Assistance Program", "VWAP"]],
  ["Ministry of Children, Community and Social Services (Ontario)", "ON", ["Ministry of Children, Community and Social Services", "Ministry of Children Community and Social Services", "Ministry of Children, Community & Social Services",
    "Ministry of Children, Community and Social Services (MCCSS)", "MCCSS", "MCCSS Youth Justice", "MCCSS Youth Justice Probation", "MCCSS-Youth Justice", "MCCSS- Youth Justice",
    "Youth Justice Division", "Youth Justice Division - Intelligence Services", "Cecil Facer Youth Centre"]],
  ["Peel Regional Police", "ON", ["PRP", "Peel Police", "Peel Regional Police Service"]],
  ["York Regional Police", "ON", ["YRP", "York Police", "York Regional Police Service"]],
  ["Durham Regional Police Service", "ON", ["DRPS", "Durham Police", "Durham Regional Police"]],
  ["Halton Regional Police Service", "ON", ["HRPS", "Halton Police", "Halton Regional Police"]],
  ["Hamilton Police Service", "ON", ["HPS", "Hamilton Police", "Hamilton Policr"]],
  ["Ottawa Police Service", "ON", ["OPS", "Ottawa Police"]],
  ["Niagara Regional Police Service", "ON", ["NRPS", "Niagara Police", "Niagara Regional Police"]],
  ["Waterloo Regional Police Service", "ON", ["WRPS", "Waterloo Police", "Waterloo Regional Police"]],
  ["London Police Service", "ON", ["LPS", "London Police"]],
  ["Windsor Police Service", "ON", ["Windsor Police"]],
  ["Kingston Police", "ON", ["Kingston Police Service", "KPS"]],
  ["Barrie Police Service", "ON", ["Barrie Police"]],
  ["Guelph Police Service", "ON", ["Guelph Police"]],
  ["South Simcoe Police Service", "ON", ["South Simcoe Police"]],
  ["Greater Sudbury Police Service", "ON", ["Sudbury Police", "GSPS", "Greater Sudbury Police"]],
  ["Thunder Bay Police Service", "ON", ["Thunder Bay Police", "TBPS"]],
  ["Akwesasne Mohawk Police Service", "ON", ["AMPS", "Akwesasne Police"]],
  ["Anishinabek Police Service", "ON", ["APS", "Anishinabek Police"]],
  ["Nishnawbe-Aski Police Service", "ON", ["NAPS", "Nishnawbe Aski Police Service"]],
  ["UCCM Anishnaabe Police Service", "ON", ["UCCM Police", "UCCM"]],
  ["Criminal Intelligence Service Ontario", "ON", ["CISO"]],
  ["Ontario Police College", "ON", ["OPC"]],
  ["Alcohol and Gaming Commission of Ontario", "ON", ["AGCO"]],
  ["Toronto Community Housing", "ON", ["TCHC", "Toronto Community Housing Corporation"]],
  ["City of Toronto", "ON", []],
  ["City of Thunder Bay", "ON", []],
  ["Metrolinx", "ON", []],
  ["OC Transpo", "ON", []],
  ["Victim Services of Durham Region", "ON", ["Victim Services/DRPS"]],
  ["John Howard Society of London and District", "ON", ["John Howard Society"]],
  ["OPSEU", "ON", ["Ontario Public Service Employees Union"]],
  // Quebec
  ["Sûreté du Québec", "QC", ["SQ", "Surete du Quebec"]],
  ["Service de police de la Ville de Montréal", "QC", ["SPVM", "Montreal Police", "Montreal Police Service", "SPVM (service de police de la ville de Montréal)"]],
  ["Service de police de la Ville de Québec", "QC", ["SPVQ", "Quebec City Police"]],
  ["Service de police de la Ville de Gatineau", "QC", ["SPVG", "Gatineau Police", "Gatineau Police Service", "Gatineau PD", "Gatineau Police Department"]],
  ["Service de police de Laval", "QC", ["Laval Police", "SPL"]],
  ["Service de police de l'agglomération de Longueuil", "QC", ["SPAL", "Longueuil Police"]],
  ["Service de police de L'Assomption/Saint-Sulpice", "QC", ["Service de police de L'Assomption", "Service de police de L’Assomption/Saint-Sulpice"]],
  ["Revenu Québec", "QC", ["Revenu Quebec"]],
  // Manitoba
  ["Winnipeg Police Service", "MB", ["WPS", "Winnipeg Police", "Winnipeg"]],
  ["Brandon Police Service", "MB", ["Brandon Police"]],
  ["Manitoba First Nations Police Service", "MB", ["MFNPS", "Manitoba First Nations Police"]],
  ["Morden Police Service", "MB", ["Morden Police"]],
  ["Winkler Police Service", "MB", ["Winkler Police"]],
  ["Altona Police Service", "MB", ["Altona Police"]],
  ["Ste. Anne Police Service", "MB", ["Ste Anne Police Service", "Ste. Anne Police"]],
  ["Victoria Beach Police Service", "MB", []],
  ["Manitoba Justice", "MB", ["Manitoba Prosecutions", "Manitoba Prosecution Service", "Manitoba Criminal Property Forfeiture", "Criminal Property Forfeiture"]],
  ["Manitoba Criminal Intelligence Centre", "MB", ["MCIC", "CISM/MCIC", "CISM", "Criminal Intelligence Service Manitoba"]],
  ["Manitoba Finance", "MB", ["Manitoba Finance's Special Investigations Unit", "Manitoba Finance Special Investigations Unit"]],
  ["Liquor, Gaming and Cannabis Authority of Manitoba", "MB", ["LGCA", "Liquor Gaming and Cannabis for Manitoba", "Liquor Gaming and Cannabis Authority of Manitoba"]],
  ["Manitoba Liquor and Lotteries", "MB", ["MBLL"]],
  ["Manitoba Public Insurance", "MB", ["MPI"]],
  ["The Joy Smith Foundation", "MB", ["Joy Smith Foundation"]],
  // Saskatchewan
  ["Regina Police Service", "SK", ["RPS", "Regina Police"]],
  ["Saskatoon Police Service", "SK", ["SPS", "Saskatoon Police", "Sakskatoon Police Service", "Saskatoon Police Servive", "Sasktoon Police Service"]],
  ["Prince Albert Police Service", "SK", ["Prince Albert Police"]],
  ["Moose Jaw Police Service", "SK", ["Moose Jaw Police"]],
  ["Saskatchewan Ministry of Corrections, Policing and Public Safety", "SK", ["Ministry of Corrections, Policing and Public Safety", "CPPS", "CPPS SIU"]],
  ["Saskatchewan Firearms Office", "SK", ["Saskatchewan Ballistics Lab", "Government of Saskatchewan, Firearms Secretariat", "Firearms Secretariat"]],
  ["Saskatchewan Marshals Service", "SK", ["Saskatchewan Marshalls", "Saskatchewan Marshals"]],
  ["Saskatchewan Ministry of Justice and Attorney General", "SK", ["Saskatchewan Ministry of Justice", "Ministry of Justice and Attorney General", "Public Prosecutions Regina"]],
  ["Government of Saskatchewan", "SK", ["Gov't of Saskatchewan SIU", "Govt of Saskatchewan"]],
  ["University of Regina", "SK", ["University of Regina Protective Services"]],
  // Alberta
  ["Calgary Police Service", "AB", ["CPS", "Calgary Police"]],
  ["Edmonton Police Service", "AB", ["EPS", "Edmonton Police"]],
  ["Lethbridge Police Service", "AB", ["Lethbridge Police"]],
  ["Medicine Hat Police Service", "AB", ["Medicine Hat Police"]],
  ["Alberta Law Enforcement Response Teams", "AB", ["ALERT", "Alberta Law Enforcement Response Team"]],
  ["Alberta Sheriffs", "AB", ["Alberta Sheriff", "Alberta Sheriffs Branch"]],
  ["Alberta Public Safety and Emergency Services", "AB", ["Public Safety and Emergency Services", "Public Safety & Emergency Services", "PSES"]],
  ["Strathcona County Enforcement Services", "AB", ["Strathcona County"]],
  ["Alberta Gaming, Liquor and Cannabis", "AB", ["AGLC", "Alberta Gaming and Liquor Commission"]],
  ["Government of Alberta", "AB", ["GOA", "Alberta Government"]],
  // British Columbia
  ["Vancouver Police Department", "BC", ["VPD", "Vancouver Police"]],
  ["Surrey Police Service", "BC", ["Surrey Police"]],
  ["Victoria Police Department", "BC", ["VicPD", "Victoria Police", "Victoria Police Dept"]],
  ["Saanich Police Department", "BC", ["Saanich Police"]],
  ["Delta Police Department", "BC", ["Delta Police", "DPD"]],
  ["Abbotsford Police Department", "BC", ["Abbotsford Police", "APD"]],
  ["BC Corrections", "BC", ["British Columbia Corrections"]],
  ["City of Surrey", "BC", []],
  // Atlantic
  ["New Brunswick Department of Justice and Public Safety", "NB", ["Department of Justice and Public Safety", "Justice and Public Safety", "JPS", "JPS Adult custody services", "JPS HSE", "NB Adult Custody Services",
    "New Brunswick Public Safety", "Public Safety NB", "Justice and Public Safety - Safer Communities Section"]],
  ["Criminal Intelligence Service New Brunswick", "NB", ["CISNB"]],
  ["Edmundston Police Force", "NB", ["Edmundston Police", "Edmundston", "Edmundston Police Service", "Edmunston Police Dept", "Edmundston Police Department", "Force policière d'Edmundston"]],
  ["Force policière Belle-Baie", "NB", ["Force Policière Belle-Baie", "Belle-Baie Police Force"]],
  ["Woodstock Police Force", "NB", []],
  ["Grand Falls Police Force", "NB", []],
  ["Bathurst Police Force", "NB", []],
  ["Miramichi Police Force", "NB", ["Miramichi Police", "Miramichi Police Department"]],
  ["Fredericton Police Force", "NB", ["Fredericton Police"]],
  ["Saint John Police Force", "NB", ["Saint John Police"]],
  ["Halifax Regional Police", "NS", ["HRP", "Halifax Police"]],
  ["Criminal Intelligence Service Nova Scotia", "NS", ["CISNS", "NS Dept of Justice / Criminal Intelligence Service Nova Scotia"]],
  ["Nova Scotia Public Prosecution Service", "NS", ["NS Public Prosecution Service", "Public Prosecution Service Nova Scotia"]],
  ["Service Nova Scotia", "NS", ["Alcohol, Gaming, Fuel and Tobacco - Service Nova Scotia", "Alcohol, Gamining, Fuel and Tobacco - Service Nova Scotia"]],
  ["Royal Newfoundland Constabulary", "NL", ["RNC"]],
  // Outside Canada, and private partners
  ["Bureau of Alcohol, Tobacco, Firearms and Explosives (ATF)", "", ["ATF", "Bureau of Alcohol, Tobacco, Firearms and Explosives"]],
  ["Prince George's County Police Department", "", ["Prince George's County Police"]],
  ["Madawaska Police Department", "", ["Madawaska Police"]],
  ["Arizona Gang Investigators Association", "", ["Arizona Gang Association", "AGIA"]],
  ["Florida Gang Investigators Association", "", ["Florida Gang Association", "FGIA"]],
  ["Philip Morris International", "", ["PMI", "PMI USA ITP", "Philip Morris"]],
  ["Rothmans, Benson & Hedges", "", ["RBH", "Rothmans, Bensons & Hedges", "Rothmans Benson and Hedges", "Rothmans, Bensons and Hedges"]],
  ["PwC", "", ["Price Waterhouse Coopers", "PricewaterhouseCoopers"]],
].map(([name, province, aliases]) => ({ name, province, aliases }));

export const PROVINCES = { ON: "Ontario", QC: "Quebec", MB: "Manitoba", SK: "Saskatchewan", AB: "Alberta", BC: "British Columbia",
  NS: "Nova Scotia", NB: "New Brunswick", NL: "Newfoundland and Labrador", PE: "Prince Edward Island", YT: "Yukon", NT: "Northwest Territories", NU: "Nunavut" };

/** Words that name a part of an agency, not the agency: "OPP - Gang Unit", "TPS, Intelligence", "RCMP Major Crime Unit". */
const PART = /\b(gang|guns? and gangs?|intelligence|intel|major crimes?|drug|drugs|organized crime|biker enforcement|street crime|human trafficking|homicide|investigations?|investigative services|enforcement|special|tactical|operations|services?)?\s*(unit|section|branch|division|detachment|bureau|squad|team)\b.*$/;

/** A spelling reduced to what matters for matching: lower case, no accents, no punctuation, no "the", no unit. */
export function key(text) {
  let s = String(text ?? "").replace(/[\uFFFC\uFFFD\u200B-\u200D\uFEFF]/g, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2018\u2019]/g, "'").toLowerCase().trim();
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
