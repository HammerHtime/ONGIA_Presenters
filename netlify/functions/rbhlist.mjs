import { json, fail, requireAdmin, editGuard, adminWho } from "./lib/http.mjs";
import { getEvent, putEvent, getMeta, putMeta, getAttendees } from "./lib/store.mjs";
import { primeRoster } from "./lib/signature.mjs";
import { directory, agencyOf } from "./lib/agencies.mjs";
import { sendMail } from "./lib/mail.mjs";
import { fromMeContact } from "./lib/message.mjs";
import { RBH_LIST_KEY, dueOn, listPeople, countOf, listWorkbook, listMail, fileName } from "./lib/rbhlist.mjs";
import { disposition } from "./lib/filenames.mjs";

/**
 * The names and agencies list for RBH, before each RBH event (Andrew 23 Nov 2026). It goes only when Send is pressed.
 *
 *   GET  /api/rbhlist?event=…            who it goes to, when it's due, the list, and each time it was sent
 *   GET  /api/rbhlist?event=…&xlsx=1     the Excel file, as it would be attached
 *   POST /api/rbhlist?event=…&preview=1  the email as it would go
 *   POST /api/rbhlist?event=…&send=1     send it now (again, for an updated list)
 *   PUT  /api/rbhlist?to=1               { name, email } who at RBH gets it, for every RBH event
 */
export default async (req) => {
  await primeRoster();
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  if (url.searchParams.get("to")) {
    if (req.method !== "PUT") return fail("Not allowed.", 405);
    const b = await req.json().catch(() => ({}));
    const name = String(b.name ?? "").trim().replace(/\s+/g, " ").slice(0, 120), email = String(b.email ?? "").trim().toLowerCase();
    if (!name) return fail("Type their name.");
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) return fail("That email address doesn't look right.");
    await putMeta(RBH_LIST_KEY, { name, email, at: new Date().toISOString(), by: adminWho(req)?.email || "the desk key" });
    return json({ to: { name, email } });
  }
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  if (event.kind !== "rbh") return fail("This list is for RBH events.", 409);
  const to = await getMeta(RBH_LIST_KEY);
  const rows = await rowsOf(event);
  if (req.method === "GET") {
    if (url.searchParams.get("xlsx")) return new Response(listWorkbook(rows), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": disposition(fileName(event)), "cache-control": "no-store" } });
    const stored = await getAttendees(event.id);
    return json({ to: to ? { name: to.name, email: to.email } : null, due: dueOn(event), counts: countOf(rows), rows, syncedAt: stored?.syncedAt ?? null,
      sent: event.rbhList?.sent ?? [], failed: event.rbhList?.failed ?? null });
  }
  if (req.method !== "POST") return fail("Not allowed.", 405);
  const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
  const sign = fromMeContact();
  if (url.searchParams.get("preview")) return json(listMail({ event, rows, to: to ?? { name: "" }, sign }));
  if (!url.searchParams.get("send")) return fail("Send or preview?");
  if (!to?.email) return fail("Say who at RBH gets the list first.");
  if (!rows.length) return fail("Nobody is registered yet, so there's no list to send.");
  const mail = listMail({ event, rows, to, sign });
  const at = new Date().toISOString(), by = adminWho(req);
  const r = await sendMail({ to: to.email, cc: sign.email, replyTo: sign.email, ...mail,
    attachments: [{ filename: fileName(event), content: listWorkbook(rows), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }] })
    .catch((e) => ({ skipped: true, reason: e.message }));
  if (r?.skipped) {
    // A send that fails stays on the event, in red on its row, until one goes.
    await putEvent({ ...event, rbhList: { ...(event.rbhList ?? {}), failed: { at, error: String(r.reason ?? "It didn't go.").slice(0, 300) } } });
    return fail(`It didn't go: ${r.reason ?? "the mail service refused it"}.`, 502);
  }
  const c = countOf(rows);
  const sent = [...(event.rbhList?.sent ?? []), { at, to: to.email, toName: to.name, by: by?.name || "the desk key", people: c.people, named: c.named }];
  await putEvent({ ...event, rbhList: { sent, failed: null } });
  return json({ sent, counts: c });
};

async function rowsOf(event) {
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const list = await directory().catch(() => []);
  return listPeople((stored.people ?? []).map((p) => ({ ...p, agency: agencyOf(p, list)?.name ?? "" })));
}
