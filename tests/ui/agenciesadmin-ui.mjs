// Admin › Agencies (Andrew 30 Oct 2026): "the agencies master list should not sit inside each event. Maybe put it under
// admin. And a badge beside the admin of the number of things that need my attention." What the desk matched is already
// applied ("your suggestions should default to yes so I don't have to click it unless you are wrong"); only what it
// could not place waits and counts on the badge.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const T = Date.now().toString(36).slice(-4).toUpperCase();
await api("/api/roster");
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Agency Desk ${T}`, city: "Toronto", dayOne: "2031-05-04", lastDay: "2031-05-06", invite: false, presenters: [],
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] }) })).event;
const rows = [["Toronto Polcie Service", "a@torontopolice.on.ca"], ["Toronto Polcie Service", "b@torontopolice.on.ca"], [`Brampton Division ${T}`, "c@peelpolice.ca"],
  [`Bylaw - Brampton ${T}`, "d@brampton.ca"], [`Retired ${T}`, "e@gmail.com"]];
await fetch(`${S}/api/attendees?event=${ev.id}&csv=1`, { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "text/csv" },
  body: "First name,Last name,Email,Organization\n" + rows.map(([o, e], i) => `Guest,${i},${e},"${o}"`).join("\n") });
// What Claude answers (the stand-in on 8799): the by-law office is a new agency; "Retired" has nothing to go on.
const newName = `City of Brampton Enforcement ${T}`;
await fetch("http://127.0.0.1:8799/__set", { method: "POST", body: JSON.stringify({ reply: { answers: [
  { raw: `Bylaw - Brampton ${T}`, agency: newName, isNew: true, province: "ON", fr: "", reason: "Their email is @brampton.ca, and the city's website lists the department.", lookUp: false },
  { raw: `Retired ${T}`, agency: "", isNew: false, province: "", fr: "", reason: "Retired isn't an agency and the email is a personal Gmail address, so there's nothing to go on.", lookUp: false }] } }) });
await fetch(`${S}/api/agencies-settle-background`, { method: "POST", headers: H });
let M;
for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); M = await api("/api/agencies?master=1"); if (M.run?.state === "done") break; }
ok("the check ran", M.run?.state === "done", JSON.stringify(M.run));

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond" }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  const waitingNow = (await api("/api/agencies?count=1")).waiting;
  await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  const badge = p.locator("#admin [data-attn]");
  if (tag === "wide") {
    ok(`${tag}: the Admin button carries a badge with how many wait`, waitingNow > 0 && await badge.isVisible() && (await badge.innerText()).trim() === String(waitingNow), `${await badge.innerText()} vs ${waitingNow}`);
    await p.locator("#admin").screenshot({ path: D + "agencies-badge.png" });
    await p.locator("#admin").click(); await p.waitForTimeout(1500);
    ok(`${tag}: with something waiting, Admin opens on Agencies, which carries the same badge`, await p.locator('.atab.on[data-atab="agencies"]').count() === 1 && (await p.locator('.atab.on [data-attn]').innerText()).trim() === String(waitingNow));
  } else {
    // Everything was dealt with on the wide screen: no badge, and Admin opens where it always did.
    ok(`${tag}: nothing waiting, no badge`, waitingNow === 0 && !(await badge.isVisible()), String(waitingNow));
    await p.locator("#admin").click(); await p.waitForTimeout(1500);
    ok(`${tag}: and Admin opens on Board members; Agencies is a tab beside it`, await p.locator('.atab.on[data-atab="board"]').count() === 1 && await p.locator('.atab[data-atab="agencies"]').count() === 1);
    await p.locator('.atab[data-atab="agencies"]').click(); await p.waitForTimeout(1500);
  }
  const row = (raw) => p.locator(`.agq[data-agraw="${raw}"]`);
  if (tag === "wide") {
    ok("the misspelling was put right on its own, with why", /Now\s+Toronto Police Service/.test(await row("Toronto Polcie Service").innerText()) && /misspelling of Toronto Police Service/i.test(await row("Toronto Polcie Service").innerText()) && /2 people/.test(await row("Toronto Polcie Service").innerText()), await row("Toronto Polcie Service").innerText());
    ok("a work email placed another: Peel, by @peelpolice.ca", /Now\s+Peel Regional Police/.test(await row(`Brampton Division ${T}`).innerText()) && /@peelpolice\.ca/.test(await row(`Brampton Division ${T}`).innerText()));
    ok("Claude's new agency is applied and marked as added to the list", /Now\s+City of Brampton Enforcement/.test(await row(`Bylaw - Brampton ${T}`).innerText()) && /Added to the list/i.test(await row(`Bylaw - Brampton ${T}`).innerText()));
    ok("only the one with nothing to go on waits, with Claude's reason", /personal Gmail/.test(await row(`Retired ${T}`).innerText()) && await p.locator(".agwait").count() === 1);
    await p.screenshot({ path: D + "agencies-wide.png", fullPage: true });

    // Who's coming on the event shows the official name, what was typed on hover; no Agencies section there any more.
    const ep = await b.newPage({ viewport: { width: 1440, height: 1000 } });
    await ep.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond" }]);
    await ep.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id })), { waitUntil: "networkidle" }); await ep.waitForTimeout(1500);
    const cells = await ep.evaluate(() => [...document.querySelectorAll("tr.grow td.go")].map((td) => [td.textContent.trim(), td.title]));
    ok("Who's coming shows Toronto Police Service for the misspelling, with what they typed on hover", cells.filter(([t, ti]) => t === "Toronto Police Service" && ti === "Typed as: Toronto Polcie Service").length === 2, JSON.stringify(cells));
    ok("the event has no Agencies section any more", await ep.locator("#agenciesfold, #agbox").count() === 0);
    await ep.close();

    // Correct one: type the right agency and save.
    const fix = row(`Brampton Division ${T}`).locator("input");
    await fix.fill(newName); await row(`Brampton Division ${T}`).locator("[data-agsave]").click(); await p.waitForTimeout(1200);
    ok("a wrong match is corrected by typing the right agency", /Now\s+City of Brampton Enforcement/.test(await row(`Brampton Division ${T}`).innerText()) && /You/.test(await row(`Brampton Division ${T}`).innerText()), await row(`Brampton Division ${T}`).innerText());
    // Undo one: it goes back to waiting and the badge goes up.
    const before = +(await p.locator('.atab [data-attn]').innerText());
    await row("Toronto Polcie Service").locator("[data-agundo]").click(); await p.waitForTimeout(1200);
    ok("Undo sends it back to waiting, and the badge goes up", await p.locator(".agwait .agq[data-agraw=\"Toronto Polcie Service\"]").count() === 1 && +(await p.locator('.atab [data-attn]').innerText()) === before + 1);
    // Leave blank: it stops waiting, and the badge goes down.
    await p.locator(`.agwait .agq[data-agraw="Retired ${T}"] [data-agblank]`).click(); await p.waitForTimeout(1200);
    ok("Leave blank: it stops waiting and the badge goes down", await p.locator(`.agq[data-agraw="Retired ${T}"]`).count() === 0 && +(await p.locator('.atab [data-attn]').innerText()) === before);
    // Left blank shows at the bottom, and Bring back returns it (Andrew 30 Oct 2026).
    ok("Left blank lists it", await p.locator(`.agblank .agq[data-agraw="Retired ${T}"]`).count() === 1);
    await p.locator(".agblank > summary").click();
    await p.locator(`.agblank .agq[data-agraw="Retired ${T}"] [data-agunblank]`).click(); await p.waitForTimeout(1200);
    ok("Bring back puts it back with the ones waiting, and the badge goes up", await p.locator(`.agwait .agq[data-agraw="Retired ${T}"]`).count() === 1 && +(await p.locator('.atab [data-attn]').innerText()) === before + 1);
    await p.locator(`.agwait .agq[data-agraw="Retired ${T}"] [data-agblank]`).click(); await p.waitForTimeout(1200);
    // Answer the one that waits.
    await p.locator('.agwait .agq[data-agraw="Toronto Polcie Service"] input').fill("Toronto Police Service");
    await p.locator('.agwait .agq[data-agraw="Toronto Polcie Service"] [data-agwsave]').click(); await p.waitForTimeout(1200);
    ok("typing the agency for a waiting one places it", await p.locator('.agwait .agq[data-agraw="Toronto Polcie Service"]').count() === 0 && /Now\s+Toronto Police Service/.test(await row("Toronto Polcie Service").innerText()));

    // The master list: find, add, download.
    await p.locator("#ag-find").fill("gendarmerie");
    const shown = await p.evaluate(() => [...document.querySelectorAll("[data-agrow]")].filter((tr) => !tr.hidden).map((tr) => tr.dataset.agrow));
    ok("finding by a French name shows that agency", shown.length === 1 && shown[0] === "Royal Canadian Mounted Police", JSON.stringify(shown));
    await p.locator("#ag-find").fill("");
    await p.locator("#ag-add").click();
    await p.locator("#agd-name").fill(`Test Agency ${T}`); await p.locator("#agd-prov").selectOption("ON"); await p.locator("#agd-fr").fill("Agence d'essai"); await p.locator("#agd-dom").fill("testagency.ca");
    await p.locator("#agd-ok").click(); await p.waitForTimeout(1200);
    const added = p.locator(`[data-agrow="Test Agency ${T}"]`);
    ok("Add an agency: on the list with its province, French name and domain", /Ontario/.test(await added.innerText()) && /Agence d'essai/.test(await added.innerText()) && /testagency\.ca/.test(await added.innerText()), await added.innerText());
    const [dl] = await Promise.all([p.waitForEvent("download"), p.locator("#ag-csv").click()]);
    ok("the master list downloads as a spreadsheet", dl.suggestedFilename() === "ongia-agencies-master-list.csv");
    await p.locator("#ag-clear").click(); await p.waitForTimeout(1200);
    ok("Looks right, clear the list", await p.locator(".agq:not(.agwait .agq)").count() === 0 || !(await p.locator("#ag-clear").count()));
  } else {
    await p.screenshot({ path: D + "agencies-phone.png", fullPage: true });
  }
  ok(`${tag}: fits, no errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
