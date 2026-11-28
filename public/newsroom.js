/**
 * Briefing Room › Newsroom (the president only). Loaded by admin.html the first time the tab is opened.
 *
 *  Stories       the library like an inbox: newest first, a tile per story, search as you type, filters, the story
 *                beside the list on a computer and full screen with Back on a phone, Copy for each caption
 *  Trends        monthly counts of the stories written up (crime type, province, agency, drugs and firearms), the
 *                Rising flag, crime by province and each province's own trend
 *  Control room  on/off, Run a sample, stories a night, the subjects, the sources, and each night's log
 *
 * Laid out "nice and tight" (Andrew, 5 Nov 2026): one line per row, short labels, filters on one row, settings folded.
 */
const TYPES = {
  tobacco: ["Contraband tobacco", "#8a6a12"], nicotine: ["Nicotine pouches", "#8a6a12"], guns: ["Guns & gangs", "#b4442f"], gangs: ["Guns & gangs", "#b4442f"],
  organized: ["Organized crime", "#b4442f"], drugs: ["Drugs", "#b4442f"], homeinvasion: ["Home invasions", "#b4442f"], trafficking: ["Trafficking", "#1f6f6a"], extortion: ["Extortion", "#b4442f"], autotheft: ["Auto theft", "#b4442f"], laundering: ["Money laundering", "#b4442f"], sextortion: ["Sextortion", "#6a3d8f"],
  youth: ["Youth violence", "#6a3d8f"], goodnews: ["Good news", "#2f6b4f"],
};
const typeOf = (t) => TYPES[t] ?? ["Story", "#596176"];
const CSS = `
.nr{display:flex;flex-direction:column;gap:10px}
.nrhead{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.nrhead h1{font-family:var(--fd);font-weight:400;font-size:30px;color:var(--navy-deep);margin:0}
.nrseg{display:flex;gap:3px;background:var(--sand);padding:3px;border-radius:9px}
.nrseg button{border:0;background:transparent;color:var(--ink-mid);font:600 13px var(--fb);padding:6px 13px;border-radius:7px;cursor:pointer}
.nrseg button[aria-selected="true"]{background:var(--card);color:var(--navy-deep);box-shadow:var(--lift)}
.nrhead .mini{margin-left:auto}
.nrsum{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:7px 12px;font-size:13px;color:var(--ink-mid)}
.nrsum summary{cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nrsum .on{color:var(--done);font-weight:700}.nrsum .off{color:var(--muted);font-weight:700}
.nrcols{display:flex;gap:14px;align-items:flex-start}
.nrlist{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:7px}
.nrchips{display:flex;gap:5px;overflow-x:auto;scrollbar-width:none}
.nrchips .fchip{white-space:nowrap}
.nrsearch{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--edge);border-radius:9px;padding:6px 10px}
.nrsearch input{border:0;outline:0;background:transparent;flex:1;min-width:0;font:14px var(--fb);color:var(--ink)}
.nrsearch .n{font-size:12.5px;color:var(--muted);white-space:nowrap}
.nrfilt{display:flex;gap:6px;align-items:center}
.nrfilt select{flex:1 1 0;min-width:0;font:12.5px var(--fb);color:var(--ink-mid);background:var(--card);border:1px solid var(--border);border-radius:999px;padding:4px 6px}
.nrfilt .mini{flex:none}
.nrcard .nrfilt{flex-wrap:wrap}.nrcard .nrfilt select{flex:none;max-width:220px}
.nrrows{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.nrrow{display:flex;gap:10px;align-items:center;width:100%;padding:8px 12px;border:0;border-bottom:1px solid var(--sand);background:none;text-align:left;font:inherit;color:inherit;cursor:pointer}
.nrrow:last-child{border-bottom:0}
.nrrow.open{background:var(--gold-pale);box-shadow:inset 3px 0 0 var(--gold)}
.nrrow img{flex:0 0 40px;width:40px;height:50px;border-radius:4px;object-fit:cover;background:var(--sunk);border:1px solid var(--border)}
.nrrb{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.nrmeta{display:flex;gap:8px;align-items:baseline;font-size:12px;min-width:0}
.nrmeta .d{color:var(--muted);white-space:nowrap}.nrmeta .t{font-weight:700;white-space:nowrap}
.nrmeta .c{color:var(--ink-mid);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.nrmeta .p{margin-left:auto;font-weight:600;white-space:nowrap}
.nrclip{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.nrhl{font-weight:600;font-size:14px}.nrsm{font-size:12.5px;color:var(--ink-mid)}
.nrkeys{display:flex;gap:4px;overflow:hidden;align-items:center}
.nrkey{font-size:11px;color:var(--ink-mid);background:var(--sunk);border:0;border-radius:4px;padding:0 6px;white-space:nowrap;cursor:pointer;font-family:inherit}
.nrthr{font-size:11px;color:var(--navy);font-weight:600;white-space:nowrap;margin-left:4px}
.nrmore{font-size:12px;color:var(--muted);text-align:center;padding:6px}
.nrpane{flex:1.2 1 0;min-width:0;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;position:sticky;top:calc(var(--barh,60px) + 10px);max-height:calc(100vh - var(--barh,60px) - 24px);overflow:auto}
.nrpane h2{font-family:var(--fd);font-weight:400;font-size:23px;line-height:1.2;margin:2px 0;color:var(--navy-deep)}
.nrpm{display:flex;gap:9px;font-size:12.5px;flex-wrap:wrap;align-items:baseline}
.nrsplit{display:flex;gap:14px;align-items:flex-start}
.nrsplit img{flex:0 0 200px;width:200px;height:250px;border-radius:4px;border:1px solid var(--border);object-fit:cover}
.nrcaps{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px}
.nrtabs{display:flex;gap:4px;align-items:center}
.nrtabs .mini.copy{margin-left:auto}
.nrcap{background:var(--paper);border-radius:9px;padding:10px 12px;font-size:13px;line-height:1.5;white-space:pre-line}
.nrlab{font:500 11px var(--fu);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.nrfc{display:flex;gap:8px;font-size:13px}.nrfc b{flex:0 0 76px}
.nrv-confirmed{color:var(--done)}.nrv-corrected{color:var(--wait)}.nrv-removed{color:var(--late)}
.nrkw{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
.nrkw span{font-size:12px;border:1px solid var(--border);border-radius:4px;padding:1px 4px 1px 8px;color:var(--ink-mid);display:inline-flex;align-items:center;gap:2px}
.nrkw span button{border:0;background:none;color:var(--muted);cursor:pointer;font-size:14px;padding:0 3px;line-height:1}
.nrkw input{font:12px var(--fb);border:1px dashed var(--edge);border-radius:4px;padding:2px 6px;width:120px;background:transparent;color:var(--ink)}
.nrback{display:none;align-self:flex-start}
.nrsample{background:var(--wait-bg);color:var(--wait);border-radius:4px;padding:0 6px;font-size:11.5px;font-weight:700}
.nrempty{padding:22px;text-align:center;color:var(--muted);font-size:13.5px}
.nrcard{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:9px}
.nrline{display:flex;gap:10px;align-items:center;font-size:13.5px;min-height:34px;border-bottom:1px solid var(--sand)}
.nrline:last-child{border-bottom:0}
.nrline .grow{flex:1;min-width:0}
.nrline .st{font-weight:600;font-size:12.5px;white-space:nowrap}
.nrnum{width:56px;font:14px var(--fb);padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--ink)}
.nrcard textarea{width:100%;min-height:120px;font:13px/1.45 var(--fb);border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--card);color:var(--ink);box-sizing:border-box}
.nrcard details summary{cursor:pointer;font-size:13.5px;font-weight:600;color:var(--ink-mid)}
.nrlog details{border-bottom:1px solid var(--sand);padding:6px 0}.nrlog details:last-child{border-bottom:0}
.nrlog ul{margin:6px 0 2px;padding-left:18px;font-size:13px}.nrlog li{margin:2px 0}
.nrlog .why{color:var(--muted)}
.nrtable{width:100%;border-collapse:collapse;font-size:13px}
.nrtable th,.nrtable td{padding:5px 8px;border-bottom:1px solid var(--sand);text-align:right;white-space:nowrap}
.nrtable th:first-child,.nrtable td:first-child{text-align:left;white-space:normal}
.nrtable th{font:600 11.5px var(--fb);color:var(--muted)}
.nrtwrap{overflow-x:auto}
.nrrise{color:var(--late);font-weight:700}
.nrbar{display:inline-block;height:8px;border-radius:4px;background:var(--navy);vertical-align:middle;margin-right:6px}
@media (max-width:860px){
  .nrhead h1{font-size:24px}.nrhead{gap:8px}
  .nrseg{order:3;flex:1 1 100%}.nrseg button{flex:1;padding:6px 0;white-space:nowrap}
  .nrhead .mini{margin-left:auto}
  .nrpane{display:none;position:static;max-height:none;padding:14px}
  .nr.reading .nrlist,.nr.reading .nrsum{display:none}
  .nr.reading .nrpane{display:flex}
  .nrback{display:inline-flex}
  .nrrow img,.nrsm,.nrkeys{display:none}
  .nrrow{min-height:44px}
  .nrhl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13.5px}
  .nrsplit{flex-direction:column;align-items:center}.nrcaps{width:100%}
}`;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const day = (iso) => { try { return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }); } catch { return iso; } };
const POSTED = { none: ["Not sent", "var(--muted)"], draft: ["Draft", "var(--wait)"], sent: ["Sent", "var(--done)"], deleted: ["Deleted", "var(--late)"] };
const PROV = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];

