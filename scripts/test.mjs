/**
 * The desk's tests, in one go:  npm test  [-- server | ui | <part of a file name>]
 *
 * 1. tests/server/*  in-process, against an in-memory stand-in for Netlify Blobs (tests/register.mjs).
 * 2. tests/ui/auth-ui.mjs  Microsoft sign-in end to end; it runs its own desk server and a stand-in Microsoft.
 * 3. tests/ui/*  the screens in Chromium, against the local desk server (port 8788) with a stand-in for Anthropic (8799).
 * Each test file prints "N passed, M failed" and exits non-zero on a failure; this adds them up.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const want = process.argv.slice(2).filter((a) => a !== "--");
const pick = (files, kind) => files.filter((f) => !want.length || want.includes(kind) || want.some((w) => f.includes(w)));
const list = (dir) => readdirSync(path.join(ROOT, dir)).filter((f) => /\.mjs$/.test(f) && !/^(mock-|fake-)/.test(f)).sort().map((f) => path.join(dir, f));
const env = { ...process.env, ADMIN_KEY: "testkey" };
delete env.RESEND_API_KEY; delete env.MS_MAIL_FROM; delete env.MS_TENANT_ID; delete env.MS_CLIENT_ID; delete env.MS_CLIENT_SECRET; delete env.WIX_API_KEY;

const results = [];
function run(file, args = [], extraEnv = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [...args, path.join(ROOT, file)], { cwd: ROOT, env: { ...env, ...extraEnv } });
    let out = "";
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 10 * 60 * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      const m = out.match(/(\d+) passed, (\d+) failed/g)?.at(-1)?.match(/(\d+) passed, (\d+) failed/);
      const r = { file, code, passed: m ? +m[1] : 0, failed: m ? +m[2] : 0, secs: Math.round((Date.now() - started) / 1000) };
      r.ok = code === 0 && !!m && r.failed === 0;
      results.push(r);
      console.log(`${r.ok ? "ok  " : "FAIL"} ${file}  ${m ? `${r.passed} passed, ${r.failed} failed` : "did not finish"}  (${r.secs}s)`);
      if (!r.ok) console.log(out.split("\n").filter((l) => /FAIL|Error|error:|at file|waiting for/.test(l)).slice(0, 12).map((l) => "     " + l).join("\n"));
      resolve(r);
    });
  });
}
const startServer = (file, extraEnv, args = []) => spawn(process.execPath, [path.join(ROOT, file), ...args], { cwd: ROOT, env: { ...env, ...extraEnv }, stdio: "ignore" });
async function waitFor(url) {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).status < 500) return true; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

const server = pick(list("tests/server"), "server");
const ui = pick(list("tests/ui"), "ui");
for (const f of server) await run(f, ["--import", path.join(ROOT, "tests/register.mjs")]);

let playwright = true;
if (ui.length) {
  try { await import(process.env.PLAYWRIGHT_MODULE || "playwright"); }
  catch { playwright = false; console.log("\nskipped the screen tests: Playwright is not installed here (see tests/README.md)"); }
}
if (playwright && ui.length) {
  const auth = ui.filter((f) => f.endsWith("auth-ui.mjs"));
  for (const f of auth) await run(f);                 // needs port 8799 for its stand-in Microsoft
  const rest = ui.filter((f) => !f.endsWith("auth-ui.mjs"));
  if (rest.length) {
    const mock = startServer("tests/ui/mock-anthropic.mjs", {});
    const desk = startServer("scripts/dev-server.mjs", { ANTHROPIC_BASE_URL: "http://127.0.0.1:8799", ANTHROPIC_API_KEY: "sk-test" }, ["8788"]);
    try {
      if (!(await waitFor("http://127.0.0.1:8788/admin.html"))) throw new Error("the local desk server did not start on port 8788 (is something else using it?)");
      for (const f of rest) await run(f);
    } catch (e) { console.log(`FAIL ${e.message}`); results.push({ file: "server start", ok: false, passed: 0, failed: 1 }); }
    finally { desk.kill(); mock.kill(); }
  }
}

const bad = results.filter((r) => !r.ok);
const total = results.reduce((n, r) => n + r.passed, 0);
console.log(`\n${results.length} files, ${total} checks passed${bad.length ? `; ${bad.length} file${bad.length === 1 ? "" : "s"} failed: ${bad.map((r) => r.file).join(", ")}` : ", nothing failed"}.`);
process.exit(bad.length ? 1 : 0);
