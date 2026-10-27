// The food-allergy email sent on the server (Andrew 27 Oct 2026: "it's still spinning and sending emails. It's been 25
// min … times out or failed"). Send starts a background run that takes the whole list, so a closed page cannot stop it;
// a second press while it goes does not start another; if the run cannot start, a batch goes from the page as before.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
process.env.ADMIN_KEY = "testkey";
delete process.env.MS_MAIL_FROM;
const F = REPO + "netlify/functions/";
const sent = [];
let background = "run";   // "run": the background function runs; "down": it cannot be reached
const runner = (await import(F + "reply-send-background.mjs")).default;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.resend.com/")) { sent.push(String(JSON.parse(init.body).to)); return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200, headers: { "content-type": "application/json" } }); }
  if (u.includes("/api/reply-send-background")) {
    if (background === "down") return new Response("no", { status: 502 });
    await runner(new Request(u, init));
    return new Response(null, { status: 202 });
  }
  throw new Error("unexpected fetch " + u);
};
const { putEvent, getEvent, putAttendees, getAttendees } = await import(F + "lib/store.mjs");
const reply = (await import(F + "reply.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, method = "GET", body) => { const r = await reply(new Request(`http://x/api/reply?${qs}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, body: await r.json() }; };

await putEvent({ id: "ngs", title: "National Gang Summit", city: "Toronto", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], attendeeMail: true });
await putAttendees("ngs", { people: [
  ...["a", "b", "c", "d"].map((k) => ({ key: k, first: k.toUpperCase(), email: `${k}@example.ca`, status: "ATTENDING" })),
  { key: "e1", first: "Ed", email: "shared@example.ca", status: "ATTENDING" }, { key: "e2", first: "Eve", email: "shared@example.ca", status: "ATTENDING" }] });
const setup = await call("event=ngs", "PUT", {});
ok("the questions are set up", setup.status === 200 && !!setup.body.reply, JSON.stringify(setup.body).slice(0, 200));

const out = await call("event=ngs&send=1", "POST", {});
ok("Send hands the whole list to the server and answers at once", out.status === 200 && out.body.started === true, JSON.stringify(out.body).slice(0, 300));
ok("the server run sends to every address, once each (the shared address once)", sent.length === 5 && new Set(sent).size === 5, JSON.stringify(sent));
const e = await getEvent("ngs");
ok("when it is done the event no longer says it is sending, and says how it went", !e.replySending && e.replyLastSend && !e.replyLastSend.error && e.replyLastSend.left === 0, JSON.stringify({ s: e.replySending, l: e.replyLastSend }));
const shown = (await call("event=ngs")).body;
ok("the card shows everyone has it, and nothing sending", shown.status.had === 5 && shown.status.toSend === 0 && shown.sending === null, JSON.stringify(shown.status));

// A press while a run is going does not start a second one.
const busy = await getEvent("ngs"); busy.replySending = { at: new Date().toISOString(), hop: 0 }; await putEvent(busy);
await putAttendees("ngs", { ...(await getAttendees("ngs")), people: [...(await getAttendees("ngs")).people, { key: "f", first: "Fay", email: "f@example.ca", status: "ATTENDING" }] });
const again = await call("event=ngs&send=1", "POST", {});
ok("pressing Send again while it sends only says so", again.body.started && again.body.already && sent.length === 5);
ok("and the card shows it sending", (await call("event=ngs")).body.sending?.hop === 0);

// A run left marked as sending for over 20 minutes (it died) does not lock Send for good.
const stale = await getEvent("ngs"); stale.replySending = { at: new Date(Date.now() - 25 * 60 * 1000).toISOString(), hop: 0 }; await putEvent(stale);
await call("event=ngs&send=1", "POST", {});
ok("a stale run does not block a new one: the newcomer gets it", sent.includes("f@example.ca") && sent.length === 6);

// If the server run cannot be started, a batch goes from the page as before.
await putAttendees("ngs", { ...(await getAttendees("ngs")), people: [...(await getAttendees("ngs")).people, { key: "g", first: "Gil", email: "g@example.ca", status: "ATTENDING" }] });
background = "down";
const fallback = await call("event=ngs&send=1", "POST", {});
ok("if the server run can't start, the page's batch sends instead", !fallback.body.started && fallback.body.sent === 1 && sent.includes("g@example.ca") && !(await getEvent("ngs")).replySending, JSON.stringify(fallback.body).slice(0, 200));

// The background run takes only the desk's key.
ok("the server run refuses anyone without the desk's key", (await runner(new Request("http://x/api/reply-send-background?event=ngs", { method: "POST" }))).status === 401);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
