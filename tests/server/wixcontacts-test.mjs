// Reading the Wix contact list (Andrew 1 Nov 2026), in totals only: no names or addresses leave the server.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey"; process.env.WIX_API_KEY = "k"; process.env.WIX_SITE_ID = "11111111-1111-4111-8111-111111111111";
const mk = (i, email, extra = {}) => ({ id: "c" + i, primaryInfo: { email }, info: { name: { first: "Pat" + i, last: "Doe" }, emails: { items: [{ email }] }, ...extra } });
const people = [];
for (let i = 0; i < 1200; i++) people.push(mk(i, `p${i}@${i % 3 === 0 ? "tps.ca" : i % 3 === 1 ? "opp.ca" : "gmail.com"}`, i % 10 === 0 ? { company: "Toronto Police Service", addresses: { items: [{ address: { subdivision: "CA-ON", city: "Toronto", country: "CA" } }] } } : {}));
let pages = 0;
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith("/contacts/v4/contacts/query")) {
    pages++;
    const { offset, limit } = JSON.parse(init.body).query.paging;
    return Response.json({ contacts: people.slice(offset, offset + limit) });
  }
  throw new Error("unexpected fetch " + url);
};
const wix = (await import(REPO + "netlify/functions/wix.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const r = await wix(new Request("http://x/api/wix?contacts=1", { headers: { "x-admin-key": "testkey" } }));
const j = await r.json();
ok("reads every page of contacts (1,200 across two pages)", r.status === 200 && j.total === 1200 && pages === 2, JSON.stringify({ status: r.status, total: j.total, pages }));
ok("counts emails, personal addresses, companies and provinces on file", j.withEmail === 1200 && j.personalEmail === 400 && j.withCompany === 120 && j.withRegion === 120, JSON.stringify(j));
ok("lists the work domains, not personal ones", j.topDomains.some(([d]) => d === "tps.ca") && !j.topDomains.some(([d]) => d === "gmail.com"), JSON.stringify(j.topDomains));
ok("no names or email addresses in the answer", !/Pat\d|p\d+@/.test(JSON.stringify(j)));
const denied = await wix(new Request("http://x/api/wix?contacts=1"));
ok("needs the admin key", denied.status === 401);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
