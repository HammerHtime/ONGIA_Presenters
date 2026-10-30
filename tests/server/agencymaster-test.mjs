// The agencies master list under Admin (Andrew 30 Oct 2026): misspellings and work email domains placed on their own,
// Claude's answer applied at once ("your suggestions should default to yes so I don't have to click it unless you are
// wrong"), looking agencies up on the web when it needs to, and only what nobody can place waiting for Andrew.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
delete process.env.ANTHROPIC_API_KEY;
const F = REPO + "netlify/functions/";
const { putEvent, putAttendees, putAgencyList, putMeta } = await import(F + "lib/store.mjs");
const A = await import(F + "lib/agencies.mjs");
const agencies = (await import(F + "agencies.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, body) => {
  const r = await agencies(new Request(`http://x/api/agencies?${qs}`, { method: body ? "POST" : "GET", headers: H, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() };
};
await putAgencyList([]);
for (const k of ["agencies:log", "agencies:waiting", "agencies:blank"]) await putMeta(k, []);

// Matching on its own.
let list = await A.directory();
ok("a misspelling of a known agency is placed: Toronto Polcie Service", A.placeOf("Toronto Polcie Service", list)?.agency.name === "Toronto Police Service" && A.placeOf("Toronto Polcie Service", list).how === "near");
ok("short names are never guessed at: OPS stays the Ottawa Police, not the OPP", A.standardOf("OPS", list)?.name === "Ottawa Police Service");
ok("and a short typo is not stretched to fit: 'OPPP' is not placed", A.standardOf("OPPP", list) === null);
ok("a work email one agency owns places someone who typed nothing", A.agencyOf({ organization: "", email: "j.doe@ops.rcmp-grc.gc.ca" }, list)?.name === "Royal Canadian Mounted Police");
ok("a personal or shared address says nothing", A.domainOf("a@gmail.com") === "" && A.domainOf("a@ontario.ca") === "" && A.domainOf("a@canada.ca") === "" && A.domainOf("a@brampton.ca") === "brampton.ca");
ok("the master list carries French names", list.find((a) => a.name === "Royal Canadian Mounted Police")?.fr === "Gendarmerie royale du Canada");

// Every event's people, matched by the nightly step. Claude is stubbed: what it is sent is recorded.
await putEvent({ id: "ngs", title: "National Gang Summit", city: "Toronto", dayOne: "2027-05-04", board: [] });
await putEvent({ id: "sym", title: "Ontario Symposium", city: "Toronto", dayOne: "2027-11-02", board: [] });
const person = (organization, email, i) => ({ key: `k${i}`, first: "Pat", last: `Person${i}`, email, status: "ATTENDING", organization });
await putAttendees("ngs", { people: [person("Toronto Polcie Service", "a@torontopolice.on.ca", 1), person("Toronto Polcie Service", "b@torontopolice.on.ca", 2),
  person("Brampton Division", "c@peelpolice.ca", 3), person("Bylaw - Brampton", "d@brampton.ca", 4), person("TPS", "e@torontopolice.on.ca", 5)] });
await putAttendees("sym", { people: [person("Retired", "f@gmail.com", 6), person("MCSCS", "g@ontario.ca", 7)] });

const sent = [];
const client = { messages: { create: async (req) => {
  sent.push(req);
  const asked = JSON.stringify(req.messages);
  if (req.tools) {   // the web search: pauses once, then answers
    if (!req.messages.some((m) => m.role === "assistant")) return { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Bylaw Brampton" } }] };
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Bylaw - Brampton is the City of Brampton's Enforcement and By-law Services department (brampton.ca)." }] };
  }
  const notes = asked.includes("What a web search found");
  const answers = [];
  if (asked.includes("MCSCS")) answers.push({ raw: "MCSCS", agency: "Ministry of the Solicitor General (Ontario)", isNew: false, province: "ON", fr: "", reason: "MCSCS was renamed the Ministry of the Solicitor General in 2019.", lookUp: false });
  if (asked.includes("Retired")) answers.push({ raw: "Retired", agency: "", isNew: false, province: "", fr: "", reason: "Retired is not an agency and the email is personal.", lookUp: false });
  if (asked.includes("Bylaw - Brampton")) answers.push(notes
    ? { raw: "Bylaw - Brampton", agency: "City of Brampton – Enforcement and By-law Services", isNew: true, province: "ON", fr: "", reason: "Their email is @brampton.ca and the city's website lists the department.", lookUp: false }
    : { raw: "Bylaw - Brampton", agency: "", isNew: false, province: "", fr: "", reason: "Needs a search.", lookUp: true });
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ answers }) }] };
} } };
const out = await A.settle(await A.everyone(), { client });
ok("a misspelling and a work email are placed without Claude", out.near === 1 && out.email === 1, JSON.stringify(out));
ok("Claude places the rest, searching the web for the one it could not tell, and resuming the paused search", out.claude === 2 && sent.filter((r) => r.tools).length === 2, JSON.stringify(out));
ok("only what nobody can place waits for Andrew", out.waiting === 1, JSON.stringify(out));
const everything = JSON.stringify(sent);
ok("Claude is sent spellings and work email domains, never a name or an address", !/Person\d|[a-z]@(torontopolice|brampton|peelpolice|gmail|ontario)/.test(everything) && everything.includes("@brampton.ca"), everything.slice(0, 400));
ok("a personal or shared domain is not sent as a work email", !everything.includes("@gmail.com") && !everything.includes("@ontario.ca"));

