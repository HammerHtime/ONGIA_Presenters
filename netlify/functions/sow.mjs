import { json, fail, requireAdmin, adminWho, text } from "./lib/http.mjs";
import { mayCost } from "./lib/auth.mjs";
import { getEvent, listEvents, getSow, putSow, getMeta, putMeta, getReceipts } from "./lib/store.mjs";
import { withReceipts } from "./lib/receipts.mjs";
import { STANDARD_LINES, TEMPLATES, defaultPrefix, STATUSES, PROVINCES, provinceTaxes, guessProvince, cleanLines, cleanTaxes, cleanPrefix, invoiceNumber, totals, stampStatus, isLocked, increase, money, sentCopy, changesSinceSent, cleanInternal, internalOf, STANDARD_INTERNAL, profit } from "./lib/sow.mjs";
import { buildSowPdf, buildSowsPdf } from "./lib/sowpdf.mjs";
import { fileEventDocument, SOW_FOLDER } from "./lib/graph.mjs";

/**
 * The statement of work and the final invoice for an RBH event. The president and the VP only: the lead
 * of an event does not touch the costing, so every call here is refused for anyone else.
 *
 *   GET  /api/sow?event=…                      the SOW, its figures, and the RBH events it could be copied from
 *   POST /api/sow?event=…&create=1             start one ({ from: "standard" | <event id> })
 *   PUT  /api/sow?event=…                      save it ({ program, lines, taxes, taxBase, deposit, invoiceDate, dueDate, increaseReason })
 *   PUT  /api/sow?event=…&status=<status>      move it along: draft, submitted, approved, invoiced, paid
 *   PUT  /api/sow?event=…&unlock=1|0           let the estimates be edited again after approval (noted), or lock them
 *   GET  /api/sow?event=…&doc=sow|invoice      the PDF
 *   POST /api/sow?event=…&file=sow|invoice     put a copy in the event's "SOW and Invoice" folder on SharePoint
 *   PUT  /api/sow?event=…&province=QC          the tax lines for another province
 *   PUT  /api/sow?event=…&refill=<event id>    a draft's lines replaced by that event's (names, types, amounts)
 *   GET  /api/sow?all=1                        every RBH event and its statement of work's figures, for the RBH SOWs screen
 *   GET  /api/sow?all=1&doc=sow|invoice&ids=…  those statements of work (or invoices) in one PDF, in that order
 */
const view = async (event, raw) => {
  // The receipts are their own record; fold them in for showing, never into what is saved.
  const sow = raw ? { ...withReceipts(raw, (await getReceipts(event.id)).items), internal: internalOf(raw) } : null;
  return {
  allowed: true,
  province: event.province || guessProvince(event.city),
  provinces: Object.fromEntries(Object.entries(PROVINCES).map(([k, v]) => [k, v.name])),
  sow,
  estimate: sow ? totals(sow, "estimate") : null,
  actual: sow ? totals(sow, "actual") : null,
  profit: sow ? { estimate: profit(sow, "estimate"), actual: profit(sow, "actual") } : null,
  increase: sow ? increase(sow) : null,
  locked: sow ? isLocked(sow) : false,
  changedSinceSent: sow ? changesSinceSent(sow) : [],
  copyFrom: sow ? [] : await copyChoices(event),
  // A draft of an ITP or a CFAOC with no fixed fees yet can be filled in from the latest one of its kind (Andrew 29 Oct
  // 2026: the May and June ITPs were started nearly empty, so their profit read -$9,400 and $1,600).
  refill: sow && sow.status === "draft" && sowFamily(event) !== "other" && profit(sow, "estimate").fixed === 0 ? (await copyChoices(event)).find((c) => c.family === sowFamily(event)) ?? null : null,
  templates: sow ? [] : Object.entries(TEMPLATES).map(([key, t]) => ({ key, title: t.title, blurb: t.blurb, total: t.lines.reduce((n, l) => n + l.estimate, 0) })),
  };
};

// One choice per kind of RBH event, the latest of each (Andrew 29 Oct 2026: "all the CFAOC and ITP events will be the same,
// so I just need one of those options. Not a running list").
export const sowFamily = (e) => (/organi[sz]ed crime|cfaoc/i.test(`${e.title} ${e.invoicePrefix ?? ""}`) ? "cfaoc"
  : /\bitp\b/i.test(`${e.title} ${e.invoicePrefix ?? ""}`) ? "itp" : "other");
