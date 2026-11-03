# ONGIA Expenses: how it works

The board's expense claims, as an app of its own on the phone: `/expenses`, with its own icon and manifest
(`public/expenses.webmanifest`). It runs on the Briefing Room's functions (`netlify/functions/expenses.mjs`) and opens
nothing else on the desk.

## Signing in
- Any board member on the roster (and the three officers always) signs in with their ONGIA Microsoft account.
- Microsoft knows `/admin.html` as the way back, so the reply lands there and is handed straight to `/expenses` (the
  first script on `admin.html`). No change was needed in Microsoft's settings.
- The session (`x1.`, 30 days, kept on the phone) opens expense claims only; `requireAdmin` refuses it. Taking someone
  off the roster ends it at once.

## A claim
- Lines: a receipt (photo or PDF, read by Claude: vendor, date, total, category, what), mileage (km × $0.62,
  `EXPENSE_MILEAGE_RATE`, kept on the line), or no receipt (a written reason and a card-statement screenshot).
- Claude only fills empty boxes. A line is green when what's claimed matches the receipt.
- Draft → submitted → approved → paid (locked). Either approver can send it back with a reason (rejected); the member
  fixes it and sends it again, and both sign-offs start fresh.

## Who signs off (Andrew, 2 Nov 2026)
| Claim from | Approved by |
|---|---|
| a board member | President + Treasurer |
| the VP | President + Treasurer |
| the President | VP + Treasurer |
| the Treasurer | President + VP |

Always two different people, never the person claiming.

## Payment (Andrew, 3 Nov 2026)
The VP (Jacqulyn) sends the e-transfers and records the reference, which locks the claim. She records her own too, once
two others have approved it. Only the President or the VP can unlock a paid claim, and only with a reason; it goes back
to approved.

## Away (Andrew, 3 Nov 2026)
The President, the VP or the Treasurer hands their approvals (and the VP her payments) to another executive for up to
60 days: John Healy (Legal Advisor), Andrew Hammond, Jacqulyn Taylor, Peglar Artinian (Executive Officer) or Raj
Jaswal. When the stand-in can't take a claim (it's theirs, or they already sign the other half) it goes to the second
person named; when neither can, it waits for the officer. The President can set or end a hand-off for the others.
A stand-in's approval is recorded as theirs, "for the Treasurer".

## Testing
Test mode (in the menu) puts what you add on a separate claim marked TEST; its emails say [TEST]. The President can mark
any claim as a test, and delete all test claims at once (All claims tab). Real claims are never touched.

## Records (Netlify Blobs)
`expclaim:<id>` the claim · `expline:<claim>:<line>` each line · `expread:` what Claude read · `expfile:` / `expthumb:` /
`expshot:` the receipt, its small picture, the card statement · `expmine:<who>:<id>` whose · `expq:<id>` waiting on
someone · `meta:expenses:away:<role>` a hand-off. Each line is its own record so receipts sent together never overwrite.

## Still to come
Filing to SharePoint (Treasurer (2025-2026) (New) › Board Members Expenses › year › member › Month YYYY, with a Receipts
folder; the Excel from ONGIA's template and a PDF), and per-person badges on the app icon.
