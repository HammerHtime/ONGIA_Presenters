import { json, fail, requireAdmin, text } from "./lib/http.mjs";
import { getEvent, getInbox, putInbox, getMeta, putMeta } from "./lib/store.mjs";
import { anthropicKey } from "./lib/contract.mjs";
import { UNFILED, inboxConfigured, inboxMailbox } from "./lib/inbox.mjs";
import { token } from "./lib/ids.mjs";

/**
 * The "From your email" card: what the night's read of Andrew's mail filed on an event.
 *
 *   GET  /api/inbox?event=…                  the event's items and how the last read went
 *   GET  /api/inbox?event=_unfiled           mail about events not on the desk yet
 *   PUT  /api/inbox?event=…&item=…           { status: "open" | "done" | "dismissed" } or { moveTo: <event id> }
 *   POST /api/inbox?event=…                  add a note of his own ({ who, note, kind: "you" | "them" })
 *   POST /api/inbox?run=1                    read the mailbox now, in the background
 */
const STALE_MS = 16 * 60 * 1000;
const STATUSES = new Set(["open", "done", "dismissed"]);

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);

  if (req.method === "POST" && url.searchParams.get("run")) return start(url.origin);

  const eventId = url.searchParams.get("event");
  if (!eventId) return fail("Which event?");
  if (eventId !== UNFILED && !(await getEvent(eventId))) return fail("No such event.", 404);

  if (req.method === "GET") return json(await status(eventId));

  const body = await req.json().catch(() => ({}));
  const box = (await getInbox(eventId)) ?? { items: [] };

  if (req.method === "POST") {
    const note = text(body.note, 240);
    if (!note) return fail("Say what needs doing.");
    box.items.push({
      id: token(8), kind: body.kind === "them" ? "them" : "you", who: text(body.who, 120), note, offer: null,
      guess: null, messageId: null, conversationId: null, subject: "", from: "", received: new Date().toISOString(),
      link: "", status: "open", addedAt: new Date().toISOString(), byHand: true,
    });
    await putInbox(eventId, { ...box, updatedAt: new Date().toISOString() });
    return json(await status(eventId), 201);
  }

  if (req.method === "PUT") {
    const item = box.items.find((x) => x.id === url.searchParams.get("item"));
    if (!item) return fail("That item is not on this event any more. Reload the page.", 404);
    if (body.moveTo !== undefined) {
      const to = text(body.moveTo, 80);
      if (to === eventId) return json(await status(eventId));
      if (to !== UNFILED && !(await getEvent(to))) return fail("No such event to move it to.", 404);
      const dest = (await getInbox(to)) ?? { items: [] };
      box.items = box.items.filter((x) => x !== item);
      dest.items.push({ ...item, guess: to === UNFILED ? item.guess : null, movedAt: new Date().toISOString() });
      await putInbox(to, { ...dest, updatedAt: new Date().toISOString() });
    } else {
      if (!STATUSES.has(body.status)) return fail("Status must be open, done or dismissed.");
      item.status = body.status;
      item.doneAt = body.status === "open" ? null : new Date().toISOString();
      item.closedAt = item.doneAt;
      item.doneBy = body.status === "open" ? null : "you";
      // Reopening a reply Claude judged finished means it was not: keep it open for good.
      if (body.status === "open" && item.replyCheck === "checked") item.stillToDo = true;
    }
    await putInbox(eventId, { ...box, updatedAt: new Date().toISOString() });
    return json(await status(eventId));
  }
  return fail("Method not allowed.", 405);
};

async function status(eventId) {
  const [box, meta, run] = await Promise.all([getInbox(eventId), getMeta("inbox"), getMeta("inboxrun")]);
  const running = run?.state === "running" && Date.now() - Date.parse(run.startedAt) < STALE_MS;
  const order = (x) => String(x.received ?? "");
  return {
    connected: inboxConfigured(),
    mailbox: inboxMailbox() || null,
    last: meta ? { at: meta.lastRunAt ?? null, read: meta.read ?? 0, added: meta.added ?? 0, errors: meta.errors ?? 0, lastError: meta.lastError ?? null } : null,
    running,
    runError: !running && run?.state === "failed" ? run.why : null,
    items: (box?.items ?? []).filter((x) => x.status !== "dismissed").sort((a, b) => order(b).localeCompare(order(a))),
  };
}

/** Mark a read as running and hand it to the background reader. */
async function start(origin) {
  if (!inboxConfigured()) return fail("No mailbox is connected for reading yet.", 409);
  if (!anthropicKey()) return fail("The desk has no Anthropic API key, so it cannot sort email.", 409);
  const run = await getMeta("inboxrun");
  if (run?.state === "running" && Date.now() - Date.parse(run.startedAt) < STALE_MS) return json({ running: true }, 202);
  await putMeta("inboxrun", { state: "running", startedAt: new Date().toISOString() });
  try {
    const r = await fetch(`${origin}/api/inbox-background`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
    if (r.status >= 400) throw new Error(`the reader answered ${r.status}`);
  } catch (e) {
    await putMeta("inboxrun", { state: "failed", why: `The email read could not be started (${e.message}).`, at: new Date().toISOString() });
    return fail("The email read could not be started. Try again in a minute.", 502);
  }
  return json({ running: true }, 202);
}