async function copyChoices(event) {
  const latest = new Map();
  for (const e of (await listEvents()) ?? []) {
    if (e.id === event.id || e.kind !== "rbh") continue;
    const k = sowFamily(e), had = latest.get(k);
    if (had && String(had.dayOne ?? "") >= String(e.dayOne ?? "")) continue;
    const s = await getSow(e.id);
    // One that has been filled in: a nearly empty one (no fixed fees yet) is no model for the next.
    if (s && profit(s, "estimate").fixed > 0) latest.set(k, { id: e.id, family: k, title: e.title, dayOne: e.dayOne, year: String(e.dayOne ?? "").slice(0, 4), total: totals(s, "estimate").subtotal });
  }
  return ["cfaoc", "itp", "other"].filter((k) => latest.has(k)).map((k) => { const { dayOne, ...c } = latest.get(k); return c; });
}

async function nextInvoiceNumber(event) {
  const prefix = cleanPrefix(event.invoicePrefix || defaultPrefix(event.title));
  const year = String(event.dayOne ?? "").slice(0, 4) || String(new Date().getFullYear());
  const key = `invseq:${prefix}-${year}`;
  const seq = ((await getMeta(key))?.seq ?? 0) + 1;
  await putMeta(key, { seq, at: new Date().toISOString() });
  return { prefix, year, seq, number: invoiceNumber(prefix, year, seq) };
}

/**
 * Every RBH event with what its statement of work comes to (Andrew 29 Oct 2026: "a tab ... I could see a list and access
 * all of the RBH SOWs ... the total amount of expenses planned, the total sum of profit planned"). An event with no SOW yet
 * is listed too, with nothing in it, so it can be started from there.
 */
async function everyOne() {
  const events = ((await listEvents()) ?? []).filter((e) => e.kind === "rbh");
  const rows = await Promise.all(events.map(async (e) => {
    const raw = await getSow(e.id);
    const base = { id: e.id, title: e.title, city: e.city ?? "", dayOne: e.dayOne ?? "", lastDay: e.lastDay ?? "" };
    if (!raw) return { ...base, sow: false };
    const sow = { ...withReceipts(raw, (await getReceipts(e.id)).items), internal: internalOf(raw) };
    const figures = (which) => { const t = totals(sow, which), p = profit(sow, which);
      return { atCost: money(t.subtotal - p.fixed), fixed: p.fixed, subtotal: t.subtotal, fee: t.fee, deposit: t.deposit, taxTotal: t.taxTotal, total: t.total, internal: p.internal, profit: p.profit }; };
    return { ...base, sow: true, number: sow.invoice?.number ?? "", status: sow.status, statusAt: sow.statusAt ?? {},
      invoiced: ["invoiced", "paid"].includes(sow.status), paid: sow.status === "paid", hasActuals: (sow.lines ?? []).some((l) => (l.actual ?? null) !== null || (l.receiptsTotal ?? 0) > 0) || (sow.receiptsOther ?? 0) > 0,
      estimate: figures("estimate"), actual: figures("actual") };
  }));
  return rows.sort((a, b) => String(a.dayOne).localeCompare(String(b.dayOne)) || a.title.localeCompare(b.title));
}

