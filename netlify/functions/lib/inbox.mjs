import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./contract.mjs";
import { graphAccessToken, graphGet, graphConfigured } from "./graph.mjs";
import { listEvents, getMeta, putMeta, getInbox, putInbox } from "./store.mjs";
import { formatDate, todayIso } from "./deadlines.mjs";
import { token } from "./ids.mjs";

/**
 * Andrew's email, filed against the event it is about.
 *
 * Each night the desk reads the day's mail in one mailbox (INBOX_MAILBOX,
 * president@ for now), in and out, and Claude says for each message which
 * event it belongs to and what, if anything, it asks of somebody:
 *   - "you":   someone needs something from ONGIA (a dietary need, a question,
 *              a room request, a hotel waiting on an answer);
 *   - "them":  Andrew asked somebody for something and is waiting;
 *   - "offer": a hotel's proposal for an event still being planned.
 * Only a short note in Claude's words is kept, with the sender, the date and
 * a link back to the message in Outlook. Email bodies are never stored.
 *
 * Whether Andrew has replied is worked out from the mailbox itself, not by
 * Claude: a later message from him in the same conversation marks a "you"
 * item replied, and an answer from them closes a "them" item. Andrew ticks
 * the rest off on the event page.
 *
 * Mail about something with no event on the desk yet lands in `inbox:_unfiled`
 * with Claude's guess at which event it is, so a new event is never missed.
 */

export const UNFILED = "_unfiled";
const MAX_BODY = 3000;          // characters of each message Claude sees
const BATCH = 8;                // messages per Claude call
const MAX_MESSAGES = 120;       // a night's ceiling, so a mailbox flood cannot run up the bill
const FIRST_LOOK_DAYS = 14;     // how far back the very first run reads: two weeks of offers and asks
const KEEP_SEEN_DAYS = 30;
const OPEN_WINDOW_DAYS = 45;    // how far back reply tracking looks
// Machines, not people: never worth a Claude call.
const NOISE = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|notifications?|news(letter)?|marketing)[@.+-]/i;

export const inboxMailbox = () => (process.env.INBOX_MAILBOX || "").trim().toLowerCase();
export const inboxConfigured = () => graphConfigured() && !!inboxMailbox();

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const OFFER = {
  type: "object",
  additionalProperties: false,
  required: ["hotel", "rate", "fbMinimum", "meetingRoom", "holdUntil", "notes"],
  properties: {
    hotel: { type: "string" },
    rate: nullable({ type: "string" }),
    fbMinimum: nullable({ type: "string" }),
    meetingRoom: nullable({ type: "string" }),
    holdUntil: nullable({ type: "string", format: "date" }),
    notes: nullable({ type: "string" }),
  },
};
export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["messages"],
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "event", "guess", "items"],
        properties: {
          n: { type: "integer" },
          event: nullable({ type: "string" }),
          guess: nullable({ type: "string" }),
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "who", "note", "offer"],
              properties: {
                kind: { type: "string", enum: ["you", "them", "offer"] },
                who: { type: "string" },
                note: { type: "string" },
                offer: nullable(OFFER),
              },
            },
          },
        },
      },
    },
  },
};

