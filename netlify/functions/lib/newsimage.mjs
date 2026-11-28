/**
 * The Newsroom's post image, 1080×1350, drawn on the server from Andrew's "ONGIA News Post Template" (28 Nov 2026):
 * a navy card, an ivory masthead with the official logo and a coloured story-type tag, the kind of story and the city,
 * the headline, up to three key figures, two or three sentences of ONGIA's view, the source and date, ongia.ca.
 * Trafficking posts carry the Canadian Human Trafficking Hotline. When the official release has a usable photo of what
 * was seized (never a person), the photo version puts it under the headline with its credit.
 *
 * Laid out by satori (flexbox and text wrapping, into SVG) and turned into a PNG by resvg, both pure JavaScript and
 * WebAssembly, so it runs in a Netlify function with nothing to install. Fonts are Montserrat and Inter (SIL Open
 * Font Licence, public/assets/fonts/news).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const roots = [path.resolve(HERE, "../../.."), path.resolve(HERE, "../.."), process.cwd(), "/var/task"];
const find = (rel) => roots.map((r) => path.join(r, rel)).find((f) => existsSync(f));

/** Story types: the tag's words and colour on the image (the template's five colours). */
export const TYPES = {
  tobacco: { tag: "CONTRABAND TOBACCO", colour: "#E9B949", label: "Contraband tobacco" },
  nicotine: { tag: "CONTRABAND NICOTINE", colour: "#E9B949", label: "Nicotine pouches" },
  guns: { tag: "GUNS & GANGS", colour: "#F07167", label: "Guns & gangs" },
  gangs: { tag: "GUNS & GANGS", colour: "#F07167", label: "Guns & gangs" },
  organized: { tag: "ORGANIZED CRIME", colour: "#F07167", label: "Organized crime" },
  drugs: { tag: "DRUG SEIZURE", colour: "#F07167", label: "Drugs" },
  homeinvasion: { tag: "HOME INVASION", colour: "#F07167", label: "Home invasions" },
  trafficking: { tag: "HUMAN TRAFFICKING", colour: "#5CC8D7", label: "Human trafficking" },
  youth: { tag: "YOUTH VIOLENCE", colour: "#B69CF5", label: "Youth violence" },
  goodnews: { tag: "GOOD NEWS", colour: "#7BD389", label: "Good news" },
};
export const typeOf = (t) => TYPES[t] ?? TYPES.organized;
export const HOTLINE = "1-833-900-1010";

const NAVY = "#0B1730", PANEL = "#13234A", GOLD = "#D4AF5F", IVORY = "#F7F4EC", SOFT = "#C9D1E0", RULE = "#2A3B66";

let FONTS = null, LOGO = null, WASM = null;
function assets() {
  if (!FONTS) {
    const f = (name) => { const p = find(`public/assets/fonts/news/${name}`); if (!p) throw new Error(`the post font ${name} is missing from the bundle`); return readFileSync(p); };
    FONTS = [
      { name: "Montserrat", data: f("montserrat-latin-600-normal.woff"), weight: 600, style: "normal" },
      { name: "Montserrat", data: f("montserrat-latin-700-normal.woff"), weight: 700, style: "normal" },
      { name: "Montserrat", data: f("montserrat-latin-800-normal.woff"), weight: 800, style: "normal" },
      { name: "Inter", data: f("inter-latin-400-normal.woff"), weight: 400, style: "normal" },
      { name: "Inter", data: f("inter-latin-500-normal.woff"), weight: 500, style: "normal" },
      { name: "Inter", data: f("inter-latin-600-normal.woff"), weight: 600, style: "normal" },
    ];
    const logo = find("public/assets/ongia-logo-tagline.png");
    LOGO = logo ? `data:image/png;base64,${readFileSync(logo).toString("base64")}` : null;
  }
  return { fonts: FONTS, logo: LOGO };
}
async function wasm() {
  if (!WASM) {
    const p = find("node_modules/@resvg/resvg-wasm/index_bg.wasm");
    if (!p) throw new Error("the image renderer (resvg) is missing from the bundle");
    WASM = initWasm(readFileSync(p)).catch((e) => { if (!/already/i.test(e.message)) throw e; });
  }
  return WASM;
}

// A tiny element builder: satori takes React-shaped objects.
const h = (type, style, ...children) => ({ type, props: { style: { display: "flex", ...style }, children: children.flat().filter((c) => c !== null && c !== undefined && c !== false) } });
const img = (src, style) => ({ type: "img", props: { src, style } });