const note = (sow, who, what) => { (sow.history ??= []).push({ at: new Date().toISOString(), who, what }); };

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const who = adminWho(req);
  if (!mayCost(who)) return fail("Only ONGIA's president and VP of operations can open an event's costing.", 403);
  const name = who.name || who.email || "";

  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("all")) {
    if (!url.searchParams.get("doc")) return json({ events: await everyOne() });
    const kind = url.searchParams.get("doc") === "invoice" ? "invoice" : "sow";
    const items = [];
    for (const one of String(url.searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 60)) {
      const [e, raw] = await Promise.all([getEvent(one), getSow(one)]);
      if (e?.kind === "rbh" && raw) items.push({ event: e, sow: withReceipts(raw, (await getReceipts(one)).items), kind });
    }
    if (!items.length) return fail("None of those events has a statement of work.", 404);
    const pdf = await buildSowsPdf(items, { title: `ONGIA ${kind === "invoice" ? "invoices" : "statements of work"}` });
    return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="ONGIA ${kind === "invoice" ? "Invoices" : "Statements of Work"}.pdf"` } });
  }
  const id = url.searchParams.get("event");
  const event = id && (await getEvent(id));
  if (!event) return fail("No such event.", 404);
  if (event.kind !== "rbh") return fail("This isn't an RBH event, so it has no statement of work.", 409);
  const sow = await getSow(id);
  const receipts = await getReceipts(id);
  const q = (k) => url.searchParams.get(k);

  if (req.method === "GET" && q("doc")) {
    if (!sow) return fail("There is no statement of work yet.", 404);
    const kind = q("doc") === "invoice" ? "invoice" : "sow";
    const pdf = await buildSowPdf({ event, sow: withReceipts(sow, (await getReceipts(id)).items), kind });
    return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${sow.invoice?.number ?? "SOW"} ${kind === "invoice" ? "Invoice" : "Statement of Work"}.pdf"` } });
  }
  if (req.method === "GET") return json(await view(event, sow));

  if (req.method === "POST" && q("create")) {
    if (sow) return fail("This event already has a statement of work.", 409);
    const body = await req.json().catch(() => ({}));
    let lines = STANDARD_LINES.map((l) => ({ ...l, description: "", estimate: 0, actual: null }));
    let from = null;
    let progNote = "";
    if (TEMPLATES[body.from]) {
      lines = TEMPLATES[body.from].lines.map((l) => ({ ...l, actual: null }));
      progNote = TEMPLATES[body.from].note;
      from = null;
    } else if (body.from && body.from !== "standard") {
      const other = await getSow(text(body.from, 80));
      if (!other) return fail("That event has no statement of work to copy.", 404);
      lines = other.lines.map((l) => ({ name: l.name, description: l.description, type: l.type, estimate: l.estimate, actual: null }));
      from = text(body.from, 80);
    }
    const province = event.province || guessProvince(event.city);
    const next = {
      invoice: await nextInvoiceNumber(event),
      program: { title: event.title, place: event.city ?? "", note: progNote },
      lines: cleanLines(lines), internal: cleanInternal(STANDARD_INTERNAL), taxes: provinceTaxes(province), taxBase: "subtotal+fee", deposit: 0,
      status: "draft", statusAt: { draft: new Date().toISOString() }, copiedFrom: from, unlocked: false, history: [],
    };
    note(next, name, from ? "Started from another event's statement of work" : TEMPLATES[body.from] ? `Started from the template "${TEMPLATES[body.from].title}"` : "Started from the standard lines");
    await putSow(id, next);
    return json(await view(event, next), 201);
  }

  if (!sow) return fail("Start the statement of work first.", 409);

  if (req.method === "PUT" && q("status")) {
    const s = q("status");
    if (!STATUSES.includes(s)) return fail("That isn't a status.");
    const next = { ...sow };
    stampStatus(next, s);
    // Sent (or sent again): the amounts lock, and the copy RBH now has is kept to compare against.
    if (s === "submitted") { next.unlocked = false; next.sent = sentCopy(next); }
    if (s === "approved") next.unlocked = false;
    note(next, name, `Marked ${s}`);
    await putSow(id, next);
    return json(await view(event, next));
  }

  if (req.method === "PUT" && q("unlock")) {
    // Unlocking takes the word EDIT typed on the page, so a change to what RBH was sent is never an accident.
    if (q("unlock") === "1" && String((await req.json().catch(() => null))?.word ?? "").trim().toUpperCase() !== "EDIT") return fail("Type EDIT to change the amounts.", 400);
    const next = { ...sow, unlocked: q("unlock") === "1" };
    note(next, name, next.unlocked ? "Unlocked the amounts after it was sent to RBH" : "Locked the amounts again");
    await putSow(id, next);
    return json(await view(event, next));
  }

  if (req.method === "PUT" && q("refill")) {
    // Only a draft: once RBH has it, its lines are what was sent.
    if (sow.status !== "draft") return fail("Only a draft can be filled in again. This one has gone to RBH.", 409);
    const other = await getSow(text(q("refill"), 80));
    if (!other) return fail("That event has no statement of work to copy.", 404);
    // A line with the same name keeps its id (and so its receipts) and anything typed in its invoice column;
    // a line of this one's with receipts against it stays, so the receipts still count somewhere.
    const mine = new Map(sow.lines.map((l) => [l.name.trim().toLowerCase(), l]));
    const lines = other.lines.map((l) => { const had = mine.get(String(l.name).trim().toLowerCase());
      return { id: had?.id ?? "", name: l.name, description: l.description ?? "", type: l.type, estimate: l.estimate, actual: had?.actual ?? null }; });
    for (const l of sow.lines) if (!lines.some((x) => x.id === l.id) && (receipts.items ?? []).some((r) => r.lineId === l.id)) lines.push(l);
    const next = { ...sow, lines: cleanLines(lines, sow.lines), copiedFrom: text(q("refill"), 80) };
    note(next, name, "Filled in again from another event's statement of work");
    await putSow(id, next);
    return json(await view(event, next));
  }

  if (req.method === "PUT" && q("province")) {
    const code = text(q("province"), 2).toUpperCase();
    if (!PROVINCES[code]) return fail("That isn't a province or territory.");
    const next = { ...sow, taxes: provinceTaxes(code) };
    note(next, name, `Tax lines set to ${PROVINCES[code].name}'s`);
    await putSow(id, next);
    return json(await view(event, next));
  }

  if (req.method === "PUT") {
    const body = await req.json().catch(() => null);
    if (!body) return fail("Nothing to save.");
    const lines = cleanLines(body.lines, sow.lines);
    // A line with receipts against it can't be deleted: the receipts would have nowhere to count.
    const kept = new Set(lines.map((l) => l.id));
    const stranded = sow.lines.filter((l) => !kept.has(l.id) && (receipts.items ?? []).some((r) => r.lineId === l.id));
    if (stranded.length) return fail(`There are receipts against ${stranded.map((l) => `"${l.name}"`).join(", ")}. Move or remove them on the Receipts screen before deleting the line.`, 409);
    if (isLocked(sow)) {
      // After approval the estimates are what RBH agreed to: those lines' names, types and amounts stay, and only
      // descriptions and the actuals (the invoice) change until it is unlocked. A new line can still be added (Andrew
      // 29 Oct 2026): it has no agreed amount, so its estimate is nil and it shows only on the invoice.
      const agreed = sow.lines.filter((l) => !l.added), agreedIds = new Set(agreed.map((l) => l.id));
      const kept = lines.filter((l) => agreedIds.has(l.id));
      const same = kept.length === agreed.length && kept.every((l, i) => l.id === agreed[i].id && l.name === agreed[i].name && l.type === agreed[i].type && l.estimate === agreed[i].estimate);
      if (!same) return fail("This was sent to RBH, so the amounts are locked. Click Edit amounts and type EDIT if RBH has agreed to a change.", 409);
      for (const l of lines) if (!agreedIds.has(l.id)) { l.added = true; l.estimate = 0; }
    }
    const next = {
      ...sow,
      program: { title: text(body.program?.title, 120) || sow.program.title, place: text(body.program?.place, 120), note: text(body.program?.note, 200) },
      lines,
      // The internal costs are ONGIA's own, not what RBH agreed to: they change whether or not the amounts are locked.
      internal: body.internal === undefined ? internalOf(sow) : cleanInternal(body.internal, internalOf(sow)),
      taxes: body.taxes === undefined ? sow.taxes : cleanTaxes(body.taxes),
      taxBase: body.taxBase === "subtotal" ? "subtotal" : "subtotal+fee",
      deposit: money(Math.max(0, Number(body.deposit) || 0)),
      invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(text(body.invoiceDate, 10)) ? text(body.invoiceDate, 10) : "",
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(text(body.dueDate, 10)) ? text(body.dueDate, 10) : "",
      // What the invoice shows under Other: blank means "what the receipts under Other add up to".
      otherActual: body.otherActual === undefined ? (sow.otherActual ?? null) : (body.otherActual === "" || body.otherActual === null || !Number.isFinite(Number(body.otherActual)) ? null : money(Math.max(0, Number(body.otherActual)))),
      // The explanation for RBH when the invoice is 20% or more over the SOW; it prints on the invoice only then.
      increaseReason: body.increaseReason === undefined ? (sow.increaseReason ?? "") : text(body.increaseReason, 1500),
    };
    const changedAfterSent = STATUSES.indexOf(sow.status) >= STATUSES.indexOf("submitted") && JSON.stringify(sow.lines.map((l) => l.estimate)) !== JSON.stringify(lines.map((l) => l.estimate));
    if (changedAfterSent) note(next, name, "Amounts changed after it was sent to RBH");
    await putSow(id, next);
    return json(await view(event, next));
  }

  if (req.method === "POST" && q("file")) {
    const kind = q("file") === "invoice" ? "invoice" : "sow";
    const pdf = await buildSowPdf({ event, sow: withReceipts(sow, (await getReceipts(id)).items), kind });
    let out;
    try {
      out = await fileEventDocument({ event, folder: SOW_FOLDER, name: `${sow.invoice.number} ${kind === "invoice" ? "Invoice" : "Statement of Work"}.pdf`, bytes: pdf, contentType: "application/pdf" });
    } catch (e) { return fail(e.message, 502); }
    if (out.skipped) return fail(out.reason, 409);
    const next = { ...sow, filed: { ...(sow.filed ?? {}), [kind]: { at: out.filedAt, url: out.url, folderUrl: out.folderUrl } } };
    note(next, name, `Filed the ${kind === "invoice" ? "invoice" : "statement of work"} to SharePoint`);
    await putSow(id, next);
    return json({ ...(await view(event, next)), filedTo: out });
  }
  return fail("Method not allowed.", 405);
};