export const SYSTEM = `You sort the email of Andrew Hammond, President of ONGIA, a Canadian non-profit that runs training events on gangs and organized crime for police, corrections and community partners. For each message you are given, decide which of ONGIA's events it is about and what it asks of somebody, so nothing slips through.

Events: you are given the list of events on ONGIA's desk, each with an id. Set "event" to the id the message is about, or null if it is about none of them. If it is about an ONGIA training event that is NOT on the list (for example a 2027 event still being planned), set "event" to null and "guess" to a short name for it, like "Moncton, March 2027". Otherwise "guess" is null.

Items: list what the message asks of somebody, at most three. Leave "items" empty for anything that needs nothing: newsletters, receipts, automatic notices, thank-yous, FYIs, and mail with no link to an ONGIA event.
- kind "you": someone needs something from Andrew or ONGIA. Examples: a dietary need or allergy the caterer must know, an accessibility need, arrival and departure dates for the rooming list, a registration change or substitution, an invoice to pay, a question, a hotel or venue waiting on a decision.
- kind "them": only for a message FROM Andrew: something he asked somebody else to do or send, which he is now waiting on.
- kind "offer": a hotel or venue's offer or proposal for an event. Fill "offer" with the hotel's name, the room rate, the food and beverage minimum, the meeting room cost and the date the offer is held until (YYYY-MM-DD), exactly as stated; null for anything not stated. Never guess a number. For other kinds "offer" is null.
"who" is the person and their organization, e.g. "David Bernier, OPP". "note" is one short line in your own words saying what needs doing, e.g. "Eats no grains (no wheat, rice, pasta or bread). Tell the caterer." Never copy the email's text.

Rules:
- Never include details of an investigation, intelligence, an informant or source, or anything under a publication ban. Never include anything that identifies a victim, a trafficking survivor or a minor. If a message contains material like that, give one "you" item whose note is exactly "Sensitive. Read it yourself." and nothing else from it.
- A person's name with their dietary or accessibility need is fine: the hotel needs it.
- Return one entry for every message, with its "n".`;

/* ---------- Microsoft Graph ---------- */

/** The text of an email: Outlook sends HTML unless asked otherwise. */
export function textOf(content, type = "html") {
  let t = String(content ?? "");
  if (/html/i.test(type) || /<\/?(html|body|div|p|br|table|span)\b/i.test(t)) {
    t = t.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  }
  return t.replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const pick = (m) => ({
  id: m.id,
  conversationId: m.conversationId,
  subject: m.subject ?? "",
  from: { name: m.from?.emailAddress?.name ?? "", email: String(m.from?.emailAddress?.address ?? "").toLowerCase() },
  to: (m.toRecipients ?? []).concat(m.ccRecipients ?? []).map((r) => String(r.emailAddress?.address ?? "").toLowerCase()),
  at: m.receivedDateTime ?? m.sentDateTime ?? "",
  webLink: m.webLink ?? "",
  // Only what this message adds, not the thread quoted beneath it.
  body: textOf(m.uniqueBody?.content ?? m.body?.content ?? m.bodyPreview ?? "", (m.uniqueBody ?? m.body)?.contentType),
});

/** Every message in the mailbox since `sinceIso`, in and out, newest first; `full` adds the text body. */
async function messagesSince(get, mailbox, sinceIso, { full = false, cap = 1000 } = {}) {
  const select = ["id", "conversationId", "subject", "from", "toRecipients", "ccRecipients", "receivedDateTime", "sentDateTime", "webLink", "isDraft"]
    .concat(full ? ["uniqueBody"] : []).join(",");
  let path = `/users/${encodeURIComponent(mailbox)}/messages?$filter=receivedDateTime ge ${sinceIso} and isDraft eq false`
    + `&$select=${select}&$orderby=receivedDateTime desc&$top=50`;
  const out = [];
  while (path && out.length < cap) {
    const page = await get(path);
    out.push(...(page.value ?? []).map(pick));
    const next = page["@odata.nextLink"];
    path = next ? next.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, "") : null;
  }
  return out.slice(0, cap);
}

/* ---------- Claude ---------- */

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function eventsBrief(events) {
  return events.map((e) => `- ${e.id}: ${e.title} — ${e.city}, ${e.dayOne === e.lastDay || !e.lastDay ? formatDate(e.dayOne) : `${formatDate(e.dayOne)} to ${formatDate(e.lastDay)}`}${e.venue ? `, ${e.venue}` : ""}`).join("\n");
}

