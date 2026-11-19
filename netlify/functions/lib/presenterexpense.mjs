import { createHmac } from "node:crypto";
import { tokensMatch } from "./ids.mjs";
import { siteUrl } from "./site.mjs";
import { layout } from "./mail.mjs";
import { MEALS, MEAL_NAME, dollars } from "./expenses.mjs";
import { formatLong } from "./deadlines.mjs";

/**
 * A presenter's own expense claim, by a link (Andrew 19 Nov 2026: "send out a link to presenters post-conference …
 * they take a picture of their receipts, just like our receipts app … create an exception for presenters that they could
 * bypass [the Microsoft sign-in] and just submit"). The link is the presenter's alone: it names the event and the
 * presenter and carries a signature only the desk can make, so nobody else's claim can be opened with it. It works
 * until 30 days after the event ("30 days is good"). The claim it makes is an ordinary claim for that presenter: read
 * by Claude, checked against the meal per diem, approved by the President and the VP, paid to the presenter by
 * e-transfer.
 */
export const SELF_DAYS = 30;
const SELF_HOST = "presenters.ongia.invalid";   // never a real mailbox: the owner of a presenter's own claim

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sign = (eventId, presenterId) => createHmac("sha256", process.env.ADMIN_KEY ?? "").update(`presenter-expenses:${eventId}:${presenterId}`).digest("hex").slice(0, 32);
export const selfKeyOk = (eventId, presenterId, key) => !!process.env.ADMIN_KEY && tokensMatch(sign(eventId, presenterId), String(key ?? ""));
export const selfLink = (eventId, presenterId, req = null) => `${siteUrl(req)}/x/${encodeURIComponent(eventId)}/${encodeURIComponent(presenterId)}/${sign(eventId, presenterId)}`;

/** Who a presenter's own claim belongs to in the books: an address that is theirs alone and no real mailbox. */
export const selfOwnerEmail = (eventId, presenterId) => `${`${eventId}.${presenterId}`.toLowerCase().replace(/[^a-z0-9.-]+/g, "-")}@${SELF_HOST}`;
export const isSelfOwner = (email) => String(email ?? "").toLowerCase().endsWith(`@${SELF_HOST}`);

/** The last day the link takes a claim: 30 days after the event's last day. */
export function selfDeadline(event) {
  const last = event?.lastDay || event?.dayOne;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(last))) return "";
  return new Date(Date.parse(`${last}T12:00:00Z`) + SELF_DAYS * 86400e3).toISOString().slice(0, 10);
}

/** Which meals the event served (its setting on Edit event), in the order of a day. */
export const mealsProvidedOf = (event) => MEALS.filter((m) => event?.mealsProvided?.[m] === true);
const FR_MEAL = { breakfast: "le déjeuner", lunch: "le dîner", dinner: "le souper" };
const list = (xs, and) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs.at(-1)}`);

/**
 * The meals and per diem words a presenter reads (Andrew 19 Nov 2026), from the rates in force and the meals this event
 * served. Plain strings, one per paragraph, for the page and the email alike.
 */
export function perDiemBlurb(perDiem, event, lang = "en") {
  const given = mealsProvidedOf(event), left = MEALS.filter((m) => !given.includes(m));
  const money = (n) => (lang === "fr" ? `${Number(n).toFixed(2).replace(".", ",")} $` : dollars(n));
  if (lang === "fr") {
    const rates = `Déjeuner ${money(perDiem.breakfast)} · Dîner ${money(perDiem.lunch)} · Souper ${money(perDiem.dinner)}`;
    return [
      `L'ONGIA rembourse les repas qui ne sont pas fournis sur place, jusqu'à concurrence de ces montants par repas : ${rates}.`,
      given.length ? (left.length ? `À cet événement, ${list(given.map((m) => FR_MEAL[m]), "et")} ${given.length > 1 ? "étaient fournis" : "était fourni"} : vous pouvez donc réclamer ${list(left.map((m) => FR_MEAL[m]), "et")} seulement.` : "Tous les repas étaient fournis à cet événement : aucun repas ne peut être réclamé.") : "Si un repas était fourni sur place, aucune indemnité n'est versée pour ce repas.",
      "Les indemnités couvrent la nourriture seulement. L'alcool n'est pas remboursé : demandez-le sur une addition séparée. Tout montant au-delà de l'indemnité est à vos frais.",
      "Si vous avez pris votre propre véhicule, le kilométrage est payé au taux du gouvernement fédéral.",
    ];
  }
  const rates = MEALS.map((m) => `${MEAL_NAME[m]} ${money(perDiem[m])}`).join(" · ");
  return [
    `ONGIA covers meals that are not provided at the event, up to these amounts per meal: ${rates}.`,
    given.length ? (left.length ? `At this event, ${list(given, "and")} ${given.length > 1 ? "were" : "was"} provided, so you can claim ${list(left, "and")} only.` : "Every meal was provided at this event, so no meals can be claimed.") : "If a meal was provided at the venue, there is no per diem for that meal.",
    "Per diems are for food only. Alcohol is not reimbursed, so please keep it on a separate bill. Anything above the per diem amount is your own cost.",
    "If you drove your own vehicle, mileage is paid at the federal government rate.",
  ];
}

/** The email that carries the link (sent only when the President presses Send on the event). */
export function selfLinkMail({ presenter, event, link, perDiem, deadline }) {
  const fr = presenter?.language === "fr";
  const first = String(presenter?.first ?? "").trim();
  const blurb = perDiemBlurb(perDiem, event, fr ? "fr" : "en");
  const lines = fr ? [
    `Bonjour${first ? ` ${esc(first)}` : ""},`,
    `Merci d'avoir présenté à <b>${esc(event.title)}</b>. Si vous avez eu des dépenses que l'ONGIA rembourse, vous pouvez les réclamer ici : photographiez vos reçus, vérifiez les montants, puis envoyez. Aucun compte ni mot de passe.`,
    ...blurb.map(esc),
    `Une fois la réclamation approuvée, vous êtes payé par virement Interac à cette adresse courriel.${deadline ? ` Le lien fonctionne jusqu'au ${esc(formatLong(deadline, "fr", { weekday: false }))}.` : ""}`,
    "Ce lien est le vôtre : ne le transférez pas.",
  ] : [
    `Hello${first ? ` ${esc(first)}` : ""},`,
    `Thank you for presenting at <b>${esc(event.title)}</b>. If you had expenses that ONGIA covers, you can claim them here: take a photo of each receipt, check the amounts, and send. There is no account or password.`,
    ...blurb.map(esc),
    `Once your claim is approved, you are paid by e-transfer to this email address.${deadline ? ` The link works until ${esc(formatLong(deadline, "en", { weekday: false }))}.` : ""}`,
    "This link is yours alone, so please don't forward it.",
  ];
  const heading = fr ? "Vos dépenses de présentateur" : "Your presenter expenses";
  const button = { label: fr ? "Réclamer mes dépenses" : "Claim my expenses", href: link };
  const html = layout({ heading, lines, button, footer: "ONGIA" });
  const strip = (l) => String(l).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [heading, "", ...lines.map((l) => `${strip(l)}\n`), `${button.label}: ${link}`, "", "--", "ONGIA"].join("\n");
  return { subject: fr ? `Vos dépenses : ${event.title}` : `Your expenses: ${event.title}`, html, text };
}