// Search: every word anywhere, in any order; "quotes" for a phrase; part of a word counts; case and accents don't.
function search(stories, q) {
  const phrases = [], terms = [];
  String(q ?? "").replace(/"([^"]+)"|(\S+)/g, (_, ph, w) => { if (ph) phrases.push(fold(ph).trim()); else if (w) terms.push(fold(w)); return ""; });
  const all = [...phrases, ...terms].filter(Boolean);
  if (!all.length) return stories;
  const out = [];
  for (const s of stories) {
    const f = [[fold(s.headline), 8], [fold(Object.values(s.keywords ?? {}).flat().join(" ")), 5], [fold(`${s.city} ${s.province} ${typeOf(s.type)[0]}`), 4], [fold(s.summary), 3], [fold(s.commentary), 1]];
    let score = 0, ok = true;
    for (const t of all) { const hit = f.filter(([x]) => x.includes(t)); if (!hit.length) { ok = false; break; } score += hit.reduce((n, [, w]) => n + w, 0); }
    if (ok) out.push([score, s]);
  }
  return out.sort((a, b) => b[0] - a[0] || String(b[1].night).localeCompare(String(a[1].night))).map(([, s]) => s);
}

export async function newsroomScreen(ctx) {
  const { ROOT, BARRIGHT, api, toast, key } = ctx;
  if (!document.getElementById("nrstyle")) { const st = document.createElement("style"); st.id = "nrstyle"; st.textContent = CSS; document.head.append(st); }
  BARRIGHT.innerHTML = "";
  const S = ctx.state ??= { tab: "stories", q: "", type: "", prov: "", agency: "", dates: "", posted: "", open: null, shown: 40, cap: "linkedin" };
  let home, stories = [];
  try { [home, { stories }] = await Promise.all([api("/newsroom"), api("/newsroom?index=1")]); }
  catch (e) { ROOT.innerHTML = `<div class="card"><div class="card-body"><div class="bad">${esc(e.message)}</div></div></div>`; return; }

  const last = home.nights.find((n) => n.finishedAt);
  ROOT.innerHTML = `<div class="nr" id="nr">
    <div class="nrhead"><h1>Newsroom</h1>
      <div class="nrseg" role="tablist">${[["stories", "Stories"], ["trends", "Trends"], ["control", "Control room"]].map(([k, l]) => `<button type="button" role="tab" data-nrtab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join("")}</div>
      <button type="button" class="mini" id="nr-run">${home.running ? "Running…" : "Run a sample"}</button></div>
    <details class="nrsum" id="nr-sum"><summary>${home.settings.on ? `<span class="on">On</span> · runs 2 a.m. Toronto` : `<span class="off">Off</span> · samples only`}${last ? ` · last ${last.mode === "sample" ? "sample" : "night"} ${esc(day(last.night))}: ${last.picked} written${last.refused ? `, ${last.refused} refused` : ""}` : " · no nights yet"} · <u>Change</u></summary></details>
    <div id="nr-body"></div></div>`;
  const NR = document.getElementById("nr");
  NR.querySelectorAll("[data-nrtab]").forEach((b) => (b.onclick = () => { S.tab = b.dataset.nrtab; S.open = null; newsroomScreen(ctx); }));
  document.getElementById("nr-sum").ontoggle = (e) => { if (e.target.open) { S.tab = "control"; newsroomScreen(ctx); } };
  const runBtn = document.getElementById("nr-run");
  runBtn.disabled = !!home.running;
  runBtn.onclick = async () => {
    runBtn.disabled = true; runBtn.textContent = "Starting…";
    try { await api("/newsroom?run=1", { method: "POST", body: JSON.stringify({ mode: "sample" }) }); toast("A sample night is running. It takes about ten minutes; nothing is sent anywhere."); poll(); }
    catch (e) { toast(e.message); runBtn.disabled = false; runBtn.textContent = "Run a sample"; }
  };
  const poll = () => setTimeout(async () => {
    if (!document.getElementById("nr")) return;
    const h = await api("/newsroom").catch(() => null);
    if (h?.running) { runBtn.textContent = "Running…"; poll(); } else newsroomScreen(ctx);
  }, 15000);
  if (home.running) poll();

  const body = document.getElementById("nr-body");
  if (S.tab === "control") return control(body, home);
  if (S.tab === "trends") return trends(body, stories);
  return library(body, stories);

  // ── Stories ──────────────────────────────────────────────────────────────────────────────────────────────────
  function library(host, all) {
    if (!all.length) { host.innerHTML = `<div class="nrcard"><div class="nrempty">No stories yet. <b>Run a sample</b> writes up a night's stories here, sending nothing anywhere.</div></div>`; return; }
    const types = [...new Set(all.map((s) => s.type))];
    const agencies = [...new Set(all.flatMap((s) => s.keywords?.agency ?? []))].sort();
    host.innerHTML = `<div class="nrcols">
      <section class="nrlist" aria-label="Stories">
        <div class="nrchips" role="group" aria-label="Story type"><button type="button" class="fchip${S.type ? "" : " on"}" data-nrtype="">All</button>${types.map((t) => `<button type="button" class="fchip${S.type === t ? " on" : ""}" data-nrtype="${esc(t)}">${esc(typeOf(t)[0])}</button>`).join("")}</div>
        <label class="nrsearch"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="color:var(--muted)"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
          <input type="search" id="nr-q" placeholder="Search stories" aria-label="Search stories" value="${esc(S.q)}"><span class="n" id="nr-n"></span></label>
        <div class="nrfilt">
          <select id="nr-prov" aria-label="Province"><option value="">Province</option>${PROV.map((p) => `<option${S.prov === p ? " selected" : ""}>${p}</option>`).join("")}</select>
          <select id="nr-ag" aria-label="Agency"><option value="">Agency</option>${agencies.map((a) => `<option${S.agency === a ? " selected" : ""}>${esc(a)}</option>`).join("")}</select>
          <select id="nr-dates" aria-label="Dates"><option value="">Any date</option>${[["7", "Last 7 days"], ["30", "Last 30 days"], ["365", "Last year"]].map(([v, l]) => `<option value="${v}"${S.dates === v ? " selected" : ""}>${l}</option>`).join("")}</select>
          <select id="nr-posted" aria-label="Posted"><option value="">Posted?</option>${[["sent", "Sent"], ["draft", "Draft"], ["none", "Not sent"], ["sample", "Samples"]].map(([v, l]) => `<option value="${v}"${S.posted === v ? " selected" : ""}>${l}</option>`).join("")}</select>
          <button type="button" class="mini" id="nr-xlsx">Excel</button></div>
        <div class="nrrows" id="nr-rows"></div><div class="nrmore" id="nr-more"></div>
      </section>
      <article class="nrpane" id="nr-pane" aria-label="Story"></article></div>`;
    const $ = (id) => document.getElementById(id);
    let list = [];
    const filter = () => {
      const since = S.dates ? new Date(Date.now() - Number(S.dates) * 86400000).toISOString().slice(0, 10) : "";
      list = search(all, S.q).filter((s) => (!S.type || s.type === S.type) && (!S.prov || s.province === S.prov) && (!S.agency || (s.keywords?.agency ?? []).includes(S.agency))
        && (!since || s.night >= since) && (!S.posted || (S.posted === "sample" ? s.mode === "sample" : s.posted === S.posted && s.mode !== "sample")));
      $("nr-n").textContent = `${list.length} ${list.length === 1 ? "story" : "stories"}`;
      draw();
    };
    const row = (s) => { const [tl, tc] = typeOf(s.type); const [pl, pc] = s.mode === "sample" ? ["Sample", "var(--wait)"] : POSTED[s.posted] ?? POSTED.none;
      return `<button type="button" class="nrrow${S.open === s.id ? " open" : ""}" data-nrid="${esc(s.id)}">
        ${s.image ? `<img loading="lazy" alt="" src="/api/newsimg?id=${encodeURIComponent(s.id)}">` : `<img alt="">`}
        <span class="nrrb"><span class="nrmeta"><span class="d">${esc(day(s.night))}</span><span class="t" style="color:${tc}">${esc(tl)}</span><span class="c">${esc([s.city, s.province].filter(Boolean).join(", "))}</span><span class="p" style="color:${pc}">${pl}</span></span>
        <span class="nrhl nrclip">${esc(s.headline)}</span><span class="nrsm nrclip">${esc(s.summary)}</span>
        <span class="nrkeys">${[...(s.keywords?.agency ?? []).slice(0, 1), ...(s.keywords?.crime ?? []).slice(0, 2), ...(s.keywords?.specifics ?? []).slice(0, 2)].map((k) => `<span class="nrkey" data-nrkey="${esc(k)}">${esc(k)}</span>`).join("")}${s.thread ? `<span class="nrthr">${s.thread + 1} updates · latest: ${esc(s.threadLatest || "update")}</span>` : ""}</span></span></button>`; };
    const draw = () => {
      $("nr-rows").innerHTML = list.slice(0, S.shown).map(row).join("") || `<div class="nrempty">No story matches.</div>`;
      $("nr-more").textContent = list.length > S.shown ? `${list.length - S.shown} more as you scroll` : "";
      $("nr-rows").querySelectorAll("[data-nrid]").forEach((b) => (b.onclick = (e) => { const k = e.target.closest("[data-nrkey]"); if (k) { e.stopPropagation(); S.q = `"${k.dataset.nrkey}"`; $("nr-q").value = S.q; filter(); return; } openStory(b.dataset.nrid); }));
    };
    new IntersectionObserver((es) => { if (es[0].isIntersecting && list.length > S.shown) { S.shown += 40; draw(); } }).observe($("nr-more"));
    $("nr-q").oninput = (e) => { S.q = e.target.value; S.shown = 40; filter(); };
    host.querySelectorAll("[data-nrtype]").forEach((b) => (b.onclick = () => { S.type = b.dataset.nrtype; host.querySelectorAll("[data-nrtype]").forEach((x) => x.classList.toggle("on", x === b)); filter(); }));
    for (const [id, k] of [["nr-prov", "prov"], ["nr-ag", "agency"], ["nr-dates", "dates"], ["nr-posted", "posted"]]) $(id).onchange = (e) => { S[k] = e.target.value; filter(); };
    $("nr-xlsx").onclick = async () => {
      try {
        const r = await fetch("/api/newsroom?xlsx=1", { method: "POST", headers: { "content-type": "application/json", "x-admin-key": key() }, body: JSON.stringify({ ids: list.map((s) => s.id) }) });
        if (!r.ok) throw new Error(`The download failed (${r.status}).`);
        const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = "ONGIA Newsroom stories.xlsx"; a.click();
      } catch (e) { toast(e.message); }
    };
    filter();
    const wide = matchMedia("(min-width: 861px)").matches;
    if (S.open) openStory(S.open); else if (wide && list[0]) openStory(list[0].id, true); else $("nr-pane").innerHTML = "";

    async function openStory(id, quiet = false) {
      S.open = id;
      $("nr-rows").querySelectorAll("[data-nrid]").forEach((b) => b.classList.toggle("open", b.dataset.nrid === id));
      const pane = $("nr-pane");
      pane.innerHTML = `<div class="nrempty">Opening…</div>`;
      if (!quiet || !wide) { NR.classList.add("reading"); if (!wide) window.scrollTo(0, 0); }
      let s;
      try { s = (await api(`/newsroom?story=${encodeURIComponent(id)}`)).story; } catch (e) { pane.innerHTML = `<div class="bad">${esc(e.message)}</div>`; return; }
      const [tl, tc] = typeOf(s.type);
      const [pl, pc] = POSTED[s.buffer?.status] ?? POSTED.none;
      const fv = { confirmed: "Confirmed", corrected: "Corrected", removed: "Removed" };
      const caps = { linkedin: "LinkedIn", instagram: "Instagram", x: "X" };
      pane.innerHTML = `<button type="button" class="mini nrback" id="nr-back">‹ Back</button>
        <div><div class="nrpm"><span style="color:${tc};font-weight:700">${esc(tl)}</span><span>${esc([s.city, s.province].filter(Boolean).join(", "))}</span><span style="color:var(--muted)">${esc(day(s.night))}</span>${s.mode === "sample" ? `<span class="nrsample">Sample</span>` : ""}${s.bigPicture ? `<span style="color:var(--navy);font-weight:700">Bigger picture</span>` : ""}<span style="margin-left:auto;color:${pc};font-weight:600">${s.mode === "sample" ? "Not sent (sample)" : pl}</span></div>
          <h2>${esc(s.headline)}</h2><a href="${esc(s.source.url)}" target="_blank" rel="noopener" style="font-size:12.5px">Source: ${esc(s.source.name)}${s.source.official ? " (official release)" : ""}</a></div>
        <div class="nrsplit"><img alt="The post image" src="/api/newsimg?id=${encodeURIComponent(s.id)}">
          <div class="nrcaps"><div class="nrtabs" role="tablist">${Object.entries(caps).map(([k, l]) => `<button type="button" role="tab" class="fchip${S.cap === k ? " on" : ""}" data-nrcap="${k}" aria-selected="${S.cap === k}">${l}</button>`).join("")}<button type="button" class="mini copy" id="nr-copy">Copy</button></div>
          <div class="nrcap" id="nr-cap">${esc(s.captions[S.cap])}</div></div></div>
        ${s.andrewComment ? `<div><div class="nrtabs"><span class="nrlab">Your comment for LinkedIn</span><button type="button" class="mini copy" id="nr-copyc">Copy</button></div><div class="nrcap">${esc(s.andrewComment)}</div></div>` : ""}
        <div><div class="nrlab">Fact check · ${s.facts.length} statements</div>${s.facts.map((f) => `<div class="nrfc"><b class="nrv-${esc(f.verdict)}">${fv[f.verdict] ?? "?"}</b><span>${esc(f.verdict === "corrected" && f.corrected ? f.corrected : f.statement)} · <a href="${esc(f.sourceUrl)}" target="_blank" rel="noopener">${esc(f.sourceName || "source")}</a></span></div>`).join("")}</div>
        ${s.comparisons?.length ? `<div><div class="nrlab">Similar cases</div>${s.comparisons.map((c) => `<div class="nrfc"><span>${esc(c.text)}${c.sourceUrl ? ` · <a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">source</a>` : ""}</span></div>`).join("")}</div>` : ""}
        ${s.thread?.length ? `<div><div class="nrlab">Case thread · ${s.thread.length + 1} steps</div><div class="nrfc"><span style="color:var(--muted)">${esc(day(s.night))}</span><span>${esc(s.headline)} (posted)</span></div>${s.thread.map((t) => `<div class="nrfc"><span style="color:var(--muted)">${esc(day(t.at.slice(0, 10)))}</span><span><b>${esc(t.step)}</b>: <a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.headline)}</a> (not posted)</span></div>`).join("")}</div>` : ""}
        <div><div class="nrlab">Keywords</div><div class="nrkw" id="nr-kw"></div></div>
        ${s.otherSources?.length ? `<div class="nrfc" style="color:var(--muted)"><span>Also reported by ${s.otherSources.map((o) => `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.name)}</a>`).join(", ")}</span></div>` : ""}`;
      $("nr-back").onclick = () => { NR.classList.remove("reading"); S.open = null; };
      pane.querySelectorAll("[data-nrcap]").forEach((b) => (b.onclick = () => { S.cap = b.dataset.nrcap; pane.querySelectorAll("[data-nrcap]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); }); $("nr-cap").textContent = s.captions[S.cap]; }));
      const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast("Copied."); } catch { toast("Couldn't copy here; select the text instead."); } };
      $("nr-copy").onclick = () => copy(s.captions[S.cap]);
      const cc = $("nr-copyc"); if (cc) cc.onclick = () => copy(s.andrewComment);
      keywords(s);
    }
    function keywords(s) {
      const box = $("nr-kw");
      const flat = Object.entries(s.keywords ?? {}).flatMap(([k, v]) => (v ?? []).map((w) => [k, w]));
      box.innerHTML = flat.map(([k, w], i) => `<span title="${esc(k)}">${esc(w)}<button type="button" aria-label="Remove ${esc(w)}" data-nrkx="${i}">×</button></span>`).join("") + `<input id="nr-kadd" placeholder="+ Add" aria-label="Add a keyword">`;
      const save = async (kw) => { try { const r = await api(`/newsroom?story=${encodeURIComponent(s.id)}`, { method: "PUT", body: JSON.stringify({ keywords: kw }) }); s.keywords = r.story.keywords; const e = all.find((x) => x.id === s.id); if (e) e.keywords = s.keywords; keywords(s); } catch (e) { toast(e.message); } };
      box.querySelectorAll("[data-nrkx]").forEach((b) => (b.onclick = () => { const [k, w] = flat[b.dataset.nrkx]; save({ [k]: s.keywords[k].filter((x) => x !== w) }); }));
      $("nr-kadd").onkeydown = (e) => { if (e.key !== "Enter" || !e.target.value.trim()) return; save({ specifics: [...(s.keywords.specifics ?? []), e.target.value.trim()] }); };
    }
  }

  // ── Trends ───────────────────────────────────────────────────────────────────────────────────────────────────
  function trends(host, all) {
    const live = all.filter((s) => s.mode !== "sample");
    const months = [...Array(6)].map((_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - (5 - i)); return d.toISOString().slice(0, 7); });
    const dim = S.dim ?? "crime";
    const valuesOf = (s) => dim === "province" ? [s.province].filter(Boolean) : dim === "agency" ? s.keywords?.agency ?? [] : dim === "specifics" ? s.keywords?.specifics ?? [] : s.keywords?.crime ?? [];
    const scope = S.tprov ? live.filter((s) => s.province === S.tprov) : live;
    const table = new Map();
    for (const s of scope) for (const v of valuesOf(s)) { const m = String(s.night).slice(0, 7); const row = table.get(v) ?? {}; row[m] = (row[m] ?? 0) + 1; table.set(v, row); }
    const rising = (row) => { const c = row[months[5]] ?? 0, p = [2, 3, 4].map((i) => row[months[i]] ?? 0); return c >= 3 && c >= (2 * (p[0] + p[1] + p[2])) / 3; };
    const rows = [...table.entries()].sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0)).slice(0, 25);
    const max = Math.max(1, ...rows.map(([, r]) => r[months[5]] ?? 0));
    const crimes = [...new Set(live.flatMap((s) => s.keywords?.crime ?? []))].sort();
    const byProv = PROV.map((p) => [p, crimes.map((c) => live.filter((s) => s.province === p && (s.keywords?.crime ?? []).includes(c) && (!S.tfrom || s.night >= S.tfrom) && (!S.tto || s.night <= S.tto)).length)]).filter(([, r]) => r.some(Boolean));
    host.innerHTML = `<div class="nrcard">
      <div class="nrfilt"><select id="nr-dim" aria-label="Count by">${[["crime", "Crime type"], ["province", "Province"], ["agency", "Agency"], ["specifics", "Drugs, firearms, projects"]].map(([v, l]) => `<option value="${v}"${dim === v ? " selected" : ""}>${l}</option>`).join("")}</select>
        <select id="nr-tprov" aria-label="Province"><option value="">All of Canada</option>${PROV.map((p) => `<option${S.tprov === p ? " selected" : ""}>${p}</option>`).join("")}</select></div>
      ${rows.filter(([, r]) => rising(r)).length ? `<div class="nrfc"><b class="nrrise">Rising</b><span>${rows.filter(([, r]) => rising(r)).map(([v, r]) => `${esc(v)} (${r[months[5]]} this month)`).join(" · ")}</span></div>` : ""}
      <div class="nrtwrap"><table class="nrtable"><thead><tr><th>${esc({ crime: "Crime type", province: "Province", agency: "Agency", specifics: "Detail" }[dim])}</th>${months.map((m) => `<th>${esc(new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", timeZone: "UTC" }))}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(([v, r]) => `<tr><td>${rising(r) ? `<span class="nrrise">▲</span> ` : ""}${esc(v)}</td>${months.map((m, i) => `<td>${i === 5 ? `<span class="nrbar" style="width:${Math.round(((r[m] ?? 0) / max) * 40)}px"></span>` : ""}${r[m] ?? 0}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="7" class="nrempty">No stories yet${S.tprov ? ` in ${S.tprov}` : ""}.</td></tr>`}</tbody></table></div>
      <p class="hint" style="margin:0">Counts are of stories ONGIA wrote up, not official statistics. Samples are left out. Rising: at least double its three-month average and at least 3 stories this month.</p></div>
    <div class="nrcard"><div class="nrfilt"><span class="nrlab">Crime by province</span><input type="date" id="nr-tfrom" aria-label="From" value="${esc(S.tfrom ?? "")}" class="nrnum" style="width:auto"><input type="date" id="nr-tto" aria-label="To" value="${esc(S.tto ?? "")}" class="nrnum" style="width:auto"></div>
      <div class="nrtwrap"><table class="nrtable"><thead><tr><th>Province</th>${crimes.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${byProv.map(([p, r]) => `<tr><td>${p}</td>${r.map((n) => `<td>${n || ""}</td>`).join("")}</tr>`).join("") || `<tr><td class="nrempty">No stories yet.</td></tr>`}</tbody></table></div>
      <p class="hint" style="margin:0">Gaps (themes trending in a province that ONGIA hasn't covered at an event there in two years) appear here once there are a few months of stories.</p></div>`;
    document.getElementById("nr-dim").onchange = (e) => { S.dim = e.target.value; trends(host, all); };
    document.getElementById("nr-tprov").onchange = (e) => { S.tprov = e.target.value; trends(host, all); };
    document.getElementById("nr-tfrom").onchange = (e) => { S.tfrom = e.target.value; trends(host, all); };
    document.getElementById("nr-tto").onchange = (e) => { S.tto = e.target.value; trends(host, all); };
  }

  // ── Control room ─────────────────────────────────────────────────────────────────────────────────────────────
  function control(host, h) {
    const st = h.settings, src = h.sources;
    host.innerHTML = `<div class="nrcard">
      <div class="nrline"><span class="grow"><b>Newsroom</b> · ${st.on ? "runs every night at 2 a.m. Toronto" : "off: nothing runs on its own"}</span><button type="button" class="mini${st.on ? "" : " gold"}" id="nr-on">${st.on ? "Switch off" : "Switch on"}</button></div>
      <div class="nrline"><span class="grow">Stories a night</span><input class="nrnum" type="number" id="nr-min" min="1" max="12" value="${st.perNight.min}" aria-label="At least"> to <input class="nrnum" type="number" id="nr-max" min="1" max="12" value="${st.perNight.max}" aria-label="At most"><button type="button" class="mini" id="nr-savepn">Save</button></div>
      <div class="nrline"><span class="grow">Buffer</span><span class="st" style="color:var(--muted)">Not connected yet: nights fill the library only</span></div>
      <details><summary>Subjects · ${st.topics.length}</summary><textarea id="nr-topics" aria-label="Subjects, one a line">${esc(st.topics.join("\n"))}</textarea><button type="button" class="mini" id="nr-savet">Save subjects</button></details>
      <details><summary>Sources · ${src.feeds.length} feeds, ${src.officialSites.length} police and agency sites, ${src.newsQueries.length} news searches${st.sources ? " (changed here)" : ""}</summary>
        <p class="hint">Feeds, one a line: name | address | official (yes/no)</p><textarea id="nr-feeds">${esc(src.feeds.map((f) => `${f.name} | ${f.url} | ${f.official ? "yes" : "no"}`).join("\n"))}</textarea>
        <p class="hint">Police and agency sites, one a line: name | web address | province | photos cleared (yes/no)</p><textarea id="nr-sites">${esc(src.officialSites.map((o) => `${o.name} | ${o.domain} | ${o.province || ""} | ${o.photos ? "yes" : "no"}`).join("\n"))}</textarea>
        <p class="hint">News searches (Google News, Canada, last day), one a line; start with "fr:" to search in French</p><textarea id="nr-queries" style="min-height:80px">${esc(src.newsQueries.join("\n"))}</textarea>
        <div style="display:flex;gap:8px"><button type="button" class="mini" id="nr-saves">Save sources</button>${st.sources ? `<button type="button" class="mini" id="nr-resets">Back to the standard list</button>` : ""}</div></details>
    </div>
    <div class="nrcard nrlog"><div class="nrlab">Nights</div>${h.nights.length ? h.nights.map((n) => `<details data-nrnight="${esc(n.id)}"><summary>${esc(day(n.night))} · ${n.mode === "sample" ? "Sample" : "Live"} · ${n.finishedAt ? `${n.picked} written${n.refused ? ` · ${n.refused} refused` : ""}${n.errors ? ` · ${n.errors} errors` : ""} · $${Number(n.usd).toFixed(2)}` : "running…"}</summary><div class="nrnightbody">Opening…</div></details>`).join("") : `<div class="nrempty">No nights yet.</div>`}</div>`;
    const $ = (id) => document.getElementById(id);
    const save = async (patch, msg) => { try { await api("/newsroom", { method: "PUT", body: JSON.stringify(patch) }); toast(msg); newsroomScreen(ctx); } catch (e) { toast(e.message); } };
    $("nr-on").onclick = () => {
      if (!st.on && !confirm("Switch the Newsroom on? It will run every night at 2 a.m. Toronto. Until Buffer is connected, nights fill the library only; nothing is posted.")) return;
      save({ on: !st.on }, st.on ? "Switched off." : "Switched on.");
    };
    $("nr-savepn").onclick = () => save({ perNight: { min: Number($("nr-min").value), max: Number($("nr-max").value) } }, "Saved.");
    $("nr-savet").onclick = () => save({ topics: $("nr-topics").value.split("\n").map((t) => t.trim()).filter(Boolean) }, "Subjects saved.");
    const lines = (id) => $(id).value.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0]);
    $("nr-saves").onclick = () => save({ sources: {
      feeds: lines("nr-feeds").map(([name, url, off]) => ({ name, url, official: /^y/i.test(off ?? ""), kind: /io-server|atom/.test(url ?? "") ? "atom" : "rss", agency: /gc\/news/.test(url ?? "") ? name.replace(/ news.*$/i, "") : "" })),
      officialSites: lines("nr-sites").map(([name, domain, province, photos]) => ({ name, domain, province, photos: /^y/i.test(photos ?? ""), agency: name })),
      newsQueries: $("nr-queries").value.split("\n").map((q) => q.trim()).filter(Boolean),
    } }, "Sources saved.");
    const rs = $("nr-resets"); if (rs) rs.onclick = () => save({ sources: null }, "Back to the standard list.");
    host.querySelectorAll("[data-nrnight]").forEach((d) => (d.ontoggle = async () => {
      if (!d.open || d.dataset.loaded) return; d.dataset.loaded = "1";
      const box = d.querySelector(".nrnightbody");
      try {
        const n = (await api(`/newsroom?night=${encodeURIComponent(d.dataset.nrnight)}`)).night;
        const li = (x, extra = "") => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>${extra}</li>`;
        const sec = (t, items, f) => items?.length ? `<div class="nrlab" style="margin-top:6px">${t} · ${items.length}</div><ul>${items.map(f).join("")}</ul>` : "";
        box.innerHTML = `<div class="hint" style="margin:4px 0">Read back to ${esc(new Date(n.since).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" }))} · ${n.found.length} found · ${n.usage ? `${n.usage.calls} Claude calls, ${n.usage.searches} searches, $${Number(n.usage.usd).toFixed(2)}` : ""}${n.mode === "sample" ? " · a sample: nothing sent, nothing marked covered" : ""}</div>`
          + sec("Picked", n.picked, (x) => li(x, ` <span class="why">· ${esc(x.why)}</span>`))
          + sec("Updates to earlier stories (not posted)", n.updates, (x) => li(x, ` <span class="why">· ${esc(x.step)} · ${esc(x.why)}</span>`))
          + sec("Refused", n.refused, (x) => li(x, ` <span class="why">· ${esc((x.why ?? []).join("; "))}</span>`))
          + sec("Skipped", n.skipped, (x) => li(x, ` <span class="why">· ${esc(x.why)}</span>`))
          + sec("Errors", n.errors, (x) => `<li>${esc(x)}</li>`)
          + sec("Notes", n.usage?.notes, (x) => `<li>${esc(x)}</li>`)
          + sec("Sources", n.sources, (x) => `<li>${esc(x.source)}: ${x.error ? `<span class="nrrise">${esc(x.error)}</span>` : `${x.found} found`}</li>`);
      } catch (e) { box.innerHTML = `<div class="bad">${esc(e.message)}</div>`; }
    }));
  }
}
