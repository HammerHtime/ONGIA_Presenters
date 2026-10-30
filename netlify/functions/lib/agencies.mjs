import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./contract.mjs";
import { getAgencyList, putAgencyList, getMeta, putMeta, listEvents, getAttendees } from "./store.mjs";

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
// French names, for French certificates, and the work email domains of the agencies people come from most (Andrew 30 Oct
// 2026). The rest are learned: every match the desk makes or Andrew corrects records the domains of the people behind it.
const EXTRA = {
  "Royal Canadian Mounted Police": { fr: "Gendarmerie royale du Canada", domains: ["rcmp-grc.gc.ca"] },
  "Canada Border Services Agency": { fr: "Agence des services frontaliers du Canada", domains: ["cbsa-asfc.gc.ca"] },
  "Correctional Service Canada": { fr: "Service correctionnel du Canada", domains: ["csc-scc.gc.ca"] },
  "Parole Board of Canada": { fr: "Commission des libérations conditionnelles du Canada" },
  "Criminal Intelligence Service Canada": { fr: "Service canadien de renseignements criminels" },
  "Public Prosecution Service of Canada": { fr: "Service des poursuites pénales du Canada" },
  "Canada Revenue Agency": { fr: "Agence du revenu du Canada" },
  "Public Safety Canada": { fr: "Sécurité publique Canada" },
  "Fisheries and Oceans Canada": { fr: "Pêches et Océans Canada" },
  "Transport Canada": { fr: "Transports Canada" },
  "Toronto Police Service": { fr: "Service de police de Toronto", domains: ["torontopolice.on.ca"] },
  "Ontario Provincial Police": { fr: "Police provinciale de l'Ontario", domains: ["opp.ca"] },
  "Peel Regional Police": { domains: ["peelpolice.ca"] },
  "York Regional Police": { domains: ["yrp.ca"] },
  "Ottawa Police Service": { fr: "Service de police d'Ottawa", domains: ["ottawapolice.ca"] },
};

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
].map(([name, province, aliases]) => ({ name, province, aliases, fr: EXTRA[name]?.fr ?? "", domains: EXTRA[name]?.domains ?? [] }));

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

/**
 * The list as stored, merged over the starting one. A stored row can add spellings and domains, drop ones that turned out
 * wrong (Undo), give a French name, or hide an agency that was renamed or merged into another.
 */
export async function directory() {
  const saved = (await getAgencyList()) ?? [];
  const byName = new Map(SEED.map((a) => [a.name, { ...a, aliases: [...a.aliases], domains: [...a.domains] }]));
  for (const a of saved) {
    const had = byName.get(a.name) ?? { province: "", fr: "", aliases: [], domains: [] };
    const drop = new Set((a.dropped ?? []).map(key)), dropD = new Set(a.droppedDomains ?? []);
    byName.set(a.name, { ...had, ...a, fr: a.fr || had.fr || "", province: a.province ?? had.province ?? "",
      aliases: [...new Set([...had.aliases, ...(a.aliases ?? [])])].filter((s) => !drop.has(key(s))),
      domains: [...new Set([...had.domains, ...(a.domains ?? [])])].filter((d) => !dropD.has(d)) });
  }
  return [...byName.values()].filter((a) => !a.hidden).sort((a, b) => a.name.localeCompare(b.name));
}

/** Every spelling that leads to each agency. */
function lookup(list) {
  const map = new Map();
  for (const a of list) for (const s of [a.name, ...(a.aliases ?? [])]) { const k = key(s); if (k && !map.has(k)) map.set(k, a); }
  return map;
}

/** The spelling as typed, or the words before a unit ("Toronto Police Service Gang Unit" with no dash). */
function exactOf(k, map) {
  if (map.has(k)) return map.get(k);
  const words = k.split(" ");
  for (let n = words.length - 1; n >= 1; n--) { const p = words.slice(0, n).join(" "); if (map.has(p)) return map.get(p); }
  return null;
}

/** Edits between two spellings (a swapped pair counts once), or more than `max` as soon as that is certain. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i]; let least = i;
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row.push(d); least = Math.min(least, d);
    }
    if (least > max) return max + 1;
    prev2 = prev; prev = row;
  }
  return prev[b.length];
}

/**
 * A misspelling of a known name (Andrew 30 Oct 2026: "Spelling mistakes"): one letter off, two in a long name. Short
 * names never count, so OPS is not taken for OPP, and a spelling equally close to two agencies is left alone.
 */
