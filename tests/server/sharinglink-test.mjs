// A "Copy link" sharing link Microsoft won't open for the app (Andrew 19 Nov 2026) says what to paste instead, and the
// browser-bar address it suggests resolves to the folder's path.
process.env.MS_TENANT_ID = "t"; process.env.MS_CLIENT_ID = "c"; process.env.MS_CLIENT_SECRET = "s";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/oauth2/")) return new Response(JSON.stringify({ access_token: "x", expires_in: 3600 }), { status: 200 });
  if (u.includes("/shares/")) return new Response(JSON.stringify({ error: { code: "invalidRequest", message: "Share url does not point to a drive item or no permission to access it" } }), { status: 400 });
  return new Response("{}", { status: 404 });
};
const { resolveFolderInput } = await import("../../netlify/functions/lib/graph.mjs");
const bar = "https://ongia.sharepoint.com/sites/ONGIABoardMembersFiles/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FONGIABoardMembersFiles%2FShared%20Documents%2FONGIA%20Board%2FONGIA%20Training%2F2027%2FQuebec%20City%202027%2FPresenter%20Presentations&viewid=abc";
const r = await resolveFolderInput(bar);
ok("the browser-bar address gives the folder path", r.path === "ONGIA Board/ONGIA Training/2027/Quebec City 2027/Presenter Presentations", JSON.stringify(r));
let msg = "";
try { await resolveFolderInput("https://ongia.sharepoint.com/:f:/s/ONGIABoardMembersFiles/IgCG9wQeX-FtR4MBgldKUS-UAVurTlu8NDF9KFQ2cQrbXec"); } catch (e) { msg = e.message; }
ok("a refused Copy link says what to paste instead", /won't let the Briefing Room open a "Copy link" link/.test(msg) && /browser/.test(msg), msg);
ok("…without Microsoft's own words", !/invalidRequest|HTTP 400|\/shares\//.test(msg), msg);
ok("a plain path still works", (await resolveFolderInput("ONGIA Board/ONGIA Training/2027/Quebec City 2027/Presenter Presentations")).path.endsWith("Presenter Presentations"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