function messageBrief(m, n, mailbox) {
  const out = m.from.email === mailbox;
  return `<message n="${n}">
${out ? "FROM Andrew" : `From: ${m.from.name} <${m.from.email}>`}${out ? `\nTo: ${m.to.slice(0, 6).join(", ")}` : ""}
Date: ${String(m.at).slice(0, 10)}
Subject: ${clip(m.subject, 200)}

${String(m.body).replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_BODY)}
</message>`;
}

/** Ask Claude about one batch. Returns the raw `messages` array. `client` is for tests. */
export async function triageBatch(batch, events, mailbox, { client = null, today = todayIso() } = {}) {
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const stream = api.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Today is ${formatDate(today)}. ONGIA's events on the desk:\n${eventsBrief(events) || "(none)"}\n\nThe messages:\n\n${batch.map((m, i) => messageBrief(m, i + 1, mailbox)).join("\n\n")}`,
    }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw Object.assign(new Error("Claude declined to sort this batch of email."), { refused: true });
  if (message.stop_reason === "max_tokens") throw new Error("Claude's answer about this batch of email was cut off.");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try { return JSON.parse(text).messages ?? []; } catch { throw new Error("Claude's answer about this batch of email could not be read."); }
}

/** One raw answer turned into the items the desk keeps. Nothing Claude made up survives. */
export function itemsFrom(answer, msg, eventIds, now = new Date().toISOString()) {
  const event = eventIds.has(answer?.event) ? answer.event : UNFILED;
  const guess = event === UNFILED ? clip(answer?.guess, 80) || null : null;
  return (Array.isArray(answer?.items) ? answer.items : []).slice(0, 3)
    .filter((it) => ["you", "them", "offer"].includes(it?.kind) && clip(it.note, 240))
    .map((it) => {
      const o = it.kind === "offer" && it.offer ? it.offer : null;
      return {
        event,
        item: {
          id: token(8),
          kind: it.kind,
          who: clip(it.who, 120) || msg.from.name || msg.from.email,
          note: clip(it.note, 240),
          offer: o && clip(o.hotel, 120) ? {
            hotel: clip(o.hotel, 120), rate: clip(o.rate, 120) || null, fbMinimum: clip(o.fbMinimum, 120) || null,
            meetingRoom: clip(o.meetingRoom, 160) || null, holdUntil: isDate(o.holdUntil) ? o.holdUntil : null, notes: clip(o.notes, 240) || null,
          } : null,
          guess,
          messageId: msg.id,
          conversationId: msg.conversationId,
          subject: clip(msg.subject, 160),
          from: msg.from.name || msg.from.email,
          received: msg.at,
          link: /^https:\/\/outlook\.office(365)?\.com\//.test(msg.webLink) ? msg.webLink : "",
          status: "open",
          addedAt: now,
        },
      };
    });
}

/* ---------- reply tracking ---------- */

/**
 * Work out from the mailbox who has answered whom. A "you" item gets
 * `repliedAt` once Andrew writes in that conversation after it arrived, and is
 * queued for checkReplies, which reads his reply and decides whether it did the
 * whole job (answering David is not telling the caterer). A "them" item closes
 * itself when someone else writes back.
 */
export function trackReplies(items, mail, mailbox) {
  const byConv = new Map();
  for (const m of mail) {
    if (!m.conversationId) continue;
    if (!byConv.has(m.conversationId)) byConv.set(m.conversationId, []);
    byConv.get(m.conversationId).push(m);
  }
  let changed = 0;
  for (const it of items) {
    if (it.status !== "open" || !it.conversationId) continue;
    const later = (byConv.get(it.conversationId) ?? []).filter((m) => String(m.at) > String(it.received));
    if (it.kind === "you" && !it.repliedAt) {
      const mine = later.filter((m) => m.from.email === mailbox).sort((a, b) => String(a.at).localeCompare(String(b.at)))[0];
      if (mine) { it.repliedAt = mine.at; it.replyId = mine.id; it.replyCheck = "pending"; changed++; }
    }
    if (it.kind === "them") {
      const theirs = later.filter((m) => m.from.email && m.from.email !== mailbox).sort((a, b) => String(a.at).localeCompare(String(b.at)))[0];
      if (theirs) { it.status = "done"; it.doneAt = theirs.at; it.closedAt = new Date().toISOString(); it.doneBy = `${theirs.from.name || theirs.from.email} replied`; changed++; }
    }
  }
  return changed;
}