function nearOf(k, map) {
  if (k.length < 8) return null;
  const max = k.length > 14 ? 2 : 1;
  let best = null, at = max + 1, tie = false;
  for (const [kk, a] of map) {
    if (kk.length < 6) continue;
    const d = distance(k, kk, max);
    if (d < at) { at = d; best = a; tie = false; } else if (d === at && best !== a) tie = true;
  }
  return best && at <= max && !tie ? best : null;
}

/** How what someone wrote is placed: "known" (on the list), "near" (a misspelling of one on it), or null. */
export function placeOf(raw, list) {
  const k = key(raw);
  if (!k) return null;
  const map = list._lookup ?? (list._lookup = lookup(list));
  const near = list._near ?? (list._near = new Map());
  const a = exactOf(k, map);
  if (a) return { agency: a, how: "known" };
  if (!near.has(k)) near.set(k, nearOf(k, map));
  return near.get(k) ? { agency: near.get(k), how: "near" } : null;
}

/** The standard agency for what someone wrote, or null when the desk cannot place it. */
export function standardOf(raw, list) {
  return placeOf(raw, list)?.agency ?? null;
}

// Addresses that say nothing about where someone works.
const PERSONAL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|rogers|bell|sympatico|shaw|telus|videotron|cogeco|eastlink|sasktel|mts|xplornet|example)\.[a-z.]+$/;
// Domains shared by many departments or agencies: knowing one says nothing about which.
const SHARED = /^((gc|canada|ontario|alberta|quebec|manitoba|novascotia|gnb|gouv\.qc|gov\.[a-z]{2})\.ca|[a-z]{2}\.ca|ca|com|net|org|gov|us|edu)$/;

/** Where someone's work email says they work: its domain, or "" for a personal address. */
export function domainOf(email) {
  const d = String(email ?? "").trim().toLowerCase().split("@")[1] ?? "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && !PERSONAL.test(d) && !SHARED.test(d) ? d : "";
}

/** The agency a work email belongs to: only a domain one agency alone has, matched with any subdomain in front. */
export function byDomain(email, list) {
  let d = domainOf(email);
  if (!d) return null;
  if (!list._domains) {
    const m = new Map(), both = new Set();
    for (const a of list) for (const x of a.domains ?? []) { if (m.has(x) && m.get(x) !== a) both.add(x); else m.set(x, a); }
    for (const x of both) m.delete(x);
    list._domains = m;
  }
  while (d.includes(".") && !SHARED.test(d)) { if (list._domains.has(d)) return list._domains.get(d); d = d.slice(d.indexOf(".") + 1); }
  return null;
}

