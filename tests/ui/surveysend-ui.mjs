// The public survey when sending fails (audit, 30 Oct 2026: the button used to reset with no word, so an attendee couldn't
// tell whether their answers went in). Now it says so above the button, in English or French, offers Try again, and every
// answer stays where it was. A failure the server explains shows its reason; one that's put right goes through.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const shift = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Survey Send ${T}`, city: "Toronto, ON", venue: "Hall", dayOne: shift(-3), lastDay: shift(-2), invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] }) })).event;
const set = await api(`/api/survey?event=${ev.id}`, { method: "PUT", body: JSON.stringify({ open: true, mode: "end", sendOn: shift(-1),
  sessions: [{ id: "sa", day: ev.dayOne, title: "Following the Money", titleFr: "Suivre l'argent", presenters: ["Jordan Avery"] }] }) });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1280, 900, "wide"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/f/${set.survey.token}?lang=en`, { waitUntil: "networkidle" }); await p.waitForTimeout(800);
  await p.locator('[data-star="sa.relevant"][data-v="4"]').click();
  // The connection drops as they press Send.
  let mode = "drop";
  await p.route("**/api/survey?t=*", (r) => r.request().method() !== "POST" ? r.continue()
    : mode === "drop" ? r.abort("internetdisconnected")
    : mode === "server" ? r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "The survey store is busy." }) }) : r.continue());
  await p.locator("#send").click(); await p.waitForTimeout(700);
  const note = () => p.locator("#problems [role=alert]");
  ok(`${tag}: a dropped connection says so above the button`, await note().count() === 1 && /couldn't send your answers/.test(await note().innerText()) && /still here/.test(await note().innerText()), await p.locator("#problems").innerText());
  ok(`${tag}: the button offers Try again, ready to press`, (await p.locator("#send").innerText()) === "Try again" && await p.locator("#send").isEnabled());
  ok(`${tag}: the answer given is still there`, await p.locator('[data-star="sa.relevant"][data-v="4"]').getAttribute("aria-checked") === "true");
  // Another answer, then French: the message stays, in French, and so does every answer.
  await p.locator('[data-star="sa.knowledge"][data-v="5"]').click(); await p.waitForTimeout(200);
  ok(`${tag}: answering more keeps the message`, await note().count() === 1);
  await p.locator("#lang").click(); await p.waitForTimeout(500);
  ok(`${tag}: in French it says it in French, and the answers are kept`, /Nous n'avons pas pu envoyer vos réponses/.test(await note().innerText()) && (await p.locator("#send").innerText()) === "Réessayer"
    && await p.locator('[data-star="sa.relevant"][data-v="4"]').getAttribute("aria-checked") === "true" && await p.locator('[data-star="sa.knowledge"][data-v="5"]').getAttribute("aria-checked") === "true", await p.locator("#problems").innerText());
  if (tag === "phone") await p.locator("#problems").screenshot({ path: D + "surveysend-failed-fr-phone.png" });
  await p.locator("#lang").click(); await p.waitForTimeout(500);
  // The server says why: its reason shows under the message.
  mode = "server";
  await p.locator("#send").click(); await p.waitForTimeout(700);
  ok(`${tag}: a refusal from the server shows its reason too`, /The survey store is busy/.test(await note().innerText()) && (await p.locator("#send").innerText()) === "Try again", await p.locator("#problems").innerText());
  // Back online: the send reaches the server, which asks for the answers still needed, and the failure message goes.
  mode = "through";
  await p.locator("#send").click(); await p.waitForTimeout(900);
  ok(`${tag}: once it gets through, the failure message is gone and the usual "still needed" note shows`, await note().count() === 0 && /still needed/.test(await p.locator("#problems").innerText()), await p.locator("#problems").innerText());
  ok(`${tag}: no sideways scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  ok(`${tag}: no page errors`, !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