/* ---------- did his reply do the job? ---------- */

export const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["checks"],
  properties: {
    checks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "done", "remaining"],
        properties: { n: { type: "integer" }, done: { type: "boolean" }, remaining: nullable({ type: "string" }) },
      },
    },
  },
};

export const REPLY_SYSTEM = `Andrew Hammond, President of ONGIA (a Canadian non-profit that runs training events), keeps a to-do list made from his email. For each item you are given the to-do and the reply Andrew later wrote in that conversation, with who it went to. Decide whether his reply finished the job.

- "done": true only if the reply itself does everything the to-do asks: he answered the question, confirmed, agreed, declined, or sent what was asked for.
- If the to-do needs something done with someone else (tell the caterer or the hotel, add a person to the rooming list, pay an invoice) and the reply does not show it was done (that person copied, or Andrew saying he has done it), "done" is false.
- A reply that only says he will look into it, or thanks them, is not done.
- When "done" is false, "remaining" is one short line in your own words saying what is still to do, like "Tell the caterer: no grains." When "done" is true, "remaining" is null.
- Never include details of an investigation, intelligence, an informant, or anything that identifies a victim, a trafficking survivor or a minor.
Return one entry for every item, with its "n".`;

/** Ask Claude about a batch of { item, reply } pairs. `client` is for tests. */
export async function checkReplies(pairs, { client = null } = {}) {
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const brief = pairs.map(({ item, reply }, i) => `<item n="${i + 1}">
To-do: ${item.who ? `${item.who}: ` : ""}${item.note}
Andrew's reply, to ${reply.to.slice(0, 6).join(", ") || "(not shown)"}, on ${String(reply.at).slice(0, 10)}:
${String(reply.body).trim().slice(0, 1500) || "(empty)"}
</item>`).join("\n\n");
  const stream = api.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: REPLY_SCHEMA } },
    system: REPLY_SYSTEM,
    messages: [{ role: "user", content: brief }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("Claude declined to check these replies.");
  if (message.stop_reason === "max_tokens") throw new Error("Claude's answer about these replies was cut off.");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try { return JSON.parse(text).checks ?? []; } catch { throw new Error("Claude's answer about these replies could not be read."); }
}

/** One answer applied to its item. Returns true when it changed. */
export function applyReplyCheck(item, answer) {
  if (!answer || typeof answer.done !== "boolean") return false;
  item.replyCheck = "checked";
  if (answer.done) {
    item.status = "done";
    item.doneAt = item.repliedAt;
    item.closedAt = new Date().toISOString();
    item.doneBy = "your reply";
  } else {
    const left = clip(answer.remaining, 240);
    if (left) { item.wasNote = item.wasNote ?? item.note; item.note = left; }
    item.stillToDo = true;
  }
  return true;
}

/* ---------- the night's run ---------- */

const daysAgo = (n, now = Date.now()) => new Date(now - n * 86400000).toISOString();

/**
 * Read what is new, sort it, file it, and update who has replied.
 * `get` and `client` are for tests; `deadline` stops new Claude calls in time.
 */