/** Someone's agency: what they typed, or failing that, their work email. */
export function agencyOf(person, list) {
  return standardOf(person?.organization, list) ?? byDomain(person?.email, list);
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

/** Remember that a spelling means an agency (new to the list if needed), with the work email domains of the people who typed it. */
export async function teach(raw, agencyName, province = "", { domains = [], fr = "", by = "" } = {}) {
  const name = String(agencyName ?? "").trim().slice(0, 160);
  const spelling = String(raw ?? "").trim().slice(0, 160);
  if (!name || !spelling) throw new Error("Which agency?");
  const saved = (await getAgencyList()) ?? [];
  const list = await directory();
  const existing = list.find((a) => a.name.toLowerCase() === name.toLowerCase()) ?? standardOf(name, list);
  const target = existing?.name ?? name;
  const row = saved.find((a) => a.name === target) ?? { name: target, province: existing?.province || (PROVINCES[province] ? province : ""), aliases: [] };
  // Taught again after an Undo: the spelling counts once more.
  row.dropped = (row.dropped ?? []).filter((s) => key(s) !== key(spelling));
  if (key(spelling) !== key(target) && !row.aliases.includes(spelling)) row.aliases.push(spelling);
  if (!existing && PROVINCES[province]) row.province = province;
  if (!existing && by) row.addedBy = by;
  if (fr && !existing?.fr) row.fr = String(fr).trim().slice(0, 160);
  // A domain another agency already has is shared, so it identifies neither.
  const taken = new Set(list.filter((a) => a.name !== target).flatMap((a) => a.domains ?? []));
  const add = [...new Set(domains.map((d) => domainOf(`x@${d}`)).filter((d) => d && !taken.has(d) && !(existing?.domains ?? []).includes(d)))];
  if (add.length) row.domains = [...new Set([...(row.domains ?? []), ...add])];
  await putAgencyList([...saved.filter((a) => a.name !== target), row]);
  return target;
}

/** Take a spelling back off whichever agency has it (Andrew: "Undo"). An agency left with nothing to it goes. */
export async function forget(raw) {
  const k = key(raw);
  const saved = (await getAgencyList()) ?? [];
  const list = await directory();
  const had = list.find((a) => key(a.name) !== k && (a.aliases ?? []).some((s) => key(s) === k));
  if (!had) return null;
  const row = saved.find((a) => a.name === had.name) ?? { name: had.name, province: had.province, aliases: [] };
  row.aliases = (row.aliases ?? []).filter((s) => key(s) !== k);
  if (SEED.some((a) => a.name === had.name && a.aliases.some((s) => key(s) === k))) row.dropped = [...new Set([...(row.dropped ?? []), raw])];
  const seeded = SEED.some((a) => a.name === had.name);
  if (!seeded && !row.aliases.length && row.addedBy === "claude") row.hidden = true;
  await putAgencyList([...saved.filter((a) => a.name !== had.name), row]);
  return had.name;
}

/** Edit an agency: its official name, province, French name, and work email domains (Andrew 30 Oct 2026). */
export async function editAgency(name, { newName, province, fr, domains } = {}) {
  const saved = (await getAgencyList()) ?? [];
  const list = await directory();
  const had = list.find((a) => a.name === name);
  if (!had) throw new Error("No such agency.");
  const to = String(newName ?? "").trim().slice(0, 160) || had.name;
  if (to !== had.name && list.some((a) => a.name.toLowerCase() === to.toLowerCase())) throw new Error(`${to} is already on the list. Merge the two instead.`);
  const row = { ...(saved.find((a) => a.name === had.name) ?? { name: had.name, aliases: [] }) };
  if (province !== undefined) row.province = PROVINCES[province] ? province : "";
  if (fr !== undefined) row.fr = String(fr).trim().slice(0, 160);
  if (domains !== undefined) {
    const want = new Set(domains.map((d) => domainOf(`x@${String(d).replace(/^@/, "")}`)).filter(Boolean));
    row.domains = [...want];
    row.droppedDomains = (had.domains ?? []).filter((d) => !want.has(d));
  }
  let rows = saved.filter((a) => a.name !== had.name);
  if (to === had.name) rows.push(row);
  else rows.push({ ...had, ...row, hidden: true },
    { name: to, province: row.province ?? had.province, fr: row.fr ?? had.fr, aliases: [...new Set([had.name, ...had.aliases])], domains: row.domains ?? had.domains });
  await putAgencyList(rows);
  return to;
}

/** Two agencies that are one (Andrew 30 Oct 2026: "Merge"): the first's name, spellings and domains go to the second. */
export async function mergeAgencies(from, into) {
  const saved = (await getAgencyList()) ?? [];
  const list = await directory();
  const a = list.find((x) => x.name === from), b = list.find((x) => x.name === into);
  if (!a || !b || a === b) throw new Error("Pick two different agencies on the list.");
  const rowB = saved.find((x) => x.name === b.name) ?? { name: b.name, province: b.province, aliases: [] };
  rowB.aliases = [...new Set([...(rowB.aliases ?? []), a.name, ...a.aliases])];
  rowB.domains = [...new Set([...(rowB.domains ?? []), ...(a.domains ?? [])])];
  if (!b.fr && a.fr) rowB.fr = a.fr;
  const rowA = { ...(saved.find((x) => x.name === a.name) ?? { name: a.name, aliases: [] }), hidden: true };
  await putAgencyList([...saved.filter((x) => x.name !== a.name && x.name !== b.name), rowA, rowB]);
  return b.name;
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

/*
 * The desk settles new spellings itself (Andrew 30 Oct 2026: "your suggestions should default to yes so I don't have to
 * click it unless you are wrong"). Each night, and when Andrew presses Check now, every spelling on every event's list
 * that is not on the master list is placed: a misspelling of a known name, a work email domain one agency owns, or
 * Claude's answer, looking the agency up on the web where it needs to. Each one is applied at once and logged with why,
 * for Andrew to correct if it is wrong; only what Claude cannot place at all waits for him. Claude is sent the spelling,
 * how many typed it and the email domains (brampton.ca), never a name or an address.
 */
export const agencyLog = async () => (await getMeta("agencies:log")) ?? [];
export const agencyWaiting = async () => (await getMeta("agencies:waiting")) ?? [];
export const agencyBlank = async () => (await getMeta("agencies:blank")) ?? [];

/** Everyone on every event's list, with the event's title, for counting and matching. */
export async function everyone() {
  const out = [];
  for (const ev of await listEvents()) {
    for (const p of ((await getAttendees(ev.id)) ?? {}).people ?? []) out.push({ ...p, eventTitle: ev.title });
  }
  return out;
}

/** Every spelling across the people given, once each: the commonest way it was typed, how many, which events, which domains. */
export function spellingsOf(people) {
  const out = new Map();
  for (const p of people) {
    if (p.status === "WITHDRAWN") continue;
    const raw = String(p.organization ?? "").trim(), k = key(raw);
    if (!k) continue;
    const g = out.get(k) ?? { key: k, ways: new Map(), count: 0, events: new Set(), domains: new Set() };
    g.ways.set(raw, (g.ways.get(raw) ?? 0) + 1); g.count++;
    if (p.eventTitle) g.events.add(p.eventTitle);
    const d = domainOf(p.email); if (d) g.domains.add(d);
    out.set(k, g);
  }
  return [...out.values()].map((g) => ({ key: g.key, raw: [...g.ways].sort((a, b) => b[1] - a[1])[0][0], count: g.count, events: [...g.events].slice(0, 4), domains: [...g.domains].slice(0, 6) }));
}

const RESOLVE = {
  type: "object", additionalProperties: false, required: ["answers"],
  properties: { answers: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["raw", "agency", "isNew", "province", "fr", "reason", "lookUp"],
    properties: { raw: { type: "string" }, agency: { type: "string" }, isNew: { type: "boolean" }, province: { type: "string" }, fr: { type: "string" },
      reason: { type: "string" }, lookUp: { type: "boolean" } } } } },
};
const RESOLVE_SYSTEM = "You keep ONGIA's master list of agency names. ONGIA trains Canadian police, corrections, border, justice, social service and education staff on gangs and organized crime. People type their agency on a registration form however they like. For each spelling you get what was typed, how many people typed it, and the domains of their work email addresses (personal addresses are left out). Give the agency it means: a name from the master list exactly when it is that agency (units, divisions and detachments don't matter: 'OPP - Gang Unit' is Ontario Provincial Police; an old name of an agency is that agency), or, when it is plainly an agency not on the list, its full official name with isNew set. Use the email domain: a domain that belongs to one agency settles it. Province is the two-letter code for a provincial or municipal agency, empty for a federal, national or foreign one. fr is the agency's official French name when it has one, otherwise empty. reason is one plain sentence for ONGIA's president on why, e.g. 'Their email is @haltonpolice.ca, which is Halton Regional Police Service.' Leave agency empty when there is nothing to go on (e.g. 'Retired' with no work email) or it is not an agency, and say why in reason. Set lookUp when you could tell with a web search but cannot without one; then leave agency empty.";

