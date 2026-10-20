// The redesigned home page: three counts, one action queue with the button that does each job, "waiting on others",
// the upcoming events as a table, and the search box. Phone and desktop.
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
const mk = async (title, dayOne, people, board = [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }]) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Toronto", venue: "Hall", dayOne, lastDay: dayOne, invite: false, board,
  presenters: people.map(([f, l]) => ({ first: f, last: l, email: `${f.toLowerCase()}.${l.toLowerCase()}.${T}@example.ca`, organization: "Org" })) }) })).event;
const answers = (p) => ({ first: p.first, last: p.last, email: p.email, phone: "4165550100", organization: "Org", talk: "T", bio: "word ".repeat(40), outline: "O", travel: "no", hotel: "no", expenses: { transport: "no", meals: "no", other: "no", otherText: "" }, copyright: true, noInvestigation: true, termsAccepted: true, media: { photo: { internal: "yes", public: "yes" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: "yes" } }, sensitive: "no", signature: `${p.first} ${p.last}`, agreed: true, language: "en" });
// An event a few months out: one presenter has signed (to review), one was never sent a link, two were sent but haven't signed.
const A = await mk(`Home Summit ${T}`, shift(120), [["Rev", "Iewer"], ["Never", "Sent"], ["Slow", "One"], ["Slow", "Two"]]);
let PA = (await api(`/api/events?id=${A.id}`)).presenters;
await api(`/api/invite?id=${A.id}`, { method: "POST", body: JSON.stringify({ presenterIds: PA.filter((p) => p.first !== "Never").map((p) => p.id) }) });
const rev = PA.find((p) => p.first === "Rev");
await fetch(`${S}/api/agreement?t=${rev.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(answers(rev)) });
// An event whose agreements are overdue (due date moved into the past), on which the president is not on the board.
const B = await mk(`Overdue Forum ${T}`, shift(40), [["Late", "Person"]]);
const PB = (await api(`/api/events?id=${B.id}`)).presenters;
await api(`/api/invite?id=${B.id}`, { method: "POST", body: JSON.stringify({ presenterIds: PB.map((p) => p.id) }) });
await api(`/api/events?id=${B.id}`, { method: "PUT", body: JSON.stringify({ ...(await api(`/api/events?id=${B.id}`)).event, offsets: { agreement: 45, draft: 35, final: 30 } }) });
// An event the president is on.
const C = await mk(`Presidents Own ${T}`, shift(200), [["Own", "Speaker"]], [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }]);

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (email, name, vp, canCost = false) => {
  const page = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
  const token = issueSession({ email, name });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email, name, owner: canCost, canCost }]);
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  page.on("dialog", (d) => d.accept());
  await shaped(page);
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
  return page;
};
const qtext = (p) => p.locator("#queue").innerText();
// The local server has no email, so every "invitation" is recorded as not sent. Shape the list as it would be with
// email working: the two Slow presenters and Late Person were sent their link; Never Sent was not.
const shaped = async (p) => {
  await p.route("**/api/events", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const j = await (await route.fetch()).json();
    for (const e of j.events) {
      if (e.id === A.id) { e.attention.uninvited = e.attention.uninvited.filter((x) => x.name === "Never Sent"); e.attention.sendFailed = []; }
      if (e.id === B.id) { e.attention.uninvited = []; e.attention.sendFailed = []; }
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
  });
};
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  console.log(`— ${tag}`);
  const p = await open("president@ongia.ca", "Andrew Hammond", { width: w, height: h }, true);
  ok(`${tag}: three counts across the top: needs my action, waiting on others, upcoming events`, (await p.locator(".qcount").count()) === 3 && /Needs my action/.test(await p.locator(".qcounts").innerText()) && /Waiting on others/.test(await p.locator(".qcounts").innerText()) && /Upcoming event/.test(await p.locator(".qcounts").innerText()));
  let q = await qtext(p);
  ok(`${tag}: the queue has the agreement to review, with a Review button`, new RegExp(`Review agreement · Rev Iewer`).test(q) && (await p.locator(`[data-goreview="${A.id}|${rev.id}"]`).count()) === 1, q.slice(0, 400));
  ok(`${tag}: the link that was never sent, with Send link`, /Link never sent · Never Sent/.test(q) && (await p.locator(`#queue [data-qsend^="${A.id}|"]`).count()) === 1);
  ok(`${tag}: the overdue agreement, with Email again`, new RegExp(`agreement overdue · Late Person`).test(q) && (await p.locator(`#queue [data-qremind^="${B.id}|"]`).count()) === 1, q.slice(0, 600));
  ok(`${tag}: the count matches the rows`, Number(await p.locator('.qcount[data-qtab="needs"] b').innerText()) === await p.locator("#queue .qrow, #queue .ibrow").count());
  ok(`${tag}: no sideways scrolling`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await p.screenshot({ path: D + `home-${tag}.png`, fullPage: true });
  // the events table
  const rowA = p.locator(`#upcoming [data-open="${A.id}"]`);
  ok(`${tag}: the upcoming events are rows, with how many have signed and what's next`, (await rowA.count()) === 1 && /0 of 4/.test(await rowA.innerText()) && /1 to review/i.test(await rowA.innerText()) && /1 never sent/i.test(await rowA.innerText()) && !/view only/i.test(await rowA.innerText()), await rowA.innerText());
  // waiting on others
  await p.locator('[data-qtab="waiting"]').click(); await p.waitForTimeout(900);
  q = await qtext(p);
  ok(`${tag}: "Waiting on others" lists who hasn't signed yet, with Email all`, /Waiting on others/.test(q) && /2 presenters haven't signed yet · Slow One, Slow Two/.test(q) && (await p.locator(`#queue [data-qremind^="${A.id}|"]`).count()) === 1, q.slice(0, 500));
  await p.screenshot({ path: D + `home-waiting-${tag}.png` });
  await p.locator('[data-qtab="needs"]').click(); await p.waitForTimeout(800);
  // My events
  await p.locator('[data-qscope="mine"]').click(); await p.waitForTimeout(900);
  q = await qtext(p);
  ok(`${tag}: "My events" leaves out events the president isn't on`, !/Rev Iewer|Late Person/.test(q));
  await p.locator('[data-qscope="all"]').click(); await p.waitForTimeout(900);
  // search
  await p.fill("#hsearch", "Iewer"); await p.waitForTimeout(900);
  ok(`${tag}: the search finds a presenter as you type, with their event`, (await p.locator("#hsres").isVisible()) && new RegExp(`Rev Iewer[\\s\\S]*Home Summit ${T}`).test(await p.locator("#hsres").innerText()), await p.locator("#hsres").innerText());
  await p.locator("#hsres [data-i]").first().click(); await p.waitForTimeout(1500);
  ok(`${tag}: clicking it opens their agreement`, /Rev Iewer/.test(await p.locator("body").innerText()) && (await p.locator("#r-name, #r-attest").count()) >= 1);
  await p.goBack(); await p.waitForTimeout(1200);
  await p.fill("#hsearch", `Overdue Forum ${T}`); await p.waitForTimeout(900);
  ok(`${tag}: it finds events too`, /event/i.test(await p.locator("#hsres").innerText()) && new RegExp(`Overdue Forum ${T}`).test(await p.locator("#hsres").innerText()));
  await p.fill("#hsearch", "zzqqxx"); await p.waitForTimeout(800);
  ok(`${tag}: and says so when nothing matches`, /Nothing matches/.test(await p.locator("#hsres").innerText()));
  await p.fill("#hsearch", ""); await p.keyboard.press("Escape");
  ok(`${tag}: no page errors`, p.errs.length === 0, p.errs.join("|"));
  await p.close();
}
// the buttons do the job
{
  const p = await open("president@ongia.ca", "Andrew Hammond", { width: 1440, height: 1000 }, true);
  const sends = [];
  await p.route("**/api/invite?**", (route) => { sends.push({ url: route.request().url(), body: JSON.parse(route.request().postData() || "{}") }); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sent: [{ name: "x" }], failed: [], remind: false }) }); });
  const never = PA.find((x) => x.first === "Never");
  await p.locator(`#queue [data-qsend^="${A.id}|"]`).click(); await p.waitForTimeout(1200);
  ok("Send link sends that presenter's link (a first invitation, not a reminder)", sends.length === 1 && sends[0].url.includes(A.id) && JSON.stringify(sends[0].body.presenterIds) === JSON.stringify([never.id]) && sends[0].body.remind === false, JSON.stringify(sends));
  await p.locator(`#queue [data-qremind^="${B.id}|"]`).click(); await p.waitForTimeout(1200);
  ok("Email again sends Late Person a reminder", sends.length === 2 && sends[1].url.includes(B.id) && JSON.stringify(sends[1].body.presenterIds) === JSON.stringify([PB[0].id]) && sends[1].body.remind === true, JSON.stringify(sends[1]));
  ok("…and says so", /Sent to/.test(await p.locator(".toast").innerText()));
  // Retry filing from the queue (a failed filing is put in the list by the test)
  await p.unroute("**/api/events");
  await p.route("**/api/events", async (route) => {
    const r = await route.fetch(); const j = await r.json();
    const e = j.events.find((x) => x.id === C.id); if (e) e.attention = { ...(e.attention ?? {}), failed: [{ id: "pfail", name: "Filed Badly" }] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
  });
  let refiled = 0;
  await p.route("**/api/review?**action=redeliver", (route) => { refiled++; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, delivery: { filing: { ok: true } } }) }); });
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  ok("a PDF that never reached SharePoint is in the queue with Retry filing", /PDF not filed · Filed Badly/.test(await qtext(p)));
  await p.locator(`#queue [data-qrefile="${C.id}|pfail"]`).click(); await p.waitForTimeout(800);
  ok("Retry filing retries, and says it worked", refiled === 1 && /Filed to SharePoint/.test(await p.locator(".toast").innerText()));
  await p.close();
}
// someone not on any event
{
  const p = await open("b.konkle@ongia.ca", "Barb Konkle", { width: 1440, height: 1000 });
  ok("a board member who is on no event has nothing in the queue (other events are view only)", /Nothing needs you right now/.test(await qtext(p)));
  ok("…and doesn't get the All / My events switch", (await p.locator("[data-qscope]").count()) === 0);
  ok("the events are still listed, marked view only", /view only/i.test(await p.locator("#upcoming").innerText()));
  await p.close();
}
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
