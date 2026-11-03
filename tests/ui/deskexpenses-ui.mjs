// The desk's sidebar has Expenses, under RBH SOWs (Andrew 3 Nov 2026), with a count of what waits on you there. On a
// computer it opens in the main area, beside the sidebar ("it doesn't open up a new window. Instead, it's all in the
// main screen"), with its tabs across the top as on an event and the claims as separate tiles beside the one they open;
// on a phone it opens the Expenses app in its own tab, as before. Either way already signed in as you.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const { issueExpenseSession } = await import(REPO + "netlify/functions/lib/expenses.mjs");
const { todayIso } = await import(REPO + "netlify/functions/lib/deadlines.mjs");
const fs = await import("node:fs");
const D = new URL(".", import.meta.url).pathname;
const S = process.env.DESK_URL || "http://127.0.0.1:8788";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await fetch(`${S}/api/roster`, { headers: { "x-admin-key": "testkey" } });

// A member's claim, sent: a mileage line and a receipt. It waits on the President and the Treasurer.
const J = issueExpenseSession({ email: "j.healy@ongia.ca", name: "John Healy" });
const P = issueExpenseSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
const T = issueExpenseSession({ email: "treasurer@ongia.ca", name: "Raj Jaswal" });
const xapi = async (key, p, json, method) => (await fetch(S + "/api/expenses" + p, { method: method ?? (json ? "POST" : "GET"), headers: { "x-expense-key": key, "content-type": "application/json" }, body: json ? JSON.stringify(json) : undefined })).json();
const day = (n) => todayIso(new Date(Date.now() - n * 86400e3));
const m = await xapi(J, "?add=mileage", { date: day(2), from: "Barrie", to: "Toronto", km: 50, purpose: "Drive to the training" });
const up = await (await fetch(`${S}/api/expenses?add=receipt&claim=${m.claim.id}`, { method: "POST", headers: { "x-expense-key": J, "x-file-name": "receipt1.jpg", "x-upload-id": crypto.randomUUID() }, body: fs.readFileSync(D + "receipt1.jpg") })).json();
let line = null;
for (let i = 0; i < 40; i++) { line = (await xapi(J, "")).current?.lines.find((l) => l.id === up.line); if (line && line.check?.state !== "reading") break; await new Promise((r) => setTimeout(r, 250)); }
await xapi(J, `?claim=${m.claim.id}&line=${up.line}`, { ...line, paidTo: "Staples", date: day(3), category: 1, purpose: "Training supplies", amount: line?.check?.total ?? 24 }, "PUT");
const sent = await xapi(J, `?submit=${m.claim.id}`, {});
ok("a member's claim waits on the President", sent.claim?.status === "submitted", JSON.stringify(sent).slice(0, 200));
const waiting = (await xapi(P, "")).toApprove.length;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const desk = async (who, w = 1440, key = null, h = 900) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  await p.addInitScript(([k, who]) => { sessionStorage.setItem("ongia-admin-key", k); if (who) sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); }, [key ?? issueSession(who), who]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e)));
  await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  return { ctx, p };
};
const ANDREW = { email: "president@ongia.ca", name: "Andrew Hammond", canCost: true };
const { ctx, p } = await desk(ANDREW);
const order = await p.evaluate(() => [...document.querySelectorAll("#side .sn span")].map((s) => s.textContent.trim()).filter(Boolean));
ok("Expenses is in the sidebar, right under RBH SOWs", order.indexOf("Expenses") === order.indexOf("RBH SOWs") + 1, JSON.stringify(order));
ok("its badge counts the claims waiting for you", waiting > 0 && (await p.locator("#expensesnav [data-expn]").innerText()).trim() === String(waiting) && await p.locator("#expensesnav [data-expn]").isVisible(), `${waiting}`);
await p.locator("#side").screenshot({ path: D + "desk-expenses-side.png" });

