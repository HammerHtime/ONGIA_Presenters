// SurveyMonkey, read only (Andrew 1 Nov 2026): every survey with its dates and response count, in totals; the token is
// tried at each data centre until one answers.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey"; process.env.SURVEYMONKEY_TOKEN = "tok";
const seen = [];
const surveys = Array.from({ length: 130 }, (_, i) => ({ id: String(i), title: `Training survey ${i}`, date_created: `${2021 + (i % 5)}-05-0${1 + (i % 8)}T10:00:00`, response_count: 10 + (i % 7) }));
globalThis.fetch = async (url, init) => {
  seen.push(String(url));
  if (String(url).startsWith("https://api.surveymonkey.com/")) return Response.json({ error: { message: "Invalid access token" } }, { status: 401 });
  if (String(url).startsWith("https://api.surveymonkey.ca/v3/surveys")) {
    if (init.headers.authorization !== "Bearer tok") return Response.json({}, { status: 401 });
    const page = Number(new URL(url).searchParams.get("page"));
    return Response.json({ data: surveys.slice((page - 1) * 100, page * 100) });
  }
  throw new Error("unexpected fetch " + url);
};
const fn = (await import(REPO + "netlify/functions/surveymonkey.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const r = await fn(new Request("http://x/api/surveymonkey", { headers: { "x-admin-key": "testkey" } }));
const j = await r.json();
ok("finds the data centre that accepts the token (Canada here), after the US one refuses", r.status === 200 && j.dataCentre === "https://api.surveymonkey.ca", JSON.stringify({ status: r.status, dc: j.dataCentre, err: j.error }));
ok("reads every page of surveys (130)", j.surveys === 130 && j.list.length === 130);
ok("totals responses, and by year", j.responses === surveys.reduce((n, s) => n + s.response_count, 0) && Object.keys(j.years).length === 5, JSON.stringify(j.years));
ok("newest first", j.list[0].created >= j.list.at(-1).created);
ok("needs the admin key", (await fn(new Request("http://x/api/surveymonkey"))).status === 401);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
