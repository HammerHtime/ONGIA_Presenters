// The People tab (redesign step 3): presenters as a table with the next job's button on each row, a panel with
// everything about one presenter (a sheet from the bottom on a phone), tick boxes to email several at once, a find box,
// and a switch to the volunteers and who's coming. Phone and desktop.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const shift = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const NAMES = [["Rev", "Iewer"], ["Ada", "Sample"], ["Bo", "Example"], ["Cy", "Placeholder"], ["Di", "Demo"], ["Ed", "Testcase"], ["Flo", "Mockup"], ["Gus", "Fakename"]];
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `People Summit ${T}`, city: "Toronto", venue: "Hall", dayOne: shift(120), lastDay: shift(121), invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }],
  presenters: NAMES.map(([f, l]) => ({ first: f, last: l, email: `${f.toLowerCase()}.${l.toLowerCase()}.${T}@example.ca`, organization: `${l} Agency` })) }) })).event;
const P = (await api(`/api/events?id=${ev.id}`)).presenters;
const rev = P.find((p) => p.first === "Rev");
await fetch(`${S}/api/agreement?t=${rev.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ first: "Rev", last: "Iewer", email: rev.email, phone: "4165550100", organization: "Iewer Agency", talk: "Street gangs and social media", bio: "word ".repeat(40), outline: "O", travel: "no", hotel: "no", expenses: { transport: "no", meals: "no", other: "no", otherText: "" }, copyright: true, noInvestigation: true, termsAccepted: true, media: { photo: { internal: "yes", public: "yes" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: "yes" }, bio: { internal: "yes", public: "yes" } }, sensitive: "no", signature: "Rev Iewer", agreed: true, language: "en" }) });

// Who's coming: ten made-up people from a spreadsheet, two of them on the waitlist and one not coming.
const csv = "First,Last,Email,Organization,Status\n" + Array.from({ length: 10 }, (_, i) => `Guest${i},Sample${i},guest${i}.${T}@example.ca,Agency ${i},${i < 2 ? "waitlist" : i === 2 ? "not attending" : "yes"}`).join("\n");
await fetch(`${S}/api/attendees?event=${ev.id}&csv=1`, { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "text/csv" }, body: csv });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  console.log(`— ${tag}`);
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 500 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => {
    try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {}
    window.__copied = null; Object.defineProperty(navigator, "clipboard", { value: { writeText: async (x) => { window.__copied = x; } } });
  }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  let asked = ""; p.on("dialog", (d) => { asked = d.message(); d.accept(); });
  // Emails are not sent here: catch the invite and answer as the server would.
  let invited = null;
  await p.route("**/api/invite**", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    if (body.presenterIds && !route.request().url().includes("called")) invited = body;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, sent: (body.presenterIds ?? []).map((id) => ({ id, name: id })), failed: [] }) });
  });
  await p.goto(`${S}/admin.html#event/${ev.id}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  await p.locator('[data-tab="people"]').click(); await p.waitForTimeout(300);
  const seg = await p.locator(`.etabp[data-panel="people"] .pseg[aria-label="Who"]`).innerText();
  ok(`${tag}: People switches between presenters, volunteers and who's coming`, /Presenters\s*8/.test(seg) && /Volunteers/.test(seg) && /Who's coming/.test(seg), seg);
  ok(`${tag}: a row for each presenter`, (await p.locator("tr.prow").count()) === 8);
  const revRow = p.locator("tr.prow", { hasText: "Rev Iewer" });
  ok(`${tag}: the presenter who signed has Review as the next job`, (await revRow.locator("[data-review]").count()) === 1 && /needs review/i.test(await revRow.innerText()));
  const chips = await p.locator('[data-filter]').allInnerTexts();
  ok(`${tag}: the cuts are Needs me, Waiting on them, Signed and All, with counts`, chips.some((c) => /Needs me\s*\d/.test(c)) && chips.some((c) => /Waiting on them/.test(c)) && chips.some((c) => /Signed\s*0/.test(c)) && chips.some((c) => /All\s*8/.test(c)), chips.join(" | "));
  await p.locator('[data-filter="needs"]').click(); await p.waitForTimeout(300);
  ok(`${tag}: Needs me keeps the presenter to review`, (await p.locator("tr.prow", { hasText: "Rev Iewer" }).count()) === 1);
  await p.locator('[data-filter="all"]').click(); await p.waitForTimeout(300);
  await p.fill("#pfind", "placeh"); await p.waitForTimeout(150);
  ok(`${tag}: the find box narrows the list as you type`, (await p.locator("tr.prow:not([hidden])").count()) === 1 && /Cy Placeholder/.test(await p.locator("tr.prow:not([hidden])").innerText()));
  await p.fill("#pfind", ""); await p.waitForTimeout(150);
  ok(`${tag}: and clearing it brings everyone back`, (await p.locator("tr.prow:not([hidden])").count()) === 8);

  // One presenter's panel. Opening and closing it leaves the rest of the page as it is (no full redraw).
  await p.evaluate(() => { document.querySelector(".ptable").dataset.kept = "1"; });
  let calls = 0; const count = (r) => { if (/\/api\/events/.test(r.url())) calls++; }; p.on("request", count);
  await p.locator("tr.prow", { hasText: "Rev Iewer" }).locator(".pn").click(); await p.waitForTimeout(500);
  const dr = p.locator("#pdrawer");
  ok(`${tag}: the panel opens without redrawing the page or reloading the event`, (await p.locator('.ptable[data-kept="1"]').count()) === 1 && calls === 0 && (await p.locator("tr.prow.open", { hasText: "Rev Iewer" }).count()) === 1, `calls=${calls}`);
  ok(`${tag}: clicking a row opens everything about that presenter`, await dr.isVisible() && /Rev Iewer/.test(await dr.innerText()) && /Street gangs and social media/.test(await dr.innerText()));
  ok(`${tag}: the panel lists the steps, with the board review waiting on you`, (await dr.locator(".ptl li").count()) === 7 && /Approved: waiting on you/.test(await dr.innerText()), await dr.locator(".ptl").innerText());
  ok(`${tag}: and the buttons: Review, Copy link, Correct or remove, Mark received`, (await dr.locator("[data-review]").count()) === 1 && (await dr.locator("[data-copy]").count()) === 1 && (await dr.locator("[data-edit]").count()) === 1 && (await dr.locator("[data-mat]").count()) === 2);
  ok(`${tag}: the open presenter is in the address`, decodeURIComponent(p.url()).includes(`"person":"${rev.id}"`), decodeURIComponent(p.url()));
  if (tag === "phone") ok(`${tag}: on a phone it is a sheet from the bottom`, (await dr.evaluate((e) => getComputedStyle(e).position)) === "fixed");
  await p.screenshot({ path: `${D}people-drawer-${tag}.png` });
  await dr.locator('[data-mat][data-key="final"]').click(); await p.waitForTimeout(900);
  ok(`${tag}: Mark received ticks the final material, and the row's chip turns done`, /Clear/.test(await p.locator('#pdrawer [data-mat][data-key="final"]').innerText()) && (await p.locator("tr.prow", { hasText: "Rev Iewer" }).locator('.mchip.done[data-key="final"]').count()) === 1);
  await p.locator('#pdrawer [data-mat][data-key="final"]').click(); await p.waitForTimeout(900);
  await p.locator("#pdrawer .pclose").click(); await p.waitForTimeout(400);
  ok(`${tag}: × closes it`, (await p.locator("#pdrawer").count()) === 0 && (await p.locator("tr.prow.open").count()) === 0);
  await p.evaluate(() => { document.querySelector(".ptable").dataset.kept = "1"; });   // Mark received saves and redraws; mark the table again
  calls = 0; await p.locator("tr.prow", { hasText: "Cy Placeholder" }).locator(".pn").click(); await p.waitForTimeout(400);
  await p.locator("#pdrawer .pclose").click(); await p.waitForTimeout(300);
  ok(`${tag}: opening and closing another presenter still reloads nothing`, calls === 0 && (await p.locator('.ptable[data-kept="1"]').count()) === 1, `calls=${calls}`);
  p.off("request", count);

  // Several at once.
  await p.locator("tr.prow", { hasText: "Ada Sample" }).locator("[data-psel]").check();
  await p.locator("tr.prow", { hasText: "Bo Example" }).locator("[data-psel]").check();
  ok(`${tag}: ticking two shows the bar with the count`, await p.locator("#pbulk").isVisible() && /2 selected/.test(await p.locator("#pbulk").innerText()));
  await p.locator("#pbulk-copy").click(); await p.waitForTimeout(200);
  const copied = await p.evaluate(() => window.__copied);
  ok(`${tag}: Copy email addresses copies both, ready for Outlook`, /ada\.sample/.test(copied ?? "") && /bo\.example/.test(copied ?? "") && /; /.test(copied ?? ""), copied);
  await p.locator("#pbulk-mail").click(); await p.waitForTimeout(1500);
  ok(`${tag}: Email their link asks first, then sends to just those two`, /Email their agreement link to 2 presenters/.test(asked) && invited?.presenterIds?.length === 2, JSON.stringify(invited));
  invited = null;
  await p.locator('[data-tab="people"]').click().catch(() => {}); await p.waitForTimeout(200);
  ok(`${tag}: after sending, nothing is left ticked`, (await p.locator("[data-psel]:checked").count()) === 0 && !(await p.locator("#pbulk").isVisible()));
  if (tag === "wide") {
  await p.locator("#pselall").check(); await p.waitForTimeout(200);
  ok(`${tag}: the box at the top ticks everyone shown`, /8 selected/.test(await p.locator("#pbulk").innerText()));
  await p.locator("#pbulk-mail").click(); await p.waitForTimeout(1500);
  ok(`${tag}: and someone who already signed is left out of the email`, /7 presenters/.test(asked) && /1 who already signed will be left out/.test(asked) && invited?.presenterIds?.length === 7 && !invited.presenterIds.includes(rev.id), asked);
  }

  await p.locator('[data-tab="people"]').click().catch(() => {}); await p.waitForTimeout(200);
  await p.locator('[data-pseg="volunteers"]').click(); await p.waitForTimeout(200);
  ok(`${tag}: Volunteers swaps the list for the volunteers`, await p.locator('details[data-fold="sec-volunteers"]').isVisible() && !(await p.locator('details[data-fold="sec-presenters"]').isVisible()));
  await p.locator('[data-pseg="guests"]').click(); await p.waitForTimeout(200);
  ok(`${tag}: Who's coming shows the attendee list`, await p.locator('.pview:not([hidden]) details[data-fold="sec-guests"]').isVisible());
  const gshown = () => p.locator("tr.grow:not([hidden])").count();
  ok(`${tag}: as a table, showing the 7 coming to start with`, (await p.locator("table.gtable").count()) === 1 && (await gshown()) === 7, String(await gshown()));
  ok(`${tag}: with cuts for coming, waitlist, not coming and all, with counts`, /Coming\s*7/.test(await p.locator("[data-gcutbtn]").allInnerTexts().then((x) => x.join("|"))) && /Waitlist\s*2/.test(await p.locator("[data-gcutbtn]").allInnerTexts().then((x) => x.join("|"))), await p.locator("[data-gcutbtn]").allInnerTexts().then((x) => x.join("|")));
  await p.locator('[data-gcutbtn="waitlist"]').click(); await p.waitForTimeout(150);
  ok(`${tag}: Waitlist shows the two`, (await gshown()) === 2 && /waitlist/i.test(await p.locator("tr.grow:not([hidden])").first().innerText()));
  await p.locator('[data-gcutbtn="all"]').click(); await p.fill("#gfind", "agency 5");
  // Wait for the filter to apply rather than a fixed pause: under a loaded machine 150 ms was not always enough.
  await p.waitForFunction(() => document.querySelectorAll("tr.grow:not([hidden])").length === 1, null, { timeout: 3000 }).catch(() => {});
  ok(`${tag}: the find box finds by organization`, (await gshown()) === 1 && /Guest5 Sample5/.test(await p.locator("tr.grow:not([hidden])").innerText()), `${await gshown()} shown: ${(await p.locator("tr.grow:not([hidden])").allInnerTexts()).join(" / ").slice(0, 300)}`);
  await p.fill("#gfind", ""); await p.locator('[data-gcutbtn="coming"]').click(); await p.waitForTimeout(150);
  if (tag === "wide") await p.screenshot({ path: `${D}people-guests-${tag}.png` }); else await p.screenshot({ path: `${D}people-guests-${tag}.png`, fullPage: true });
  await p.locator('[data-pseg="presenters"]').click(); await p.waitForTimeout(200);
  if (tag === "wide") await p.screenshot({ path: `${D}people-table-${tag}.png`, fullPage: true });
  else await p.screenshot({ path: `${D}people-table-${tag}.png`, fullPage: true });
  ok(`${tag}: nothing scrolls sideways`, !(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)));
  ok(`${tag}: no page errors`, errs.length === 0, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