export async function runInbox({ get = null, client = null, deadline = null, now = Date.now() } = {}) {
  const mailbox = inboxMailbox();
  if (!inboxConfigured()) return { skipped: true, reason: "No mailbox is set to read (INBOX_MAILBOX), or Microsoft 365 is not connected." };
  const at = new Date(now).toISOString();
  let graphGetter = get;
  if (!graphGetter) { const tok = await graphAccessToken(); graphGetter = (p) => graphGet(tok, p); }

  const state = (await getMeta("inbox")) ?? {};
  const seen = state.seen ?? {};
  // Pick up where the last read left off. Anything it could not sort (Claude
  // failed, or the night ran out of time) is still unseen and is read again.
  const since = state.backlogFrom
    ?? (state.lastRunAt ? new Date(Date.parse(state.lastRunAt) - 6 * 3600000).toISOString() : daysAgo(FIRST_LOOK_DAYS, now));

  // Everything since the last look, with bodies, for Claude.
  const fresh = (await messagesSince(graphGetter, mailbox, since, { full: true, cap: 400 }).catch((e) => {
    if (e.status === 401 || e.status === 403) throw new Error(`The desk is not allowed to read ${mailbox} yet. It needs the Mail.Read permission in Microsoft 365, limited to that mailbox.`);
    if (e.status === 404) throw new Error(`Microsoft 365 has no mailbox called ${mailbox}. Check INBOX_MAILBOX in Netlify.`);
    throw e;
  }))
    .filter((m) => !seen[m.id] && !NOISE.test(m.from.email))
    .reverse()                                   // oldest first, so a reply follows what it answers
    .slice(0, MAX_MESSAGES);

  const upcoming = (await listEvents()).filter((e) => String(e.lastDay || e.dayOne) >= daysAgo(30, now).slice(0, 10));
  const ids = new Set(upcoming.map((e) => e.id));

  const filed = new Map();   // event id -> new items
  let read = 0, errors = 0, declined = 0, lastError = null;
  for (let i = 0; i < fresh.length; i += BATCH) {
    if (deadline && Date.now() > deadline) break;
    const batch = fresh.slice(i, i + BATCH);
    const file = (m, a) => {
      for (const { event, item } of itemsFrom(a, m, ids, at)) {
        if (!filed.has(event)) filed.set(event, []);
        filed.get(event).push(item);
      }
      seen[m.id] = at;
      read++;
    };
    let answers;
    try { answers = await triageBatch(batch, upcoming, mailbox, { client, today: at.slice(0, 10) }); }
    catch (e) {
      if (!e.refused) { errors++; lastError = e.message; console.log(`inbox: batch failed: ${e.message}`); continue; }
      // A decline is about one message, not the batch: sort them one at a time.
      // The one Claude still will not sort goes on the list for Andrew to read
      // himself (usually law-enforcement material), and is never retried.
      for (const m of batch) {
        if (deadline && Date.now() > deadline) break;
        try {
          const one = await triageBatch([m], upcoming, mailbox, { client, today: at.slice(0, 10) });
          file(m, one.find((x) => x?.n === 1));
        } catch (e2) {
          if (!e2.refused) { errors++; lastError = e2.message; continue; }
          file(m, { event: null, guess: null, items: [{ kind: "you", who: m.from.name || m.from.email, note: "Could not be sorted automatically. Read it yourself.", offer: null }] });
          declined++;
        }
      }
      continue;
    }
    batch.forEach((m, k) => file(m, answers.find((x) => x?.n === k + 1)));
  }

  // Reply tracking reads the whole window once, without bodies.
  const keys = new Set([...upcoming.map((e) => e.id), UNFILED]);
  const boxes = new Map(await Promise.all([...keys].map(async (k) => [k, (await getInbox(k)) ?? { items: [] }])));
  for (const [k, list] of filed) {
    const box = boxes.get(k) ?? { items: [] };
    // One message, one note per kind: a re-read never doubles an item.
    const have = new Set(box.items.map((x) => `${x.messageId}|${x.kind}|${x.offer?.hotel ?? ""}`));
    for (const it of list) if (!have.has(`${it.messageId}|${it.kind}|${it.offer?.hotel ?? ""}`)) box.items.push(it);
    boxes.set(k, box);
  }
  const open = [...boxes.values()].flatMap((b) => b.items).filter((x) => x.status === "open");
  let replied = 0;
  if (open.length) {
    const oldest = open.map((x) => String(x.received)).sort()[0];
    const from = oldest > daysAgo(OPEN_WINDOW_DAYS, now) ? oldest : daysAgo(OPEN_WINDOW_DAYS, now);
    const mail = await messagesSince(graphGetter, mailbox, from, { cap: 2000 }).catch((e) => { console.log(`inbox: reply check skipped: ${e.message}`); return []; });
    for (const box of boxes.values()) replied += trackReplies(box.items, mail, mailbox);
  }
  // Read each new reply of his and decide whether it finished the item.
  const byId = new Map(fresh.map((m) => [m.id, m]));
  const waiting = [...boxes.values()].flatMap((b) => b.items)
    .filter((x) => x.status === "open" && x.kind === "you" && x.replyCheck === "pending" && x.replyId).slice(0, 30);
  let closed = 0;
  for (let i = 0; i < waiting.length; i += 10) {
    if (deadline && Date.now() > deadline) break;
    const pairs = [];
    for (const item of waiting.slice(i, i + 10)) {
      let reply = byId.get(item.replyId);
      if (!reply) {
        reply = await graphGetter(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(item.replyId)}?$select=id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,webLink,uniqueBody`)
          .then(pick).catch(() => null);
      }
      if (reply) pairs.push({ item, reply });
    }
    if (!pairs.length) continue;
    try {
      const answers = await checkReplies(pairs, { client });
      pairs.forEach(({ item }, k) => { if (applyReplyCheck(item, answers.find((a) => a?.n === k + 1)) && item.status === "done") closed++; });
    } catch (e) { errors++; lastError = e.message; console.log(`inbox: reply check failed: ${e.message}`); }
  }

  for (const [k, box] of boxes) if (box.items.length || filed.has(k)) await putInbox(k, { ...box, updatedAt: at });

  for (const [id, when] of Object.entries(seen)) if (when < daysAgo(KEEP_SEEN_DAYS, now)) delete seen[id];
  const added = [...filed.values()].reduce((n, l) => n + l.length, 0);
  const left = fresh.filter((m) => !seen[m.id]).map((m) => String(m.at)).sort();
  const summary = { lastRunAt: at, read, added, replied, closed, declined, errors, lastError, left: left.length, mailbox };
  await putMeta("inbox", { ...summary, backlogFrom: left.length ? new Date(Date.parse(left[0]) - 60000).toISOString() : null, seen });
  return summary;
}

/**
 * What the home page's to-do list needs: everything open, plus anything closed
 * in the last day, so a tick (his, or Claude reading his reply overnight) stays
 * on screen crossed out, with Undo, before it folds away.
 */
export function inboxForList(box, now = Date.now()) {
  const recent = (x) => x.status === "done" && x.closedAt && now - Date.parse(x.closedAt) < 86400000;
  return (box?.items ?? []).filter((x) => x.status === "open" || recent(x)).map((x) => ({
    id: x.id, kind: x.kind, who: x.who, note: x.note, subject: x.subject, link: x.link, received: x.received,
    repliedAt: x.repliedAt ?? null, stillToDo: !!x.stillToDo, offer: x.offer ?? null, guess: x.guess ?? null,
    status: x.status, doneAt: x.doneAt ?? null, closedAt: x.closedAt ?? null, doneBy: x.doneBy ?? null, byHand: !!x.byHand,
  }));
}

/** Counts for an event's card on the home page. */
export function inboxCounts(box) {
  const open = (box?.items ?? []).filter((x) => x.status === "open");
  return {
    you: open.filter((x) => x.kind === "you" && !x.repliedAt).length,
    replied: open.filter((x) => x.kind === "you" && x.repliedAt).length,
    them: open.filter((x) => x.kind === "them").length,
    offers: open.filter((x) => x.kind === "offer").length,
  };
}
