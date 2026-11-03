// Which pages the browser may show inside another page (3 Nov 2026). Every page is sent with X-Frame-Options: DENY, so
// nobody can frame the site; the desk shows Expenses in a frame of its own, so /expenses also says frame-ancestors
// 'self'. Without that the desk's Expenses was a blank screen on the live site, while every local test passed: the
// local server doesn't send netlify.toml's headers. This reads the rules themselves.
import { readFileSync } from "node:fs";
const R = new URL("../../", import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const toml = readFileSync(R + "netlify.toml", "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");   // the rules, not the notes about them
// Each [[headers]] block: its path and its values.
const rules = toml.split(/^\[\[headers\]\]\s*$/m).slice(1).map((b) => ({ for: (b.match(/^\s*for\s*=\s*"([^"]+)"/m) ?? [])[1], body: b.split(/^\[(?!headers\.values)/m)[0] }));
const rule = (p) => rules.find((r) => r.for === p)?.body ?? "";
ok("every page: nobody may frame it", /X-Frame-Options\s*=\s*"DENY"/.test(rule("/*")));
for (const p of ["/expenses", "/expenses.html"]) ok(`${p}: the site's own pages may frame it (the desk's Expenses)`, /Content-Security-Policy\s*=\s*"frame-ancestors 'self'"/.test(rule(p)), rule(p));
ok("no other page is opened up", rules.filter((r) => /frame-ancestors/.test(r.body)).every((r) => ["/expenses", "/expenses.html"].includes(r.for)) && !/frame-ancestors[^"]*\*/.test(toml));
// The desk's frame points at the page those rules cover.
ok("the desk frames /expenses?desk=1, the path the rule is for", /<iframe id="expframe"[^>]*src="\/expenses\?desk=1"/.test(readFileSync(R + "public/admin.html", "utf8")));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