// On a computer: in the main area.
let pages = 0; ctx.on("page", () => pages++);
await p.locator("#expensesnav").click(); await p.waitForTimeout(2500);
const f = p.frameLocator("#expframe");
ok("it opens in the main area: no new window, the Briefing Room around it, Expenses lit in the sidebar", pages === 0 && new URL(p.url()).pathname === "/admin.html" && await p.locator("#expframe").isVisible() && await p.locator("#expensesnav.on").count() === 1);
ok("…already signed in as you, with the desk's band and tabs across the top, none at the bottom", /Expenses/.test(await f.locator(".dband h2").innerText()) && /You approve claims as the President/.test(await f.locator(".dband .sub").innerText())
  && !(await f.locator("nav.tabs").isVisible()) && !(await f.locator("header.top").isVisible()) && !(await f.locator(".signin").count()));
const tabs = await f.locator(".dtab").allInnerTexts();
ok("To approve comes first, then My claim, Paid claims, All claims; it opens on To approve, with the count", /^To approve\s*\d/.test(tabs[0]) && tabs.slice(1).join("|") === "My claim|Paid claims|All claims" && /To approve/.test(await f.locator(".dtab.on").innerText()), JSON.stringify(tabs));
const frameBox = await p.locator("#expframe").boundingBox();
ok("it fills the window below the Briefing Room's header", frameBox && frameBox.y + frameBox.height <= 900 && frameBox.y + frameBox.height > 860, JSON.stringify(frameBox));
ok("the first waiting claim opens beside the list to start", /\bon\b/.test(await f.locator(".dlist .tile").first().getAttribute("class")) && await f.locator("#dpane .card").count() > 0);
const tile = f.locator(`.dlist [data-open="${m.claim.id}"]`);
await tile.click(); await p.waitForTimeout(1500);
ok("the waiting claim is a tile of its own; picked, it opens beside the list", await tile.count() === 1 && /tile/.test(await tile.getAttribute("class")) && /\bon\b/.test(await tile.getAttribute("class"))
  && /John Healy/.test(await f.locator("#dpane").innerText()) && await f.locator("#dpane #approve").isVisible(), await f.locator("#dpane").innerText().then((t) => t.slice(0, 200)));
await p.screenshot({ path: D + "desk-expenses-approve.png" });

// The receipt opens full size over what you see, not somewhere down the frame.
await f.locator("#dpane #seepics").click(); await p.waitForTimeout(800);
const vb = await f.locator(".viewer").boundingBox();
ok("See the receipt: it opens over the window, in view", vb && vb.y >= 0 && vb.y < 200 && vb.height > 500, JSON.stringify(vb));
await p.screenshot({ path: D + "desk-expenses-viewer.png" });
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
if (await f.locator(".viewer").count()) await f.locator(".viewer [data-close], .viewer .vclose, .viewer button").first().click().catch(() => {});
await p.waitForTimeout(400);

// Approving from the desk: done in place, and the sidebar's count follows.
await f.locator("#dpane #approve").click(); await p.waitForTimeout(2000);
ok("Approve works from the desk: approved by you, in place", /Approved by you/.test(await f.locator("#dpane").innerText()) && pages === 0);
ok("…and the sidebar's count goes down at once", (await p.locator("#expensesnav [data-expn]").innerText()).trim() === String(waiting - 1) || (waiting === 1 && !(await p.locator("#expensesnav [data-expn]").isVisible())), await p.locator("#expensesnav [data-expn]").innerText());

// Paid claims: only the paid ones, as tiles with the day each was paid.
await f.locator('.dtab[data-tab="past"]').click(); await p.waitForTimeout(1000);
ok("Paid claims: only paid claims, or says there are none yet", (await f.locator(".dlist .tile").count()) === 0 ? /Nothing paid yet/.test(await f.locator("#root").innerText()) : (await f.locator(".dlist .tile .ts").allInnerTexts()).every((t) => /^Paid /.test(t)));

