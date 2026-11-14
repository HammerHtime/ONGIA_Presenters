// Claude's read of the survey runs in the background (the Summit, 14 Nov 2026: "I get an error read 504").
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.env.APP_URL = "https://events.example.org";
delete process.env.ANTHROPIC_API_KEY;
const started = [];
globalThis.fetch = async (url) => {
  if (String(url).includes("/api/survey-analyse-background")) { started.push(String(url)); return new Response(null, { status: 202 }); }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const { putEvent, getEvent } = await import(F + "lib/store.mjs");
const survey = (await import(F + "survey.mjs")).default;
const bg = (await import(F + "survey-analyse-background.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };

await putEvent({ id: "ngs", title: "Summit", dayOne: "2026-11-09", lastDay: "2026-11-12", survey: { token: "tok1234567890abcd", open: true, mode: "end", sessions: [] } });
const r = await survey(new Request("http://x/api/survey?event=ngs&analyse=1", { method: "POST", headers: H, body: "{}" }));
const b = await r.json();
ok("Ask Claude answers at once: started on the server, not read in the request", r.status === 200 && b.started && started.length === 1 && /event=ngs/.test(started[0]), JSON.stringify(b));
ok("the event says a read is under way", (await getEvent("ngs")).survey.reading?.state === "running");
const res = await (await survey(new Request("http://x/api/survey?event=ngs&results=1", { headers: H }))).json();
ok("the results say so too, for the page to wait on", res.reading?.state === "running");
ok("the background needs the desk key", (await bg(new Request("http://x/api/survey-analyse-background?event=ngs", { method: "POST" }))).status === 401);
// No key here, and no answers: the read fails, and says why on the event, for the page to show.
await bg(new Request("http://x/api/survey-analyse-background?event=ngs", { method: "POST", headers: H }));
const ev = await getEvent("ngs");
ok("a read that fails is recorded with the reason, and nothing else on the survey is lost", ev.survey.reading?.state === "failed" && /API key|no answers/.test(ev.survey.reading.why) && ev.survey.token === "tok1234567890abcd", JSON.stringify(ev.survey.reading));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
