// The MC's introductions (Andrew 12 Nov 2026: "summarize bios and summarize presentation outline so this could be used
// for the MC to introduce the presenters"). Claude's part is stood in for; the rest is the real code.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const { putEvent, getEvent, putPresenter } = await import(F + "lib/store.mjs");
const MC = await import(F + "lib/mcintro.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

await putEvent({ id: "vic", title: "Western Symposium: Organized Crime", dayOne: "2026-11-24", lastDay: "2026-11-25",
  survey: { token: "t", sessions: [
    { id: "s2", day: "2026-11-25", title: "Tobacco", presenters: ["Sam Lee", "Jo Ray"] },
    { id: "s1", day: "2026-11-24", title: "Gangs in BC", presenters: ["Ana Diaz"] },
    { id: "pan", day: "2026-11-25", title: "Panel", presenters: ["Panel speakers"] },
  ] } });
const sub = (talk, bio, outline) => ({ talk, bio, outline, phone: "1" });
await putPresenter({ id: "a", eventId: "vic", first: "Ana", last: "Diaz", organization: "CFSEU-BC", status: "approved", submission: sub("Gangs in BC", "Ana has led gang units for 12 years.", "Trends and cases.") });
await putPresenter({ id: "b", eventId: "vic", first: "Sam", last: "Lee", organization: "RCMP", status: "submitted", submission: sub("Tobacco", "Sam investigates contraband.", "Supply chains.") });
await putPresenter({ id: "c", eventId: "vic", first: "Jo", last: "Ray", organization: "RCMP", status: "invited" });
await putPresenter({ id: "d", eventId: "vic", first: "Kim", last: "Fox", organization: "Law firm", status: "approved", submission: sub("Online fakes", "Kim is a lawyer.", "Takedowns.") });
await putPresenter({ id: "e", eventId: "vic", first: "Old", last: "One", status: "withdrawn", submission: sub("Gone", "x", "y") });

const { listPresenters } = await import(F + "lib/store.mjs");
let ev = await getEvent("vic");
let V = MC.mcView(ev, await listPresenters("vic"));
ok("in the program's order: day 1, day 2, then a presenter added since", V.sessions.map((s) => s.id).join() === "s1,s2,pan,pd", JSON.stringify(V.sessions.map((s) => s.id)));
ok("co-presenters share one session", V.sessions[1].presenters.map((p) => p.name).join() === "Sam Lee,Jo Ray");
ok("3 of 4 agreements in (the withdrawn one doesn't count)", V.submitted === 3 && V.total === 4, `${V.submitted}/${V.total}`);

// Claude, stood in: records what it was given.
let given = null;
const client = { messages: { create: async (req) => { given = JSON.parse(req.messages[0].content.replace(/^The sessions:\n/, ""));
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ intros: given.map((s) => ({ id: s.id, text: `Please welcome ${s.presenters.map((p) => p.name).join(" and ")}.`, check: s.presenters.some((p) => !p.bio) ? "No bio sent for one presenter" : "" })) }) }] }; } } };
const sessions = MC.mcSessions(ev, await listPresenters("vic"));
const d = await MC.draftIntros(sessions, { client });
ok("Claude is given the bio and outline of those whose agreement is in", given[0].presenters[0].bio.includes("12 years") && given[0].outline === "Trends and cases.");
ok("and nothing for someone only invited", given[1].presenters[1].bio === "" && given[1].outline === "Supply chains.");
ok("an intro for each session, with what to check", Object.keys(d).length === 4 && d.s2.check && !d.s1.check);

ev.mcIntros = Object.fromEntries(Object.entries(d).map(([id, x]) => [id, { ...x, by: "claude", at: "2026-11-12T00:00:00Z" }]));
await putEvent(ev);
V = MC.mcView(ev, await listPresenters("vic"));
ok("drafted, none out of date", V.sessions.every((s) => s.intro && !s.intro.stale));
// Sam changes his bio: his session's intro is out of date; the others aren't.
await putPresenter({ id: "b", eventId: "vic", first: "Sam", last: "Lee", organization: "RCMP", status: "submitted", submission: sub("Tobacco", "Sam has investigated contraband for 20 years.", "Supply chains.") });
V = MC.mcView(ev, await listPresenters("vic"));
ok("a changed bio makes that intro out of date", V.sessions.find((s) => s.id === "s2").intro.stale && !V.sessions.find((s) => s.id === "s1").intro.stale);

ok("a session nobody sent a bio for is marked No bio", V.sessions.find((s) => s.id === "pan").noBio && !V.sessions.find((s) => s.id === "s2").noBio);
// The endpoint: PUT an edit, then the PDF.
const fn = (await import(F + "mcintros.mjs")).default;
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const put = await fn(new Request("http://x/api/mcintros?event=vic", { method: "PUT", headers: H, body: JSON.stringify({ id: "s1", text: "Our first speaker, Ana Diaz." }) }));
const pv = await put.json();
ok("an edit is kept as edited, and never shows out of date", put.status === 200 && pv.sessions[0].intro.by === "edited" && pv.sessions[0].intro.text === "Our first speaker, Ana Diaz.");
ok("an unknown session is refused", (await fn(new Request("http://x/api/mcintros?event=vic", { method: "PUT", headers: H, body: JSON.stringify({ id: "zz", text: "x" }) }))).status === 404);
const pdf = await fn(new Request("http://x/api/mcintros?event=vic&pdf=1", { headers: H }));
const bytes = Buffer.from(await pdf.arrayBuffer());
ok("the MC script is a PDF named for the event", pdf.status === 200 && bytes.subarray(0, 4).toString() === "%PDF" && /western-symposium-mc-script\.pdf/.test(pdf.headers.get("content-disposition")));
const { writeFile } = await import("node:fs/promises");
const { execFileSync } = await import("node:child_process");
await writeFile((await import("node:os")).tmpdir() + "/mc-test.pdf", bytes);
let txt = ""; try { txt = execFileSync("pdftotext", ["-layout", (await import("node:os")).tmpdir() + "/mc-test.pdf", "-"]).toString(); } catch {}
if (txt) {
  ok("the script says No bio for the panel, not Claude's draft", /Panel speakers[\s\S]*No bio\./.test(txt) && !/Please welcome Panel speakers/.test(txt), txt);
  ok("and marks a co-presenter with no bio", /Jo Ray \(no bio\)/.test(txt));
}
const redo = await fn(new Request("http://x/api/mcintros?event=vic&draft=1&id=pan", { method: "POST", headers: H, body: "{}" }));
ok("drafting a no-bio session by name is refused, nothing to draft from", redo.status === 409);
if (process.env.MC_PDF_OUT) await writeFile(process.env.MC_PDF_OUT, bytes);
ok("no key, no access", (await fn(new Request("http://x/api/mcintros?event=vic"))).status === 401);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