/** Headline size by length, so a long one still fits its space. */
export function headlineSize(text, photo = false) {
  const n = String(text ?? "").length;
  const sizes = photo ? [[50, 60], [80, 52], [110, 46], [Infinity, 40]] : [[50, 76], [80, 66], [110, 56], [Infinity, 48]];
  return sizes.find(([max]) => n <= max)[1];
}

/** The card as satori elements (exported for the tests, which check what goes on it). */
export function card(post, logo) {
  const t = typeOf(post.type);
  const photo = post.photo?.src ? post.photo : null;
  const figures = (post.figures ?? []).filter((f) => f && String(f.value ?? "").trim()).slice(0, 3);
  const hotline = post.type === "trafficking";
  const viewSize = String(post.view ?? "").length > 220 ? 30 : 36;
  return h("div", { width: 1080, height: 1350, flexDirection: "column", background: NAVY, color: "#FFFFFF", fontFamily: "Inter", position: "relative" },
    h("div", { justifyContent: "space-between", alignItems: "center", padding: "36px 80px", background: IVORY, borderBottom: `4px solid ${GOLD}` },
      logo ? img(logo, { width: 400, height: 103 }) : h("div", { fontFamily: "Montserrat", fontWeight: 800, fontSize: 64, color: NAVY }, "ONGIA"),
      h("div", { background: t.colour, color: NAVY, fontFamily: "Montserrat", fontWeight: 700, fontSize: 20, letterSpacing: 2, padding: "12px 22px", borderRadius: 999 }, t.tag)),
    h("div", { flexDirection: "column", flexGrow: 1, padding: photo ? "40px 80px 56px" : "52px 80px 56px", gap: photo ? 30 : 42 },
      h("div", { flexDirection: "column", gap: 18 },
        h("div", { fontSize: 20, letterSpacing: 3, color: GOLD, fontWeight: 600 }, String(post.kicker ?? "").toUpperCase()),
        h("div", { fontFamily: "Montserrat", fontWeight: 800, fontSize: headlineSize(post.headline, !!photo), lineHeight: 1.06, letterSpacing: -1 }, String(post.headline ?? ""))),
      photo ? h("div", { position: "relative", height: 470, borderRadius: 16, overflow: "hidden", border: `2px solid ${RULE}`, background: "#1C2C55" },
        img(photo.src, { width: 916, height: 470, objectFit: "cover" }),
        h("div", { position: "absolute", right: 16, bottom: 14, background: "rgba(11,23,48,0.85)", fontSize: 16, padding: "6px 12px", borderRadius: 6 }, `Photo: ${photo.credit}`)) : null,
      figures.length ? h("div", { gap: 24 },
        figures.map((f) => h("div", { flexDirection: "column", gap: 8, borderTop: `2px solid ${GOLD}`, paddingTop: 16, flex: 1 },
          h("div", { fontFamily: "Montserrat", fontWeight: 800, fontSize: photo ? 40 : 50, color: GOLD }, String(f.value)),
          h("div", { fontSize: photo ? 18 : 20, color: SOFT }, String(f.label ?? ""))))) : null,
      post.view && !photo ? h("div", { background: PANEL, borderRadius: 20, padding: "40px 44px", flexGrow: 1, alignItems: "center" },
        h("div", { fontSize: viewSize, lineHeight: 1.4 }, String(post.view))) : null,
      hotline ? h("div", { alignItems: "center", gap: 24, border: `2px solid ${t.colour}`, borderRadius: 20, padding: "24px 36px" },
        h("div", { flexDirection: "column", gap: 4 },
          h("div", { fontSize: 20, color: SOFT }, "Canadian Human Trafficking Hotline · 24/7, confidential"),
          h("div", { fontFamily: "Montserrat", fontWeight: 800, fontSize: 40 }, HOTLINE))) : null,
      h("div", { justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${RULE}`, paddingTop: 22, marginTop: "auto", fontSize: 18, color: SOFT },
        h("div", {}, `Source: ${post.source ?? ""}${post.date ? ` · ${post.date}` : ""}`),
        h("div", { fontFamily: "Montserrat", fontWeight: 700, color: "#FFFFFF" }, "ongia.ca"))));
}

/** The post image as PNG bytes. `post.photo.src` is a data: URL of the release's photo, already checked. */
export async function renderPost(post) {
  const { fonts, logo } = assets();
  const svg = await satori(card(post, logo), { width: 1080, height: 1350, fonts });
  await wasm();
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1080 } }).render().asPng();
  return Buffer.from(png);
}