list = await A.directory();
const brampton = list.find((a) => a.name === "City of Brampton – Enforcement and By-law Services");
ok("a new agency joins the list with its province and the domain it was found by", brampton?.province === "ON" && brampton.domains.includes("brampton.ca"), JSON.stringify(brampton));
ok("the misspelling is now on the list for good", A.placeOf("Toronto Polcie Service", list)?.how === "known");
ok("a shared domain is never learned: MCSCS matched, @ontario.ca not kept", !list.find((a) => a.name === "Ministry of the Solicitor General (Ontario)").domains.includes("ontario.ca"));
ok("the next person from @brampton.ca is placed by their email alone", A.agencyOf({ organization: "City Hall", email: "z@brampton.ca" }, list)?.name === brampton.name);
const again = await A.settle(await A.everyone(), { client });
ok("a second run asks nothing again", again.claude === 0 && again.waiting === 0 && again.asked === 0, JSON.stringify(again));

// The Admin page.
let M = (await call("master=1")).body;
ok("the page lists what the desk matched, newest first, with why", M.matched.length === 4 && M.matched.some((m) => m.by === "claude" && /2019/.test(m.reason)) && M.matched.some((m) => m.by === "email" && /@peelpolice\.ca/.test(m.reason)), JSON.stringify(M.matched.map((m) => [m.raw, m.by])));
ok("and what waits, with Claude's reason", M.waiting.length === 1 && M.waiting[0].raw === "Retired" && /personal/.test(M.waiting[0].reason));
ok("each agency shows how many people it has across events", M.agencies.find((a) => a.name === "Toronto Police Service")?.people === 3, JSON.stringify(M.agencies.find((a) => a.name === "Toronto Police Service")));
ok("the badge counts what waits", (await call("count=1")).body.waiting === 1);

M = (await call("master=1&fix=1", { raw: "Brampton Division", agency: "City of Brampton – Enforcement and By-law Services" })).body;
list = await A.directory();
ok("a wrong match corrected: the spelling moves to the right agency", A.standardOf("Brampton Division", list)?.name === brampton.name && M.matched.find((m) => m.raw === "Brampton Division")?.by === "you");
M = (await call("master=1&undo=1", { raw: "MCSCS" })).body;
list = await A.directory();
ok("Undo takes the spelling back off and it waits for Andrew instead", A.standardOf("MCSCS", list) === null && M.waiting.some((w) => w.raw === "MCSCS") && !M.matched.some((m) => m.raw === "MCSCS"));
M = (await call("master=1&blank=1", { raw: "Retired" })).body;
ok("Leave blank: it stops waiting", !M.waiting.some((w) => w.raw === "Retired") && (await call("count=1")).body.waiting === 1);
const third = await A.settle(await A.everyone(), { client });
ok("and is never asked about again", !JSON.stringify(sent.slice(-3)).includes('\\"Retired\\"') || third.asked === 0, JSON.stringify(third));
M = (await call("master=1&clear=1", {})).body;
ok("Looks right, clear the list", M.matched.length === 0);

M = (await call("master=1&edit=1", { name: "Peel Regional Police", fr: "Police régionale de Peel", domains: ["peelpolice.ca", "@peelregion.ca"] })).body;
let peel = M.agencies.find((a) => a.name === "Peel Regional Police");
ok("an agency's French name and email domains can be edited", peel.fr === "Police régionale de Peel" && peel.domains.includes("peelregion.ca"), JSON.stringify(peel));
M = (await call("master=1&edit=1", { name: "Peel Regional Police", newName: "Peel Regional Police Service" })).body;
list = await A.directory();
ok("renamed: the old name becomes a spelling of the new one, nothing lost", A.standardOf("Peel Regional Police", list)?.name === "Peel Regional Police Service" && A.standardOf("PRP", list)?.name === "Peel Regional Police Service" && !list.some((a) => a.name === "Peel Regional Police"));
M = (await call("master=1&add=1", { name: "York Police Association", province: "ON" })).body;
M = (await call("master=1&merge=1", { from: "York Police Association", into: "York Regional Police" })).body;
list = await A.directory();
ok("merged: one agency, the other's name now a spelling of it", !list.some((a) => a.name === "York Police Association") && A.standardOf("York Police Association", list)?.name === "York Regional Police");
ok("adding one already on the list is refused", (await call("master=1&add=1", { name: "toronto police service" })).status === 400);

const csv = (await call("master=1&download=1")).body;
ok("the master list downloads as a spreadsheet, French names and domains included", /^\ufeff?Agency,Province,French name,Work email domains,Also typed as/.test(csv) && csv.includes('"Gendarmerie royale du Canada"') && csv.includes("brampton.ca"), csv.slice(0, 200));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
