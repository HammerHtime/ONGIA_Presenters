import { getAttendees } from "./store.mjs";
import { onlineLinks } from "./welcome.mjs";
import { directory, agencyOf } from "./agencies.mjs";

/** Everyone coming to an event, as the certificates see them: checked in or not, their agency, sorted by last name. */
export async function peopleOf(event) {
  const list = await directory().catch(() => []);
  // Joining online, nobody scans a ticket: everyone registered for the online event counts as attending for their
  // certificate (Andrew 14 Nov 2026: "this goes out to virtual and inperson (both community and justice)").
  const online = onlineLinks(event);
  return (((await getAttendees(event.id)) ?? {}).people ?? [])
    .filter((p) => p.status === "ATTENDING" || p.checkedIn)
    .map((p) => ({ key: p.key || p.email, first: p.first ?? "", last: p.last ?? "", email: p.email ?? "", phone: p.phone ?? "", order: p.orderNumber ?? "", typed: p.asWix?.organization ?? p.organization ?? "",
      agency: agencyOf(p, list)?.name || String(p.organization ?? "").trim(), checkedIn: !!p.checkedIn || (online.has(p.wixEventId) && p.status === "ATTENDING"), virtual: online.has(p.wixEventId), status: p.status, group: p.group ?? "", source: p.source ?? "",
      name: [p.first, p.last].filter(Boolean).join(" ").trim() || (p.guestOf ? `Guest of ${p.guestOf}` : p.email) }))
    .sort((a, b) => (a.last || a.name).localeCompare(b.last || b.name) || a.first.localeCompare(b.first));
}
