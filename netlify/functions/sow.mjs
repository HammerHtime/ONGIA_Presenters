import { json, fail, requireAdmin, adminWho, text } from "./lib/http.mjs";
import { mayCost } from "./lib/auth.mjs";
import { getEvent, listEvents, getSow, putSow, getMeta, putMeta } from "./lib/store.mjs";
import { STANDARD_LINES, STATUSES, PROVINCES, provinceTaxes, guessProvince, cleanLines, cleanTaxes, cleanPrefix, invoiceNumber, totals, stampStatus, isLocked, money } from "./lib/sow.mjs";
import { buildSowPdf } from "./lib/sowpdf.mjs";
import { fileEventDocument, SOW_FOLDER } from "./lib/graph.mjs";

/**
 * The statement of work and the final invoice for an RBH event. The president and the VP only: the lead
 * of an event does not touch the costing, so every call here is refused for anyone else.
 *
 *   GET  /api/sow?event=…                      the SOW, its figures, and the RBH events it could be copied from
 *   POST /api/sow?event=…&create=1             start one ({ from: "standard" | <event id> })
 *   PUT  /api/sow?event=…                      save it ({ program, lines, taxes, taxBase, deposit, invoiceDate, dueDate })
 *   PUT  /api/sow?event=…&status=<status>      move it along: draft, submitted, approved, invoiced, paid
 *   PUT  /api/sow?event=…&unlock=1|0           let the estimates be edited again after approval (noted), or lock them
 *   GET  /api/sow?event=…&doc=sow|invoice      the PDF
 *   POST /api/sow?event=…&file=sow|invoice     put a copy in the event's "SOW and Invoice" folder on SharePoint
 *   PUT  /api/sow?event=…&province=QC          the tax lines for another province
 */
const view = async (event, sow) => ({
  allowed: true,
  province: event.province || guessProvince(event.city),
  provinces: Object.fromEntries(Object.entries(PROVINCES).map(([k, v]) => [k, v.name])),
  sow,
  estimate: sow ? totals(sow, "estimate") : null,
  actual: sow ? totals(sow, "actual") : null,
  locked: sow ? isLocked(sow) : false,
  copyFrom: sow ? [] : await copyChoices(event),
});

async function copyChoices(event) {
  const out = [];
  for (const e of (await listEvents()) ?? []) {
    if (e.id === event.id || e.kind !== "rbh") continue;
    const s = await getSow(e.id);
    if (s) out.push({ id: e.id, title: e.title, year: String(e.dayOne ?? "").slice(0, 4), total: totals(s, "estimate").subtotal });
  }
  return out;
}

async function nextInvoiceNumber(event) {
  const prefix = cleanPrefix(event.invoicePrefix || "ITP");
  const year = String(event.dayOne ?? "").slice(0, 4) || String(new Date().getFullYear());
  const key = `invseq:${prefix}-${year}`;
  const seq = ((await getMeta(key))?.seq ?? 0) + 1;
  await putMeta(key, { seq, at: new Date().toISOString() });
  return { prefix, year, seq, number: invoiceNumber(prefix, year, seq) };
}