async function resolveRound(api, batch, list, notes = "") {
  const message = await api.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "low", format: { type: "json_schema", schema: RESOLVE } },
    system: RESOLVE_SYSTEM,
    messages: [{ role: "user", content: `The master list:\n${list.map((a) => a.name).join("\n")}\n\nThe spellings:\n${batch.map((b) =>
      `- "${b.raw}" (typed by ${b.count}${b.domains.length ? `; work email ${b.domains.map((d) => "@" + d).join(", ")}` : "; no work email"})`).join("\n")}${notes ? `\n\nWhat a web search found:\n${notes}` : ""}` }],
  });
  if (message.stop_reason === "refusal") return [];
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try { return JSON.parse(text).answers ?? []; } catch { return []; }
}

/** A web search for the spellings Claude could not place from what it knows: what it found, as plain notes. */
async function lookUp(api, batch) {
  const messages = [{ role: "user", content: `Find out which organization each of these is. People typed them as their employer on a registration form for training on gangs and organized crime in Canada; the email domains are those of their work addresses. For each, say in one or two sentences which organization it is, its official name, its province, and the website you found it on.\n${batch.map((b) =>
    `- "${b.raw}"${b.domains.length ? ` (work email ${b.domains.map((d) => "@" + d).join(", ")})` : ""}`).join("\n")}` }];
  let message;
  // A long search pauses partway: send it back as it stands and the server carries on.
  for (let round = 0; round < 4; round++) {
    message = await api.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }], messages });
    if (message.stop_reason !== "pause_turn") break;
    messages.splice(1, messages.length - 1, { role: "assistant", content: message.content });
  }
  if (message.stop_reason === "refusal") return "";
  return message.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

