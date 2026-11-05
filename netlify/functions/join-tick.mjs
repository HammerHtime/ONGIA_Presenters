import { listEvents, getAttendees, putEvent } from "./lib/store.mjs";
import { onlineGroups, joinDue, joinPeople } from "./lib/joinreminder.mjs";
import { siteOrigin } from "./lib/nightly.mjs";

/**
 * Every 15 minutes: the reminder to those joining online, at its time (Andrew 5 Nov 2026: "two hours before virtual
 * event starts need to send out email with the log in info"). Quiet unless an online group's reminder is marked ready,
 * its time has come and someone is still owed it; then the sending is handed to attmail-send-background.
 * Unlike the welcome letter it doesn't wait on the attendee-emails switch: it goes only when Andrew marks it ready.
 */
export default async () => {
  const origin = siteOrigin();
  for (const event of (await listEvents()).filter((e) => !e.practice && e.joinReminder)) {
    for (const g of onlineGroups(event)) {
      if (!joinDue(event, g.key)) continue;
      const people = ((await getAttendees(event.id)) ?? {}).people ?? [];
      if (!joinPeople(event, g.key, people).owed.length) continue;
      // One send at a time per event (the same lock Send now uses), so two runs never email the same person.
      if (event.sendNow && Date.now() - Date.parse(event.sendNow.at) < 20 * 60 * 1000) continue;
      event.sendNow = { at: new Date().toISOString(), type: "join", key: g.key, by: "at its time", hop: 0 };
      await putEvent(event);
      try {
        const r = await fetch(`${origin}/api/attmail-send-background?event=${encodeURIComponent(event.id)}&type=join&key=${encodeURIComponent(g.key)}&auto=1`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
        console.log(`join reminder ${event.id} ${g.key}: started (${r.status})`);
      } catch (e) { console.log(`join reminder ${event.id} ${g.key}: not started: ${e.message}`); }
    }
  }
  return new Response("ok");
};

export const config = { schedule: "4,19,34,49 * * * *" };
