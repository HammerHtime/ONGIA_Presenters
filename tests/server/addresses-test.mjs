// Who is behind the gap between registrations and food-allergy emails sent (Andrew 29 Oct 2026: "It says 380 emails sent
// out, but I know we have a lot more registered... tell me how many emails are duplicated").
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
delete process.env.RESEND_API_KEY; delete process.env.MS_MAIL_FROM;
const F = REPO + "netlify/functions/";
const { putEvent, putAttendees } = await import(F + "lib/store.mjs");
const { readXlsx } = await import(F + "lib/xlsx.mjs");
const { replyStatus } = await import(F + "lib/reply.mjs");
const reply = (await import(F + "reply.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const ev = { id: "adr", title: "National Gang Summit", city: "Toronto, ON", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [] };
await putEvent(ev);
await putAttendees("adr", { people: [
  { key: "1", first: "Ari", last: "Lane", email: "ari@example.ca", organization: "Peel Police", status: "ATTENDING", sent: ["reply"] },
  { key: "2", first: "Pat", last: "Coordinator", email: "training@agency.example.ca", organization: "Agency", status: "ATTENDING", sent: ["reply"] },
  { key: "3", first: "Sam", last: "Officer", email: "training@agency.example.ca", organization: "Agency", status: "ATTENDING" },
  { key: "4", first: "Lee", last: "Officer", email: "training@agency.example.ca", organization: "Agency", status: "ATTENDING" },
  { key: "5", first: "Kim", last: "Two", email: "kim@example.ca", organization: "OPP", status: "ATTENDING" },
  { key: "6", first: "Jo", last: "Two", email: "kim@example.ca", organization: "OPP", status: "ATTENDING" },
  { key: "7", first: "Nadia", last: "Noemail", email: "", organization: "CBSA", status: "ATTENDING" },
  { key: "8", first: "Omar", last: "Typo", email: "omar@example", organization: "RCMP", status: "ATTENDING" },
  { key: "9", first: "Gone", last: "Away", email: "training@agency.example.ca", organization: "Agency", status: "NOT_ATTENDING" }] });

const res = await reply(new Request("http://x/api/reply?event=adr&sheet=addresses", { headers: { "x-admin-key": "testkey" } }));
ok("it downloads as Excel, even before the food-allergy email is set up", res.status === 200 && /shared-addresses\.xlsx/.test(res.headers.get("content-disposition") ?? ""), res.status);
const bytes = Buffer.from(await res.arrayBuffer());
if (process.env.KEEP_SHEETS) (await import("node:fs")).writeFileSync(process.env.KEEP_SHEETS + "/shared-addresses.xlsx", bytes);
const rows = readXlsx(bytes).map((r) => r.map((c) => String(c ?? "")));
const flat = rows.map((r) => r.join(" | ")).join("\n");
ok("each shared address is listed once, with how many registered at it", /training@agency\.example\.ca \| 3/.test(flat) && /kim@example\.ca \| 2/.test(flat), flat);
ok("with everyone registered under it, by name", ["Pat", "Sam", "Lee", "Kim", "Jo"].every((n) => flat.includes(n)));
ok("someone not coming is left out", !flat.includes("Gone"));
ok("an address only one person uses is not listed", !flat.includes("ari@example.ca"));
ok("registrations with no address, or one that isn't an address, are listed after", /No email address \| .*Nadia/.test(flat) && /Not an email address: omar@example \| .*Omar/.test(flat));
ok("it says whether that address got the food-allergy email", /training@agency\.example\.ca \| 3 \| [^\n]*\| Yes/.test(flat) && /kim@example\.ca \| 2 \| [^\n]*\| No/.test(flat), flat);
ok("the totals underneath: 8 coming go to 3 addresses", /8 registrations coming go to 3 email addresses\./.test(flat));
ok("2 addresses shared by 5 registrations, so 3 don't get an email of their own", /2 addresses are shared by 5 registrations, so 3 registrations don't get an email of their own\./.test(flat), flat);
ok("2 with no usable email", /2 registrations have no usable email address, so they can't be emailed at all\./.test(flat), flat);
ok("the biggest group first, the address on every row, in two sections", flat.indexOf("training@agency") < flat.indexOf("kim@example") && (flat.match(/training@agency\.example\.ca \| 3/g) ?? []).length === 3
  && /Shared email addresses \(2\)/.test(flat) && /Registrations with no usable email address \(2\)/.test(flat), flat);
const st = await replyStatus(ev);
ok("and the numbers agree with the card: 8 registrations, 3 addresses, 2 with none, so 3 sharing", st.registrations === 8 && st.reaches === 3 && st.noEmail === 2 && st.registrations - st.noEmail - st.reaches === 3, JSON.stringify(st));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