/** Place every spelling the master list does not know yet. `people` carry eventTitle; `client` is for tests. */
export async function settle(people, { client = null, at = new Date().toISOString() } = {}) {
  const list = await directory();
  const log = await agencyLog(), blank = new Set(await agencyBlank());
  // One that waited and has since been placed (Andrew taught that spelling elsewhere, or merged it) stops waiting.
  const waiting = (await agencyWaiting()).filter((w) => !placeOf(w.raw, list) && !blank.has(key(w.raw)));
  const waitingKeys = new Set(waiting.map((w) => key(w.raw)));
  const out = { known: 0, near: 0, email: 0, claude: 0, waiting: 0, asked: 0 };
  const ask = [];
  const note = (g, agency, by, reason, extra = {}) => log.unshift({ raw: g.raw, agency, by, reason, count: g.count, events: g.events, at, ...extra });
  // Seen by email alone: someone who typed nothing but whose work address one agency owns needs nothing from anyone.
  for (const g of spellingsOf(people)) {
    if (blank.has(g.key) || waitingKeys.has(g.key)) continue;
    const placed = placeOf(g.raw, list);
    if (placed?.how === "known") { out.known++; continue; }
    if (placed?.how === "near") {
      await teach(g.raw, placed.agency.name, "", { domains: g.domains });
      note(g, placed.agency.name, "spelling", `A misspelling of ${placed.agency.name}, which is on the list.`); out.near++; continue;
    }
    const owners = [...new Set(g.domains.map((d) => byDomain(`x@${d}`, list)).filter(Boolean))];
    if (owners.length === 1) {
      await teach(g.raw, owners[0].name, "", { domains: g.domains });
      note(g, owners[0].name, "email", `Their work email is ${g.domains.map((d) => "@" + d).join(", ")}, which is ${owners[0].name}.`); out.email++; continue;
    }
    ask.push(g);
  }
  if (ask.length) {
    if (!client && !anthropicKey()) {
      for (const g of ask) { waiting.unshift({ raw: g.raw, count: g.count, events: g.events, reason: "The desk has no Anthropic API key, so Claude could not look at it.", at }); out.waiting++; }
    } else {
      const api = client ?? new Anthropic({ apiKey: anthropicKey() });
      for (let i = 0; i < Math.min(ask.length, 120); i += 30) {
        const batch = ask.slice(i, i + 30);
        out.asked += batch.length;
        let answers = await resolveRound(api, batch, list).catch(() => []);
        const unsure = batch.filter((g) => answers.find((x) => x.raw === g.raw)?.lookUp);
        if (unsure.length) {
          const notes = await lookUp(api, unsure.slice(0, 10)).catch(() => "");
          if (notes) {
            const again = await resolveRound(api, unsure.slice(0, 10), list, notes).catch(() => []);
            answers = answers.filter((x) => !again.some((y) => y.raw === x.raw)).concat(again.map((y) => ({ ...y, looked: true })));
          }
        }
        for (const g of batch) {
          const m = answers.find((x) => x.raw === g.raw);
          const name = String(m?.agency ?? "").trim();
          if (!name) {
            waiting.unshift({ raw: g.raw, count: g.count, events: g.events, domains: g.domains, reason: m?.reason || "Claude could not place it.", at }); out.waiting++; continue;
          }
          const isNew = !list.some((a) => a.name === name) && !standardOf(name, list);
          const placedAs = await teach(g.raw, name, String(m.province ?? "").toUpperCase(), { domains: g.domains, fr: m.fr, by: isNew ? "claude" : "" });
          note(g, placedAs, "claude", m.reason || "", { isNew, looked: !!m.looked });
          out.claude++;
        }
      }
    }
  }
  await putMeta("agencies:log", log.slice(0, 400));
  await putMeta("agencies:waiting", waiting.slice(0, 400));
  return out;
}
