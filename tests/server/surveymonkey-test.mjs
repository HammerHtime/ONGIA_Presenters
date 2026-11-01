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

// What gets pasted is not always just the token (1 Nov 2026: a masked "•••" copy, then a refused one).
const { cleanToken, tokenShape } = await import(REPO + "netlify/functions/lib/surveymonkey.mjs");
ok("spaces, a line break, quotes or 'Bearer ' around the token are dropped", cleanToken('  "Bearer abc-123"\n') === "abc-123" && cleanToken("bearer   xyz") === "xyz");
ok("a masked copy is described, not shown: it says how many characters are not letters or digits", /8 characters, 8 of them not letters/.test(tokenShape("••••••••")) && !tokenShape("••••••••").includes("•"));
ok("a token with spaces round it says so", /after removing spaces/.test(tokenShape(" abc ")) && /^3 characters/.test(tokenShape(" abc ")));
process.env.SURVEYMONKEY_TOKEN = "secret-value-0123";
const { listSurveys } = await import(REPO + "netlify/functions/lib/surveymonkey.mjs?fresh=1");
globalThis.fetch = async () => Response.json({ error: { message: "The authorization token provided was invalid." } }, { status: 401 });
const err = await listSurveys().then(() => null, (e) => e);
ok("a refused token's message gives its shape and where to copy it from, and never the token itself",
  err && /17 characters/.test(err.message) && /Access Token/.test(err.message) && !err.message.includes("secret-value-0123"), err?.message);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