// My claim: receipts dropped in, several at once, each on the claim.
await f.locator('.dtab[data-tab="claim"]').click(); await p.waitForTimeout(800);
ok("My claim: the claim being built on the left, Add to this claim with a drop box on the right", await f.locator(".dclaim .run").isVisible() && await f.locator(".dclaim .dadd #drop").isVisible() && await f.locator("#addmile").isVisible());
const before = (await xapi(P, "")).current?.lines.length ?? 0;
await f.locator("#pick").setInputFiles([D + "receipt1.jpg", D + "receipt1.jpg"]);
await p.waitForTimeout(4000);
const mine = (await xapi(P, "")).current;
ok("two receipts chosen at once both land on the one claim", (mine?.lines.length ?? 0) === before + 2, `${before} → ${mine?.lines.length}`);
ok("…and show on the claim", await f.locator(".dclaim .line").count() >= 2);
await p.screenshot({ path: D + "desk-expenses-myclaim.png" });
ok("no page errors on the desk", !p.errs.length, p.errs.join(" | "));
await ctx.close();

// On a phone, the app opens in its own tab, as it always has.
const phone = await desk(ANDREW, 390, null, 844);
await phone.p.evaluate(() => { document.querySelector("#snmore")?.click(); });
await phone.p.waitForTimeout(300);
const [x] = await Promise.all([phone.ctx.waitForEvent("page"), phone.p.locator("#expensesnav").click()]);
await x.waitForLoadState("networkidle"); await x.waitForTimeout(800);
ok("on a phone it opens ONGIA Expenses in its own tab, signed in, tabs at the bottom", new URL(x.url()).pathname === "/expenses" && await x.locator("nav.tabs").isVisible() && !(await x.locator(".signin").isVisible().catch(() => false)));
await phone.ctx.close();

const member = await desk({ email: "j.healy@ongia.ca", name: "John Healy" });
const morder = await member.p.evaluate(() => [...document.querySelectorAll("#side .sn span")].map((s) => s.textContent.trim()).filter(Boolean));
ok("a board member who doesn't see RBH SOWs still has Expenses", morder.includes("Expenses") && !morder.includes("RBH SOWs"), JSON.stringify(morder));
await member.p.locator("#expensesnav").click(); await member.p.waitForTimeout(2000);
const mf = member.p.frameLocator("#expframe");
const mtabs = (await mf.locator(".dtab").allInnerTexts()).join("|"), mtext = await mf.locator("#root").innerText();
ok("…and theirs has My claim and Paid claims; what they sent and isn't paid shows under My claim", mtabs === "My claim|Paid claims" && /Sent, not paid yet/i.test(mtext) && await mf.locator(`.tile[data-open="${m.claim.id}"]`).count() === 1, `${mtabs} || ${mtext.slice(0, 300)}`);
await member.p.screenshot({ path: D + "desk-expenses-member.png" });
await member.ctx.close();

const keyed = await desk(null, 1440, "testkey");
ok("signed in with the desk key (nobody in particular), there's no Expenses", await keyed.p.locator("#expensesnav").count() === 0);
await keyed.ctx.close();

const rail = await desk(ANDREW, 1280);
ok("on a laptop, the icon rail has Expenses with its badge", await rail.p.locator("#expensesnav").isVisible());
await rail.p.locator("#side").screenshot({ path: D + "desk-expenses-rail.png" });
await rail.ctx.close();

// Tidy up: the claims made here would otherwise sit in To approve, or on My claim, for the tests that run after this one.
await xapi(T, `?decide=${m.claim.id}`, { decision: "reject", comment: "Test claim, removed." });
const gone = await fetch(`${S}/api/expenses?claim=${m.claim.id}`, { method: "DELETE", headers: { "x-expense-key": J } });
ok("the test's claim is sent back and deleted, so nothing waits on the President", gone.status === 200, String(gone.status));
if (mine?.id && before === 0) await fetch(`${S}/api/expenses?claim=${mine.id}`, { method: "DELETE", headers: { "x-expense-key": P } });

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
