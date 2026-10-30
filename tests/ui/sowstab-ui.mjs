// The RBH SOWs tab (Andrew 29 Oct 2026, from the mock-up he approved): every RBH statement of work listed, a summary of
// them all on the right, and each one opened right there in the event's own editor, fully editable, so a change made here
// is the change on the event and the other way round.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const money = (t) => Number(String(t).replace(/[^0-9.\-]/g, ""));
await api("/api/roster");
const T = Date.now().toString(36);
const shift = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const mk = async (title, d, extra = {}) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Montreal, QC", venue: "Hotel", dayOne: shift(d), lastDay: shift(d + 2), invite: false, kind: "rbh", province: "QC", invoicePrefix: "TAB",
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], ...extra }) })).event;
const vip = await mk(`RBH VIP Tab ${T}`, 40), itp = await mk(`RBH ITP Tab ${T}`, 70), bare = await mk(`RBH ITP Bare ${T}`, 90);
for (const [ev, base] of [[vip, 1000], [itp, 3000]]) {
  const s = await api(`/api/sow?event=${ev.id}&create=1`, { method: "POST", body: JSON.stringify({ from: "standard" }) });
  await api(`/api/sow?event=${ev.id}`, { method: "PUT", body: JSON.stringify({ lines: s.sow.lines.map((l, i) => ({ ...l, estimate: base + i * 100 })), taxes: s.sow.taxes, taxBase: "subtotal+fee", deposit: 0, internal: [{ name: "Stipends", planned: 500 }] }) });
}

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[390, 844, "phone"], [1440, 1000, "wide"]]) {   // the phone first: the wide run changes things
  const all = (await api("/api/sow?all=1")).events;
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); localStorage.removeItem("ongia-sows-scope"); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  const more = async () => { if (!(await p.locator("#sowsnav").isVisible()) && await p.locator("#snmore").isVisible()) { await p.locator("#snmore").click(); await p.waitForTimeout(300); } };   // on a phone it's under More
  await more();
  ok(`${tag}: the sidebar (on a phone, More) has an RBH SOWs button`, await p.locator("#sowsnav").isVisible());
  await p.locator("#sowsnav").click(); await p.waitForTimeout(1500);
  const row = (id) => p.locator(`[data-sowrow="${id}"]`);
  ok(`${tag}: each RBH event is a row, the one with no statement of work too, with Start it`, await row(vip.id).count() && await row(itp.id).count() && /No SOW yet/i.test(await row(bare.id).innerText()) && /Start it/.test(await row(bare.id).innerText()));
  const v = all.find((e) => e.id === vip.id);
  ok(`${tag}: a row shows the event's SOW total and profit planned`, (await row(vip.id).innerText()).includes(`$${v.estimate.total.toLocaleString("en-CA", { minimumFractionDigits: 2 })}`) && (await row(vip.id).innerText()).includes(`$${v.estimate.profit.toLocaleString("en-CA", { minimumFractionDigits: 2 })}`), await row(vip.id).innerText());
  // The summary adds up every upcoming one (others from earlier test runs are in it too, so compare with the server's own).
  const upcoming = all.filter((e) => e.sow && (e.lastDay || e.dayOne) >= new Date().toISOString().slice(0, 10));
  const want = Math.round(upcoming.reduce((n, e) => n + e.estimate.profit, 0) * 100) / 100;
  const got = money(await p.locator("#sowsum-profit").innerText());
  ok(`${tag}: the summary's profit planned is every upcoming SOW's added up`, Math.abs(got - want) < 0.01, `${got} vs ${want}`);
  ok(`${tag}: the summary says what RBH is asked for, internal costs, profit and so far`, /Expenses at cost[\s\S]*Fixed fees[\s\S]*service fee[\s\S]*Total with tax[\s\S]*Stipends and other internal costs[\s\S]*Profit planned[\s\S]*Invoiced so far/i.test(await p.locator("#sowsum").innerText()));
  await p.screenshot({ path: D + `sows-${tag}.png` });

  if (tag === "wide") {
    // Open one: the event's own editor, fully editable. A change here is on the event.
    await row(vip.id).locator("[data-sowopen]").click(); await p.waitForTimeout(2000);
    ok(`${tag}: Open shows the event's statement of work right there, its whole editor`, await p.locator("#sowedit #sw-table").isVisible() && await p.locator("#sowedit #sw-add").isVisible() && await p.locator("#sowedit #sw-status").isVisible());
    const before = money(await p.locator("#sowsum-profit").innerText());
    await p.locator("#sowedit .ln-name").first().fill(`Hotel renamed ${T}`);
    await p.locator("#sowedit .ln-est").last().fill("9999"); await p.waitForTimeout(300);
    const during = money(await p.locator("#sowsum-profit").innerText());
    ok(`${tag}: the summary and the row follow what's typed, before it's saved`, during !== before && money(await row(vip.id).locator('[data-k="profit"]').innerText()) !== v.estimate.profit, `${before} → ${during}`);
    await p.waitForTimeout(2600);
    const onEvent = (await api(`/api/sow?event=${vip.id}`)).sow;
    ok(`${tag}: it saved as typed, to the event's own SOW: the renamed line and the new estimate`, onEvent.lines[0].name === `Hotel renamed ${T}` && onEvent.lines.at(-1).estimate === 9999, JSON.stringify(onEvent.lines.map((l) => [l.name, l.estimate])));
    await p.locator("#sowedit #sw-add").click(); await p.waitForTimeout(400);
    await p.locator("#sowedit .ln-name").last().fill(`Parking ${T}`); await p.waitForTimeout(2600);
    ok(`${tag}: a line added here is on the event`, (await api(`/api/sow?event=${vip.id}`)).sow.lines.some((l) => l.name === `Parking ${T}`));
    await p.locator("#sowedit").screenshot({ path: D + "sows-open-wide.png" });
    // And the other way: changed on the event, it shows here.
    const s2 = (await api(`/api/sow?event=${itp.id}`)).sow;
    await api(`/api/sow?event=${itp.id}`, { method: "PUT", body: JSON.stringify({ lines: s2.lines.map((l, i) => (i ? l : { ...l, estimate: 12345 })), taxes: s2.taxes, internal: s2.internal }) });
    await p.locator("#back").click(); await p.waitForTimeout(800); await more(); await p.locator("#sowsnav").click(); await p.waitForTimeout(1500);
    const fresh = (await api("/api/sow?all=1")).events.find((e) => e.id === itp.id);
    ok(`${tag}: a change made on the event shows in the list`, (await row(itp.id).innerText()).includes(`$${fresh.estimate.total.toLocaleString("en-CA", { minimumFractionDigits: 2 })}`), await row(itp.id).innerText());
    // Start it, for the event that has none.
    await row(bare.id).locator("[data-sowopen]").click(); await p.waitForTimeout(1500);
    // An ITP starts from the previous ITP's lines (Andrew 29 Oct 2026).
    const lastItp = (await api(`/api/sow?event=${bare.id}`)).copyFrom.find((c) => c.family === "itp")?.id;
    ok(`${tag}: starting an ITP's statement of work offers the last ITP's lines, already chosen`, !!lastItp && (await p.locator('#sowedit input[name="sw-from"]:checked').getAttribute("value")) === lastItp && /latest ITP training/i.test(await p.locator("#sowedit").innerText()), `${lastItp} vs ${await p.locator('#sowedit input[name="sw-from"]:checked').getAttribute("value")} | ${await p.locator('#sowedit input[name="sw-from"]').evaluateAll((e) => e.map((x) => x.value + (x.checked ? "*" : "")).join(","))}`);
    await p.locator("#sowedit #sw-start").click(); await p.waitForTimeout(2000);
    ok(`${tag}: and it comes with that ITP's lines`, (await api(`/api/sow?event=${bare.id}`)).sow?.copiedFrom === lastItp);
    ok(`${tag}: Start it starts that event's statement of work from here`, !!(await api(`/api/sow?event=${bare.id}`)).sow && await p.locator("#sowedit #sw-table").isVisible());
    // Expected for the year: one invoiced above its SOW counts at its final invoice; the rest stay at their SOWs.
    const s3 = (await api(`/api/sow?event=${itp.id}`)).sow;
    for (const st of ["submitted", "approved"]) await api(`/api/sow?event=${itp.id}&status=${st}`, { method: "PUT", body: "{}" });
    await api(`/api/sow?event=${itp.id}`, { method: "PUT", body: JSON.stringify({ lines: s3.lines.map((l) => ({ ...l, actual: l.type === "fixed" ? l.estimate + 1000 : l.estimate })), taxes: s3.taxes, internal: s3.internal }) });
    await api(`/api/sow?event=${itp.id}&status=invoiced`, { method: "PUT", body: "{}" });
    await p.locator("#back").click(); await p.waitForTimeout(800); await more(); await p.locator("#sowsnav").click(); await p.waitForTimeout(1500);
    const now = (await api("/api/sow?all=1")).events.filter((e) => e.sow && (e.lastDay || e.dayOne) >= new Date().toISOString().slice(0, 10));
    const expect = Math.round(now.reduce((n, e) => n + (e.invoiced ? e.actual.profit : e.estimate.profit), 0) * 100) / 100;
    const planned = Math.round(now.reduce((n, e) => n + e.estimate.profit, 0) * 100) / 100;
    const sum = await p.locator("#sowsum").innerText();
    const xp = money(/Expected profit\s*(\S+)/.exec(sum)?.[1]);
    ok(`${tag}: Expected profit counts the invoiced one at its final invoice and the others at their SOWs`, Math.abs(xp - expect) < 0.01 && expect > planned && money(await p.locator("#sowsum-profit").innerText()) === planned, `${xp} vs ${expect} (planned ${planned})`);
    ok(`${tag}: it says how many are on their final invoice and how far that moved it`, /\d+ of \d+ on (its|their) final invoice/.test(sum) && /Against the SOWs\s*\+\$/.test(sum), sum);
    await p.locator("#sowsum").screenshot({ path: D + "sows-expected.png" });
    // Print all: one PDF of everything listed.
    const pdfReq = p.waitForRequest((r) => /\/api\/sow\?all=1&doc=sow&ids=/.test(r.url()), { timeout: 5000 }).catch(() => null);
    await p.locator("#sowsall").click();
    const req = await pdfReq;
    ok(`${tag}: Print all SOWs asks for one PDF of every one listed`, !!req && req.url().includes(vip.id) && req.url().includes(itp.id), req?.url());
    await p.locator("[data-sowevent]").first().click(); await p.waitForTimeout(1500);
    ok(`${tag}: Event → opens the event`, await p.locator(".etabs").count() > 0);
  } else {
    await row(vip.id).locator("[data-sowopen]").click(); await p.waitForTimeout(2000);
    await p.locator("#sowedit").screenshot({ path: D + "sows-open-phone.png" });
    ok(`${tag}: opened on a phone, the editor fits`, await p.locator("#sowedit #sw-table").isVisible() && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  ok(`${tag}: fits the screen, no page errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !errs.length, errs.join(" | "));
  await p.close();
}
// The lead of an event never sees it.
{
  const p = await b.newPage();
  const token = issueSession({ email: "treasurer@ongia.ca", name: "Raj Jaswal" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "treasurer@ongia.ca", name: "Raj Jaswal" }]);
  await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  ok("a board member who isn't the president or VP has no RBH SOWs button", !(await p.locator("#sowsnav").count()));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
