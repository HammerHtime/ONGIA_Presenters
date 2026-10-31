// The event budget on an event's Money tab (Andrew 30 Oct 2026: "build the ONGIA event budgets"): the Sandbox's page,
// started from the event's own records, the registration questions first, the rooming list's nights brought in and kept.
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
const PRES = { "x-admin-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }) };
const saved = async (id) => (await (await fetch(`${S}/api/budget?event=${id}`, { headers: PRES })).json()).budget;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (w, h, hash, email = "president@ongia.ca", name = "Andrew Hammond", extra = { owner: true, canCost: true }) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email, name });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email, name, ...extra }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e))); p.on("dialog", (d) => d.accept());
  await p.goto(`${S}/admin.html${hash}`, { waitUntil: "networkidle" }); await p.waitForTimeout(2000);
  return p;
};
const tab = (id, t) => "#v=" + encodeURIComponent(JSON.stringify({ name: "event", eventId: id, ...(t ? { tab: t } : {}) }));

for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Budget Night ${tag} ${T}`, city: "Regina, SK", venue: "Delta Regina", dayOne: "2031-05-12", lastDay: "2031-05-14", invite: false,
    board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }, { name: "Andrew Hammond", email: "president@ongia.ca" }], hotel: { name: "Delta Regina", rate: "$189 per night plus taxes" } }) })).event;
  await api(`/api/rooming?event=${ev.id}`, { method: "PUT", body: JSON.stringify({ guests: [{ name: "Pat Example", type: "ONGIA Guest", checkIn: "2031-05-11", checkOut: "2031-05-14", billing: "ONGIA" }] }) });

  let p;
  if (tag === "wide") {
    p = await open(w, h, tab(ev.id, "money"));
    // The set-up walk-through comes up first (walk-ui tests it); closed, the one-page questions are a button away.
    ok(`${tag}: opening the Money tab the first time starts the set-up walk-through`, await p.locator("dialog.walk").isVisible() && /budget night/i.test(await p.locator("dialog.walk").innerText()));
    await p.locator("#wclose").click(); await p.waitForTimeout(600); await p.locator("#sbx-q").click(); await p.waitForTimeout(400);
    ok(`${tag}: and whether the ticket prices include the province's tax (GST in Saskatchewan)`, /include GST\?/.test(await p.locator(".sbxq").innerText()));
  } else {
    p = await open(w, h, tab(ev.id));
    ok(`${tag}: the overview doesn't interrupt with it`, !(await p.locator(".sbxq, dialog.walk").count()));
    await p.locator('.etab[data-tab="money"]').click(); await p.waitForTimeout(800);
    ok(`${tag}: pressing the Money tab starts the walk-through`, await p.locator("dialog.walk").isVisible());
    await p.locator("#wclose").click(); await p.waitForTimeout(600); await p.locator("#sbx-q").click(); await p.waitForTimeout(400);
  }
  await p.locator('.sbxq [data-q="inPerson.price"]').fill("450");
  await p.locator('.sbxq [data-q="inPerson.expected"]').fill("100");
  await p.locator('.sbxq [data-yn="virtual"][data-v="1"]').click();
  await p.locator('.sbxq [data-q="virtual.price"]').fill("199");
  await p.locator('.sbxq [data-tax="0"]').click();
  await p.locator(".sbxq").screenshot({ path: D + `budget-questions-${tag}.png` });
  await p.locator("#q-done").click(); await p.waitForTimeout(1800);
  let B = await saved(ev.id);
  ok(`${tag}: the answers are saved with the event`, B?.asked && B.reg.inPerson.price === 450 && B.reg.inPerson.expected === 100 && B.reg.virtual.on && B.reg.virtual.price === 199 && B.pricesIncludeHst === false && B.hst === 5, JSON.stringify(B?.reg));
  ok(`${tag}: the budget is on the Money tab, with its tiles`, /What Budget Night/.test(await p.locator("#evbudget .sbxhead").innerText()) && (await p.locator("#evbudget .sbkpi .sbt").count()) === 5 && (await p.locator("#evbudget .sbstrip .sbt").count()) === 4 && (await p.locator("#evbudget .sbmore .sbt").count()) === 4);
  ok(`${tag}: registration shows only what was said yes to`, /Virtual/.test(await p.locator(".sbreg").innerText()) && !/Community|Memberships/.test(await p.locator(".sbreg").innerText()));
  ok(`${tag}: the hotel's rate is filled in from the event`, (await p.locator('[data-k="hotel.rate"]').inputValue()) === "189");
  const patRow = p.locator("tr.rl", { hasText: "Pat Example" });
  ok(`${tag}: the person on the rooming list is there with their three nights, marked as from the rooming list, not tappable`, (await patRow.locator(".c.on").count()) === 3 && /rooming list/.test(await patRow.innerText()) && await patRow.locator(".c").first().isDisabled());
  const raj = p.locator("tr", { has: p.locator('input.pname[value="Raj Jaswal"]') });
  ok(`${tag}: the board on the event is planned in from three nights before day one, reimbursed`, (await raj.locator(".c.on").count()) === 6 && /reimburse/i.test(await raj.locator(".pbseg button.on").innerText()), String(await raj.locator(".c.on").count()));
  if (tag === "phone") {
    // Andrew 30 Oct 2026: "the names are to the left and then I can see one day ... swipe to left and the next day appears".
    const g = await p.locator(".ngwrap").evaluate((el) => ({ cw: el.clientWidth, day: el.querySelector("thead th.dc").getBoundingClientRect().width, snap: getComputedStyle(el).scrollSnapType }));
    ok(`${tag}: one night at a time beside the names, snapping as it's swiped`, Math.abs(g.day - (g.cw - 140)) < 3 && /x/.test(g.snap), JSON.stringify(g));
    await p.locator(".ngwrap").evaluate((el) => { el.scrollLeft = el.querySelectorAll("thead th.dc")[4].offsetLeft - 140; });
    await p.waitForTimeout(400);
    const before = await p.locator(".ngwrap").evaluate((el) => el.scrollLeft);
    await raj.locator(".c").nth(4).click(); await p.waitForTimeout(900);
    ok(`${tag}: a tap keeps the same night on screen`, Math.abs((await p.locator(".ngwrap").evaluate((el) => el.scrollLeft)) - before) < 3);
    await raj.locator(".c").nth(4).click(); await p.waitForTimeout(900);
  }
  await raj.locator(".c.on").first().click(); await p.waitForTimeout(1600);
  B = await saved(ev.id);
  ok(`${tag}: tapping a board night takes it off, and it saves on its own`, B.people.find((x) => x.name === "Raj Jaswal").nights.length === 5 && /Saved/.test(await p.locator("#sbx-said").innerText()));
  await p.locator("#evbudget .sbkpi").screenshot({ path: D + `budget-tiles-${tag}.png` });
  await p.locator("#evbudget .card").filter({ has: p.locator("table.ng") }).screenshot({ path: D + `budget-nights-${tag}.png` });
  if (tag === "wide") {
    // Andrew 30 Oct 2026: "a button ... that says add board members and with one click they all get added".
    const before = (await saved(ev.id)).people.filter((x) => x.group === "board").length;
    await p.locator("[data-paddall]").click(); await p.waitForTimeout(1600);
    const board = (await saved(ev.id)).people.filter((x) => x.group === "board");
    ok(`${tag}: Add all board members puts the whole board roster on the grid, each from three nights before day one, reimbursed`, board.length > before && board.every((x) => x.pays === "reimbursed") && board.filter((x) => x.name !== "Raj Jaswal").every((x) => x.nights[0] === "2031-05-09" && x.nights.at(-1) === "2031-05-14") && !(await p.locator("[data-paddall]").count()), `${before} → ${board.length}`);
    // Andrew 30 Oct 2026: "a venue that only can seat 300 is our cap ... has to include our presenters ... with 8 people at
    // a round table, how many tables?"
    const seats = p.locator('[data-k="room.seats"]'); await seats.fill("120"); await seats.press("Tab"); await p.waitForTimeout(1500);
    const vip = p.locator('[data-k="room.vips"]'); await vip.fill("4"); await vip.press("Tab"); await p.waitForTimeout(1500);
    // Andrew 30 Oct 2026: "not include the sponsors ... board members ... volunteers ... just attendees, presenters, and VIPs".
    const Bs = await saved(ev.id), notAtt = Bs.people.filter((x) => x.group === "presenter").length + 4;
    ok(`${tag}: the room's seats are kept, and what's left for attendees is the seats less the presenters and VIPs, not the board`, Bs.room.seats === 120 && new RegExp(`room for ${120 - notAtt} attendees`).test(await p.locator(".blk.wide2 .row.tot").innerText()), await p.locator(".blk.wide2 .row.tot").innerText());
    const day = await p.locator(".seats tbody tr").first().locator("td").allInnerTexts();
    ok(`${tag}: each day says how many are seated and how many round tables of 8 that takes`, Number(day[3]) === 4 && Number(day[5]) === Math.ceil(Number(day[4].split(/\s/)[0]) / 8) && Number(day[6]) === Number(day[5]) * 8, day.join(" | "));
    const exp = p.locator('[data-k="reg.inPerson.expected"]'); await exp.fill("200"); await exp.press("Tab"); await p.waitForTimeout(1500);
    ok(`${tag}: expecting more than the room takes says so, in red`, /too many/.test(await p.locator(".blk.wide2 .row.tot").innerText()) && (await p.locator(".seats tr.over").count()) > 0);
    await exp.fill("100"); await exp.press("Tab"); await p.waitForTimeout(1200);
    ok(`${tag}: the room's seats typed in the budget are the event's own`, (await api(`/api/events?id=${ev.id}`)).event.room?.seats === 120);
    // Andrew 30 Oct 2026: "where are all the line items ... AV, presenter gifts, attendee gifts ... That was in the Excel
    // sheet", and "you could hide all of those spent columns and we'll just have the projected".
    ok(`${tag}: Everything else has Group, Line and Projected, no Spent`, (await p.locator(".sbelse thead").innerText()).replace(/\s+/g, " ").trim().toUpperCase() === "GROUP LINE PROJECTED" && !(await p.locator('[data-k$=".spent"], [data-k$=".paid"]').count()), await p.locator(".sbelse thead").innerText());
    await p.locator("[data-usual]").click(); await p.waitForTimeout(1500);
    const lines = (await saved(ev.id)).other;
    ok(`${tag}: Add the usual lines brings in the Summit budget's lines at its amounts, and the button goes`, lines.length >= 20 && lines.find((o) => o.name === "AV for the virtual component")?.planned === 42000 && lines.some((o) => o.name === "Presenter gifts ($100 each)") && lines.some((o) => o.name === "Tote bag items") && !(await p.locator("[data-usual]").count()), String(lines.length));
    ok(`${tag}: no person's name among them`, !lines.some((o) => /Raj|Tyler|Andy|Jessy|Tessa|Ryan/i.test(o.name)));
    // Andrew 30 Oct 2026: "a dropdown for all the common groupings ... click add ... a box pops open ... added to the list".
    await p.locator('[data-radd="other"]').click(); await p.waitForTimeout(800);
    const sel = p.locator("select[data-grp]").last();
    const opts = await sel.locator("option").allInnerTexts();
    ok(`${tag}: a new line's group is a dropdown of the common groups, with Add a group last`, opts.includes("Venue & AV") && opts.includes("Travel") && opts.at(-1) === "+ Add a group…" && opts[0] === "Pick a group…", opts.join(" | "));
    await sel.selectOption("Travel"); await p.waitForTimeout(1500);
    ok(`${tag}: picking one saves it`, (await saved(ev.id)).other.at(-1).group === "Travel");
    const grp = `Security ${T}`;
    await p.locator("select[data-grp]").last().selectOption("__add"); await p.waitForTimeout(400);
    ok(`${tag}: Add a group opens a box`, await p.locator(".grpdlg").isVisible());
    await p.locator("#grp-name").fill(grp); await p.locator("#grp-ok").click(); await p.waitForTimeout(1500);
    ok(`${tag}: the new group is on that line, and in the list for every budget`, (await saved(ev.id)).other.at(-1).group === grp && (await (await fetch(`${S}/api/budget?groups=1`, { headers: PRES })).json()).groups.includes(grp));
    await p.locator('[data-radd="other"]').click(); await p.waitForTimeout(800);
    ok(`${tag}: and it's offered on the next line`, (await p.locator("select[data-grp]").last().locator("option").allInnerTexts()).includes(grp));
    ok(`${tag}: the stipends and the food table stay inside their cards`, await p.evaluate(() => { const i = document.querySelector("#evbudget .intbox"), f = document.querySelector("#evbudget table.mp")?.closest(".scroll"); return i.scrollWidth <= i.clientWidth + 1 && f.scrollWidth <= f.clientWidth + 1; }));
  }
  ok(`${tag}: fits the screen, no page errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !p.errs.length, p.errs.join(" | "));

  if (tag === "wide") {
    // Someone added to the rooming list later shows up the next time the budget opens.
    await api(`/api/rooming?event=${ev.id}`, { method: "PUT", body: JSON.stringify({ guests: [{ name: "Pat Example", type: "ONGIA Guest", checkIn: "2031-05-11", checkOut: "2031-05-14", billing: "ONGIA" },
      { name: "Sam Sample", type: "ONGIA Guest", checkIn: "2031-05-12", checkOut: "2031-05-13", billing: "Guest" }] }) });
    await p.close();
    p = await open(w, h, tab(ev.id, "money"));
    ok(`${tag}: someone added to the rooming list later is in the budget the next time, and nothing typed is lost`, (await p.locator("tr.rl", { hasText: "Sam Sample" }).locator(".c.on").count()) === 1
      && !(await p.locator(".sbxq, dialog.walk").count()) && (await saved(ev.id)).people.find((x) => x.name === "Raj Jaswal").nights.length === 5);
    await p.close();
    // Making a new event of ONGIA's own: the questions come up as soon as it's made (Andrew 29 Oct 2026).
    p = await open(w, h, "");
    await p.locator("button:has-text('New event')").first().click(); await p.waitForTimeout(1000);
    await p.fill("#e-title", `Fresh Budget ${T}`); await p.fill("#e-city", "Ottawa, ON"); await p.fill("#e-day1", "2031-09-08"); await p.fill("#e-last", "2031-09-09");
    await p.evaluate(() => { const m = document.querySelector('#board .member[data-email="president@ongia.ca"]'); const pick = m.querySelector(".pick"); pick.checked = true; pick.dispatchEvent(new Event("change", { bubbles: true }));
      const r = m.querySelector('input[name="lead"]'); r.disabled = false; r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); });
    await p.locator("#create").click(); await p.waitForTimeout(2500);
    ok(`${tag}: a new event starts the set-up walk-through as soon as it's made`, await p.locator("dialog.walk").isVisible() && /fresh budget/i.test(await p.locator("dialog.walk").innerText()));
    await p.locator('[data-wstart="fresh"]').click(); await p.waitForTimeout(300); await p.locator("#wnext").click(); await p.waitForTimeout(300);
    await p.locator("#wv").fill("375"); await p.locator("#wv").press("Enter"); await p.waitForTimeout(300); await p.locator("#wclose").click(); await p.waitForTimeout(1500);
    const fresh = (await api("/api/events")).events.find((e) => e.title === `Fresh Budget ${T}`);
    ok(`${tag}: and its answers are that event's budget, with Ontario's HST`, (await saved(fresh.id))?.reg.inPerson.price === 375 && (await saved(fresh.id)).hst === 13 && !p.errs.length, p.errs.join(" | "));
    await p.close();
    // An iPad, both ways round: nothing wider than the screen (the top bar's buttons wrap under).
    for (const [iw, ih] of [[820, 1180], [1180, 820]]) {
      const ip = await open(iw, ih, tab(ev.id, "money"));
      ok(`iPad ${iw}×${ih}: the Money tab fits the screen`, await ip.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && !ip.errs.length, ip.errs.join(" | "));
      await ip.close();
    }
    const lead = await open(w, h, tab(ev.id), "treasurer@ongia.ca", "Raj Jaswal", {});
    // Since 30 Oct 2026 a board member on the event can add receipts here, so the tab is there for them, called Receipts.
    ok(`${tag}: the event's lead, who never sees the money, gets a Receipts tab and no budget`, /^Receipts/.test((await lead.locator('.etab[data-tab="money"]').innerText()).trim()) && !(await lead.locator("#evbudget").count()) && (await lead.locator("#receiptscard").count()) === 1);
    await lead.close();
  } else await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