const note = (sow, who, what) => { (sow.history ??= []).push({ at: new Date().toISOString(), who, what }); };

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const who = adminWho(req);
  if (!mayCost(who)) return fail("Only ONGIA's president and VP of operations can open an event's costing.", 403);
  const name = who.name || who.email || "";

  const url = new URL(req.url);
  const id = url.searchParams.get("event");
  const event = id && (await getEvent(id));
  if (!event) return fail("No such event.", 404);
  if (event.kind !== "rbh") return fail("This isn't an RBH event, so it has no statement of work.", 409);
  const sow = await getSow(id);
  const q = (k) => url.searchParams.get(k);

  if (req.method === "GET" && q("doc")) {
    if (!sow) return fail("There is no statement of work yet.", 404);
    const kind = q("doc") === "invoice" ? "invoice" : "sow";
    const pdf = await buildSowPdf({ event, sow, kind });
    return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${sow.invoice?.number ?? "SOW"} ${kind === "invoice" ? "Invoice" : "Statement of Work"}.pdf"` } });
  }
  if (req.method === "GET") return json(await view(event, sow));

  if (req.method === "POST" && q("create")) {
    if (sow) return fail("This event already has a statement of work.", 409);
    const body = await req.json().catch(() => ({}));
    let lines = STANDARD_LINES.map((l) => ({ ...l, description: "", estimate: 0, actual: null }));
    let from = null;
    if (body.from && body.from !== "standard") {
      const other = await getSow(text(body.from, 80));
      if (!other) return fail("That event has no statement of work to copy.", 404);
      lines = other.lines.map((l) => ({ name: l.name, description: l.description, type: l.type, estimate: l.estimate, actual: null }));
      from = text(body.from, 80);
    }
    const province = event.province || guessProvince(event.city);
    const next = {
      invoice: await nextInvoiceNumber(event),
      program: { title: event.title, place: event.city ?? "", note: "" },
      lines: cleanLines(lines), taxes: provinceTaxes(province), taxBase: "subtotal+fee", deposit: 0,
      status: "draft", statusAt: { draft: new Date().toISOString() }, copiedFrom: from, unlocked: false, history: [],
    };
    note(next, name, from ? "Started from another event's statement of work" : "Started from the standard lines");
    await putSow(id, next);
    return json(await view(event, next), 201);
  }

  if (!sow) return fail("Start the statement of work first.", 409);

  if (req.method === "PUT" && q("status")) {
    const s = q("status");
    if (!STATUSES.includes(s)) return fail("That isn't a status.");
    const next = { ...sow };
    stampStatus(next, s);
    if (s === "approved") next.unlocked = false;
    note(next, name, `Marked ${s}`);
    await putSow(id, next);
    return json(await view(event, next));
  }

  if (req.method === "PUT" && q("unlock")) {
    const next = { ...sow, unlocked: q("unlock") === "1" };
    note(next, name, next.unlocked ? "Unlocked the estimates after approval" : "Locked the estimates again");
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
    if (isLocked(sow)) {
      // After approval the estimates are what RBH agreed to: names, types, amounts and the list of lines stay,
      // and only descriptions and the actuals (the invoice) change until it is unlocked.
      const same = lines.length === sow.lines.length && lines.every((l, i) => l.id === sow.lines[i].id && l.name === sow.lines[i].name && l.type === sow.lines[i].type && l.estimate === sow.lines[i].estimate);
      if (!same) return fail("This was approved, so the estimates are locked. Unlock them first if RBH has agreed to a change.", 409);
    }
    const next = {
      ...sow,
      program: { title: text(body.program?.title, 120) || sow.program.title, place: text(body.program?.place, 120), note: text(body.program?.note, 200) },
      lines,
      taxes: body.taxes === undefined ? sow.taxes : cleanTaxes(body.taxes),
      taxBase: body.taxBase === "subtotal" ? "subtotal" : "subtotal+fee",
      deposit: money(Math.max(0, Number(body.deposit) || 0)),
      invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(text(body.invoiceDate, 10)) ? text(body.invoiceDate, 10) : "",
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(text(body.dueDate, 10)) ? text(body.dueDate, 10) : "",
    };
    const changedAfterApproval = STATUSES.indexOf(sow.status) >= STATUSES.indexOf("approved") && JSON.stringify(sow.lines.map((l) => l.estimate)) !== JSON.stringify(lines.map((l) => l.estimate));
    if (changedAfterApproval) note(next, name, "Estimates edited after approval");
    await putSow(id, next);
    return json(await view(event, next));
  }

  if (req.method === "POST" && q("file")) {
    const kind = q("file") === "invoice" ? "invoice" : "sow";
    const pdf = await buildSowPdf({ event, sow, kind });
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
