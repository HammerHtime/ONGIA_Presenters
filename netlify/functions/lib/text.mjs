/**
 * Small text helpers shared by the server's emails and pages (audit 24 Nov 2026: the same HTML escape was written out in
 * ten files). Escapes &, <, > and " — enough for text and double-quoted attributes, which is all these files write.
 */
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
