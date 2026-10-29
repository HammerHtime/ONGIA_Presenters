// A board member's Marriott Bonvoy number, kept on the board roster and put beside their name on the rooming list the
// hotel gets (Andrew 29 Oct 2026: "when I send the rooming list to the hotel, I want to include that board member's
// Marriott or Bonvoy number").
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
delete process.env.RESEND_API_KEY; delete process.env.MS_MAIL_FROM;
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const rooming = (await import(F + "rooming.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (h, url, method = "GET", body, headers = H) => { const r = await h(new Request("http://localhost" + url, { method, headers, body: body ? JSON.stringify(body) : undefined })); const ct = r.headers.get("content-type") ?? ""; return { status: r.status, ...(ct.includes("json") ? await r.json() : { text: await r.text() }) }; };

console.log("— on the board roster");
const before = (await call(roster, "/api/roster")).members;
ok("every member comes back with a Bonvoy box, empty until it's filled in", before.length > 0 && before.every((m) => m.bonvoy === "" || typeof m.bonvoy === "string"));
const raj = before.find((m) => /raj/i.test(m.name)) ?? before[0];
let r = await call(roster, "/api/roster", "PUT", { members: before.map((m) => (m.email === raj.email ? { ...m, bonvoy: " 123 456-789 " } : m)) });
const saved = r.members.find((m) => m.email === raj.email);
ok("a number is saved, the spaces and dashes taken out", r.status === 200 && saved.bonvoy === "123456789", JSON.stringify(saved));
ok("and it stays on the next read", (await call(roster, "/api/roster")).members.find((m) => m.email === raj.email).bonvoy === "123456789");
ok("everyone else's is left alone", r.members.filter((m) => m.email !== raj.email).every((m) => (before.find((b) => b.email === m.email)?.bonvoy ?? "") === m.bonvoy));

console.log("— on the rooming list");
const ev = (await call(events, "/api/events", "POST", { title: "Bonvoy Test", city: "Toronto", dayOne: "2026-11-09", lastDay: "2026-11-12", invite: false,
  board: [{ name: raj.name, email: raj.email, lead: true }] })).event;
r = await call(rooming, `/api/rooming?event=${ev.id}`, "PUT", { guests: [
  { name: raj.name, type: "Board Member", checkIn: "2026-11-08", checkOut: "2026-11-12", billing: "Guest" },
  { name: "Pat Example", type: "ONGIA Guest", checkIn: "2026-11-09", checkOut: "2026-11-11", billing: "ONGIA" }] });
ok("two rooms on the list", r.status === 200 && (r.rows ?? []).length === 2, JSON.stringify(r).slice(0, 200));
const keys = r.rows.map((x) => x.key);
const pv = await call(rooming, `/api/rooming?event=${ev.id}&preview=1`, "POST", { keys });
ok("the email to the hotel gives the board member's Bonvoy number under their name", pv.status === 200 && /Marriott Bonvoy 123456789/.test(pv.html) && pv.html.indexOf("123456789") > pv.html.indexOf(raj.name), pv.html?.slice(0, 200));
ok("someone with no number gets no Bonvoy line", (pv.html.match(/Marriott Bonvoy/g) ?? []).length === 1);
const csv = await call(rooming, `/api/rooming?event=${ev.id}&csv=1&keys=${keys.join(",")}`);
const lines = csv.text.trim().split(/\r?\n/);
ok("the spreadsheet has a Marriott Bonvoy # column, filled in for the board member", /Marriott Bonvoy #/.test(lines[0]) && lines.some((l) => l.includes(raj.name) && l.endsWith("123456789")) && lines.some((l) => l.includes("Pat Example") && l.endsWith(",")), lines.join(" | "));

// Put the roster back as it was.
await call(roster, "/api/roster", "PUT", { members: before });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
