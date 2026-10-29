// The food-allergy card's "Who shares an address" download (Andrew 29 Oct 2026: "tell me how many emails are duplicated").
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const { readXlsx } = await import(REPO + "netlify/functions/lib/xlsx.mjs");
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const shift = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Addresses ${T}`, city: "Toronto, ON", venue: "Hall", dayOne: shift(14), lastDay: shift(14), invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }],
  presenters: [{ first: "Jordan", last: "Avery", email: `jordan.${T}@example.ca`, organization: "Sample Police" }, { first: "Casey", last: "Morgan", email: `casey.${T}@example.ca`, organization: "Sample Police" }] }) })).event;
await fetch(`${S}/api/attendees?event=${ev.id}&csv=1`, { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "text/csv" },
  body: `First Name,Last Name,Email,Guest Status\nAri,Lane,ari.${T}@example.ca,Attending\n` });
await api(`/api/reply?event=${ev.id}`, { method: "PUT", body: "{}" });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  const sending = tag === "phone";   // the phone round presses the button (the wide one leaves it for the phone)
  const p = await b.newPage({ viewport: { width: w, height: h }, acceptDownloads: true });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  // A list with shared addresses comes from Wix (a CSV keeps one row per address), so the card's counts are those of a
  // Summit-like list here; what goes in the spreadsheet is checked against real rows in tests/server/addresses-test.mjs.
  await p.route(/\/api\/reply\?event=[^&]+$/, async (route) => { const r = await route.fetch(); const j = await r.json();
    if (j.status) Object.assign(j.status, { registrations: 403, reaches: 380, noEmail: 4 });
    return route.fulfill({ response: r, body: JSON.stringify(j) }); });
  await p.goto(`${S}/admin.html#event/${ev.id}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  await p.locator('.etab[data-tab="communications"]').click(); await p.waitForTimeout(1200);
  ok(`${tag}: the card says how the registrations reach fewer addresses`, /403 registrations go to 380 email addresses: 19 share an email address with someone else on the list[\s\S]*4 have no email address/.test(await p.locator("#replybox").innerText()));
  const btn = p.locator('[data-rpsheet="addresses"]');
  ok(`${tag}: with a button for the list`, await btn.isVisible());
  const [d] = await Promise.all([p.waitForEvent("download"), btn.click()]);
  const chunks = []; for await (const c of await d.createReadStream()) chunks.push(c);
  const flat = readXlsx(Buffer.concat(chunks)).map((r) => r.join(" | ")).join("\n");
  ok(`${tag}: it downloads the spreadsheet, with its totals`, /shared-addresses\.xlsx$/.test(d.suggestedFilename()) && /Email address/.test(flat) && /1 registration coming goes to 1 email address\./.test(flat), flat);
  // The presenters (Andrew 29 Oct 2026: "Add a button send presenters as well").
  const pres = p.locator(".rppres");
  ok(`${tag}: the card has a Presenters part, saying the email above doesn't reach them`, /Presenters[\s\S]*aren't on the Wix guest list[\s\S]*2 presenters haven't had it yet/.test(await pres.innerText()), await pres.innerText().catch(() => "none"));
  ok(`${tag}: with a button: Send to 2 presenters`, (await p.locator("#rp-presenters").innerText()).trim() === "Send to 2 presenters");
  await pres.screenshot({ path: new URL(".", import.meta.url).pathname + `reply-presenters-${tag}.png` });
  if (sending) {
    p.on("dialog", (d) => d.accept());
    await p.locator("#rp-presenters").click();
    // The card says it's sending, then looks again every 10 seconds until the server run is done.
    await p.waitForFunction(() => /could not be sent/.test(document.querySelector(".rppres")?.innerText ?? ""), null, { timeout: 30000 }).catch(() => {});
    // Locally there's no mailbox, so the sends are recorded as not sent: the card says so, and offers them again.
    ok(`${tag}: pressing it sends on the server, and the card says how it went`, /could not be sent/.test(await p.locator(".rppres").innerText()) && await p.locator("#rp-presenters").isVisible(), await p.locator(".rppres").innerText());
  }
  ok(`${tag}: no page errors`, !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
