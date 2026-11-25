/* Stipendi e pagamenti — versione per cellulare.
   Tutti i dati (mesi e PDF delle buste paga) restano in IndexedDB su questo dispositivo.
   Nel repository non ci sono dati personali. */
"use strict";
(() => {
const MESI = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const $ = id => document.getElementById(id);
const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const fmt = v => v == null || v === "" ? "" : eur.format(+v);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fd = s => { if (!s) return ""; const [y, m, d] = String(s).split("-"); return d && m && y ? `${d}/${m}/${y.slice(2)}` : esc(s); };
const num = v => v === "" || v == null || isNaN(+v) ? null : Math.round(+v * 100) / 100;
const key = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
const tot = r => (num(r.acconto) || 0) + (num(r.saldo) || 0);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

/* ---------- Archivio locale (IndexedDB) ---------- */
let idb = null;
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("stipendi", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("mesi")) d.createObjectStore("mesi", { keyPath: "id" });
      if (!d.objectStoreNames.contains("pdf")) d.createObjectStore("pdf", { keyPath: "id" });
      if (!d.objectStoreNames.contains("conf")) d.createObjectStore("conf", { keyPath: "k" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = idb.transaction(stores, mode);
    let out;
    Promise.resolve(fn(t)).then(v => { out = v; }, rej);
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error("Operazione annullata"));
  });
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const getAll = store => tx([store], "readonly", t => reqP(t.objectStore(store).getAll()));
const getOne = (store, id) => tx([store], "readonly", t => reqP(t.objectStore(store).get(id)));
const conf = async k => (await getOne("conf", k))?.v;
const setConf = (k, v) => tx(["conf"], "readwrite", t => { t.objectStore("conf").put({ k, v }); });

let docs = {}, year = new Date().getFullYear(), editing = null, pending = null, loaded = false;
async function reload() {
  docs = {};
  for (const r of await getAll("mesi")) if (r.anno && r.mese) docs[key(r.anno, r.mese)] = r;
  loaded = true;
  render();
}

function clean(y, m, d) {
  return {
    id: key(y, m), anno: y, mese: m,
    acconto: num(d.acconto), dataAcconto: d.dataAcconto || "",
    saldo: num(d.saldo), dataSaldo: d.dataSaldo || "",
    cedolino: num(d.cedolino),
    file: d.file || "", pdf: d.pdf || "", note: d.note || "",
    aggiornato: new Date().toISOString()
  };
}
let askedPersist = false;
async function persist() {
  if (askedPersist) return; askedPersist = true;
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (_) {}
}

/* ---------- Messaggi ---------- */
let msgT;
const msg = (t, err) => { const e = $("msg"); e.textContent = t || ""; e.className = "msg" + (err ? " err" : ""); clearTimeout(msgT); if (t && !err) msgT = setTimeout(() => { e.textContent = ""; }, 6000); };

/* ---------- Vista ---------- */
function years() {
  const s = new Set(Object.values(docs).map(d => d.anno)); s.add(year); s.add(new Date().getFullYear());
  return [...s].filter(Boolean).sort((a, b) => a - b);
}
function render() {
  $("title").textContent = "Stipendi";
  $("year").innerHTML = years().map(y => `<option value="${+y}"${y == year ? " selected" : ""}>${+y}</option>`).join("");
  let sAcc = 0, sSal = 0, sTot = 0, sNet = 0, open = 0, html = "";
  for (let m = 1; m <= 12; m++) {
    const r = docs[key(year, m)];
    if (!r) { html += `<li class="mon empty" data-m="${m}">${MESI[m-1]} ${year} · tocca per aggiungere</li>`; continue; }
    const t = tot(r), n = num(r.cedolino), diff = n == null ? null : Math.round((t - n) * 100) / 100;
    sAcc += num(r.acconto) || 0; sSal += num(r.saldo) || 0; sTot += t;
    if (n != null) { sNet += n; if (diff < 0) open++; }
    const pct = n ? Math.min(100, t / n * 100) : 0;
    const dtxt = diff == null ? "" : diff === 0 ? `<span class="diff even">in pari</span>` : diff < 0 ? `<span class="diff neg">mancano ${fmt(-diff)}</span>` : `<span class="diff pos">+${fmt(diff)}</span>`;
    const pdf = r.pdf ? `<div class="mpdf">📄 <button type="button" data-view="${esc(r.id)}">${esc(r.file || "Busta paga.pdf")}</button></div>`
      : r.file ? `<div class="mpdf">📄 ${esc(r.file)} · PDF non ancora nell'app</div>` : "";
    html += `<li class="mon" data-m="${m}">
      <div class="mtop"><b>${MESI[m-1]} ${year}</b>${dtxt}</div>
      <div class="meter${pct >= 100 ? " full" : ""}" title="${Math.round(pct)}% ricevuto"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="mdet">
        <div><span>Acconto</span> ${fmt(r.acconto) || "—"} <em>${fd(r.dataAcconto)}</em></div>
        <div><span>Saldo</span> ${fmt(r.saldo) || "—"} <em>${fd(r.dataSaldo)}</em></div>
        <div><span>Totale</span> ${fmt(t)}</div>
        <div><span>Cedolino</span> ${fmt(n) || "—"}</div>
      </div>
      ${r.note ? `<div class="mpdf">${esc(r.note)}</div>` : ""}${pdf}
    </li>`;
  }
  const due = Math.round((sNet - sTot) * 100) / 100;
  html += `<li class="tot"><div class="mtop"><b>Totale ${year}</b><span class="diff ${due > 0 ? "neg" : due < 0 ? "pos" : "even"}">${due ? (due < 0 ? "+" + fmt(-due) : "mancano " + fmt(due)) : "in pari"}</span></div>
    <div class="mdet"><div><span>Acconti</span> ${fmt(sAcc)}</div><div><span>Saldi</span> ${fmt(sSal)}</div><div><span>Ricevuto</span> ${fmt(sTot)}</div><div><span>Cedolini</span> ${fmt(sNet)}</div></div></li>`;
  $("rows").innerHTML = html;
  $("kDue").textContent = loaded ? fmt(Math.max(0, due)) : "–";
  $("kNet").textContent = loaded ? fmt(sNet) : "–";
  $("kRec").textContent = loaded ? fmt(sTot) : "–";
  $("kOpen").textContent = loaded ? String(open) : "–";
  backupBanner();
}

async function backupBanner() {
  const b = $("banner");
  if (!Object.keys(docs).length) { b.hidden = true; return; }
  const last = await conf("ultimoBackup");
  const days = last ? (Date.now() - new Date(last)) / 864e5 : Infinity;
  if (days < 30) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = `${last ? "Ultimo backup più di un mese fa." : "Non hai ancora fatto un backup."} I dati sono solo su questo telefono: un backup ti protegge se lo perdi o cancelli l'app.<br><button class="btn small" type="button" id="bBak">Crea backup ora</button>`;
  $("bBak").onclick = backup;
}

/* ---------- Modifica mese ---------- */
const mOpts = MESI.map((n, i) => `<option value="${i+1}">${n}</option>`).join("");
$("fMonth").innerHTML = mOpts; $("pMonth").innerHTML = mOpts;

function calc() {
  const t = (num($("fAcc").value) || 0) + (num($("fSal").value) || 0), n = num($("fNet").value);
  $("calc").textContent = `Totale ricevuto ${fmt(t)}` + (n != null ? ` · Cedolino ${fmt(n)} · ${t >= n ? (t > n ? "ricevuto in più " + fmt(t - n) : "in pari") : "mancano " + fmt(n - t)}` : "");
}
["fAcc","fSal","fNet"].forEach(i => $(i).addEventListener("input", calc));

function pdfNow(r) {
  const e = $("pdfNow");
  if (pending) { e.textContent = "Da salvare: " + pending.name; return; }
  if (r.pdf) { e.innerHTML = `<button type="button" class="link" data-view="${esc(r.id)}">${esc(r.file || "Apri PDF")}</button>`; return; }
  e.textContent = r.file ? r.file + " (PDF non ancora nell'app)" : "Nessun PDF allegato";
}
function openEdit(y, m, pre, file) {
  const base = docs[key(y, m)] || {};
  const r = Object.assign({}, base, pre || {});
  pending = file || null;
  editing = { y, m, exists: !!docs[key(y, m)], file: pre?.file ?? base.file ?? "" };
  $("dTitle").textContent = `${MESI[m-1]} ${y}`;
  $("dSub").textContent = pre && pre._src ? pre._src : (editing.exists ? "Modifica i valori del mese." : "Nuovo mese.");
  $("fMonth").value = m; $("fYear").value = y;
  $("fAcc").value = r.acconto ?? ""; $("fAccD").value = r.dataAcconto || "";
  $("fSal").value = r.saldo ?? ""; $("fSalD").value = r.dataSaldo || "";
  $("fNet").value = r.cedolino ?? ""; $("fNote").value = r.note || "";
  $("fPdfT").textContent = r.pdf || pending ? "Sostituisci PDF" : "Allega PDF";
  pdfNow(r);
  $("del").hidden = !editing.exists; $("del").textContent = "Elimina"; $("del").dataset.c = "";
  $("dMsg").textContent = ""; calc(); $("dlg").showModal();
}

async function storePdf(file) {
  const id = uid();
  const blob = new Blob([await file.arrayBuffer()], { type: "application/pdf" });
  await tx(["pdf"], "readwrite", t => { t.objectStore("pdf").put({ id, name: file.name, blob }); });
  return id;
}

$("frm").addEventListener("submit", async e => {
  e.preventDefault();
  const y = +$("fYear").value, m = +$("fMonth").value;
  if (!y || !m) { $("dMsg").textContent = "Indica mese e anno."; return; }
  const moving = editing.exists && (y !== editing.y || m !== editing.m);
  if (moving && docs[key(y, m)]) { $("dMsg").textContent = `${MESI[m-1]} ${y} esiste già: modificalo da lì.`; return; }
  $("save").disabled = true;
  try {
    const old = docs[key(editing.y, editing.m)] || {};
    let pdf = old.pdf || "";
    if (pending) pdf = await storePdf(pending);
    const rec = clean(y, m, { acconto: $("fAcc").value, dataAcconto: $("fAccD").value, saldo: $("fSal").value, dataSaldo: $("fSalD").value,
      cedolino: $("fNet").value, file: pending ? pending.name : editing.file, pdf, note: $("fNote").value.trim() });
    await tx(["mesi","pdf"], "readwrite", t => {
      if (moving) t.objectStore("mesi").delete(key(editing.y, editing.m));
      t.objectStore("mesi").put(rec);
      if (pending && old.pdf && old.pdf !== pdf) t.objectStore("pdf").delete(old.pdf);
    });
    persist();
    pending = null; year = y; $("dlg").close(); await reload(); msg(`${MESI[m-1]} ${y} salvato.`);
  } catch (err) { $("dMsg").textContent = quotaMsg(err) || "Salvataggio non riuscito."; }
  $("save").disabled = false;
});
const quotaMsg = err => err && /quota/i.test(err.name + err.message) ? "Spazio sul telefono esaurito per l'app." : err?.message;

$("cancel").addEventListener("click", () => $("dlg").close());
$("del").addEventListener("click", async () => {
  const b = $("del");
  if (!b.dataset.c) { b.dataset.c = "1"; b.textContent = "Conferma eliminazione"; return; }
  try {
    const old = docs[key(editing.y, editing.m)] || {};
    await tx(["mesi","pdf"], "readwrite", t => { t.objectStore("mesi").delete(key(editing.y, editing.m)); if (old.pdf) t.objectStore("pdf").delete(old.pdf); });
    $("dlg").close(); await reload(); msg("Mese eliminato.");
  } catch (err) { $("dMsg").textContent = err.message || "Eliminazione non riuscita."; }
});
$("fPdf").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  pending = f; $("fPdfT").textContent = "Sostituisci PDF"; pdfNow({});
  try { const p = parse(await pdfText(f), f.name, await conf("nome")); if (p.cedolino != null && $("fNet").value === "") { $("fNet").value = p.cedolino; calc(); } } catch (_) {}
});
$("dlg").addEventListener("close", () => { pending = null; });
$("rows").addEventListener("click", e => {
  const v = e.target.closest("[data-view]"); if (v) { viewPdf(v.dataset.view); return; }
  const li = e.target.closest("li[data-m]"); if (li) openEdit(year, +li.dataset.m);
});
$("pdfNow").addEventListener("click", e => { const v = e.target.closest("[data-view]"); if (v) viewPdf(v.dataset.view); });
$("year").addEventListener("change", e => { year = +e.target.value; render(); });

/* ---------- Registra pagamento ---------- */
$("addPay").addEventListener("click", () => {
  let m = new Date().getMonth() + 1;
  for (let i = 1; i <= 12; i++) { const r = docs[key(year, i)]; if (r && num(r.cedolino) != null && tot(r) < num(r.cedolino)) { m = i; break; } }
  $("pMonth").value = m; $("pYear").value = year; $("pAmt").value = ""; $("pDate").value = today(); $("pMsg").textContent = ""; $("payDlg").showModal();
});
$("pCancel").addEventListener("click", () => $("payDlg").close());
$("payFrm").addEventListener("submit", async e => {
  e.preventDefault();
  const y = +$("pYear").value, m = +$("pMonth").value, a = num($("pAmt").value), d = $("pDate").value;
  if (!a) { $("pMsg").textContent = "Indica un importo."; return; }
  const r = Object.assign({}, docs[key(y, m)] || {});
  if (!num(r.acconto)) { r.acconto = a; r.dataAcconto = d; }
  else { r.saldo = (num(r.saldo) || 0) + a; r.dataSaldo = d; }
  try {
    await tx(["mesi"], "readwrite", t => { t.objectStore("mesi").put(clean(y, m, r)); });
    persist(); year = y; $("payDlg").close(); await reload(); msg(`Pagamento di ${fmt(a)} registrato su ${MESI[m-1]} ${y}.`);
  } catch (err) { $("pMsg").textContent = err.message || "Non riuscito."; }
});

/* ---------- Lettura della busta paga ---------- */
const AMT = /\d{1,3}(?:\.\d{3})*,\d{2}/;
const toNum = s => +s.replace(/\./g, "").replace(",", ".");
async function pdfText(file) {
  if (!window.pdfjsLib) throw new Error("Lettore PDF non caricato.");
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pg = await pdf.getPage(1); const c = await pg.getTextContent();
  return c.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
}
const isAmt = i => /^-?[\d.,]+$/.test(i.s) && AMT.test(i.s);
function nearAmount(items, a) {
  // importo più vicino sotto l'etichetta (stessa colonna) o alla sua destra (stessa riga)
  const c = items.filter(i => isAmt(i) && i !== a && (
    (i.y < a.y && a.y - i.y < 40 && Math.abs(i.x - a.x) < 140) || (Math.abs(i.y - a.y) < 4 && i.x > a.x)));
  c.sort((p, q) => (Math.abs(a.y - p.y) + Math.abs(p.x - a.x) / 4) - (Math.abs(a.y - q.y) + Math.abs(q.x - a.x) / 4));
  return c[0] ? toNum(c[0].s.match(AMT)[0]) : null;
}
function parse(items, name, nome) {
  const all = items.map(i => i.s).join(" ");
  const out = {};
  const mm = all.match(new RegExp("(" + MESI.join("|") + ")\\s+(20\\d{2})", "i"));
  if (mm) { out.mese = MESI.findIndex(n => n.toLowerCase() === mm[1].toLowerCase()) + 1; out.anno = +mm[2]; }
  const fm = name.match(/^(\d{1,2})[\s_-]/), fn = name.match(new RegExp(MESI.join("|"), "i"));
  if (!out.mese && fm && +fm[1] >= 1 && +fm[1] <= 12) out.mese = +fm[1];
  if (!out.mese && fn) out.mese = MESI.findIndex(n => n.toLowerCase() === fn[0].toLowerCase()) + 1;
  const fy = name.match(/(20\d{2})/); if (!out.anno && fy) out.anno = +fy[1];
  // 1) vicino al nome del dipendente (se impostato)
  if (nome && nome.trim()) {
    const re = new RegExp(nome.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "i");
    const n = items.find(i => re.test(i.s));
    if (n) {
      const cand = items.filter(i => isAmt(i) && i.y < n.y && n.y - i.y < 40).sort((a, b) => (n.y - a.y) - (n.y - b.y));
      if (cand[0]) out.cedolino = toNum(cand[0].s.match(AMT)[0]);
    }
  }
  // 2) vicino a un'etichetta "NETTO"
  if (out.cedolino == null) {
    const labels = items.filter(i => /netto\s*(in\s*busta|del\s*mese|a\s*pagare|da\s*pagare|busta)?/i.test(i.s) && !/non|imponibile/i.test(i.s));
    for (const l of labels.sort((a, b) => /busta|mese|pagare/i.test(b.s) - /busta|mese|pagare/i.test(a.s))) {
      const v = nearAmount(items, l); if (v != null && v > 0) { out.cedolino = v; break; }
    }
  }
  return out;
}

async function readPayslip(f) {
  const items = await pdfText(f);
  return parse(items, f.name, await conf("nome"));
}

$("pdf").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  msg(`Leggo ${f.name}…`);
  try {
    const p = await readPayslip(f);
    const y = +p.anno || year, m = +p.mese;
    if (!m) { msg("Non ho riconosciuto il mese: scegline uno.", true); openEdit(y, new Date().getMonth() + 1, { file: f.name, _src: `Da ${f.name}: mese non riconosciuto, controlla.` }, f); return; }
    msg("");
    openEdit(y, m, { cedolino: p.cedolino ?? (docs[key(y, m)] || {}).cedolino, file: f.name,
      _src: `Letto da ${f.name}: netto ${p.cedolino != null ? fmt(p.cedolino) : "non trovato, inseriscilo a mano"}. Controlla e salva: il PDF resterà nell'app.` }, f);
  } catch (err) { msg("Non sono riuscito a leggere il PDF: " + (err.message || err), true); }
});

/* Più PDF insieme: abbina ciascuno al suo mese */
$("pdfMany").addEventListener("change", async e => {
  const files = [...e.target.files]; e.target.value = ""; $("menuDlg").close();
  if (!files.length) return;
  let ok = 0; const skip = [];
  for (const f of files) {
    msg(`Leggo ${f.name} (${ok + skip.length + 1}/${files.length})…`);
    try {
      const p = await readPayslip(f);
      const y = +p.anno || year, m = +p.mese;
      if (!m) { skip.push(f.name); continue; }
      const old = docs[key(y, m)] || {};
      const pdf = await storePdf(f);
      const rec = clean(y, m, Object.assign({}, old, { pdf, file: f.name, cedolino: old.cedolino ?? p.cedolino }));
      await tx(["mesi","pdf"], "readwrite", t => { t.objectStore("mesi").put(rec); if (old.pdf) t.objectStore("pdf").delete(old.pdf); });
      docs[key(y, m)] = rec; ok++;
    } catch (_) { skip.push(f.name); }
  }
  persist(); await reload();
  msg(`${ok} buste paga abbinate.` + (skip.length ? ` Mese non riconosciuto per: ${skip.join(", ")}. Allegale aprendo il mese.` : ""), !!skip.length);
});

/* ---------- Visualizzatore PDF ---------- */
let viewing = null;
async function viewPdf(monthId) {
  const r = Object.values(docs).find(d => d.id === monthId); if (!r || !r.pdf) return;
  const p = await getOne("pdf", r.pdf);
  if (!p) { msg("PDF non trovato nell'app.", true); return; }
  viewing = p;
  $("vName").textContent = p.name || r.file || "Busta paga";
  const box = $("vPages"); box.innerHTML = "<p style='color:#fff'>Apro il PDF…</p>";
  $("viewDlg").showModal();
  try {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await p.blob.arrayBuffer()) }).promise;
    box.innerHTML = "";
    const w = Math.min(box.clientWidth - 20, 900), dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (w / vp0.width) * dpr });
      const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
      box.appendChild(cv);
      await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
    }
  } catch (err) { box.innerHTML = `<p style='color:#fff'>Non riesco a mostrare il PDF qui. Usa "Condividi / salva".</p>`; }
}
$("vClose").addEventListener("click", () => { $("viewDlg").close(); $("vPages").innerHTML = ""; viewing = null; });
$("vShare").addEventListener("click", () => { if (viewing) giveFile(viewing.blob, viewing.name || "busta-paga.pdf"); });

/* ---------- Condividi / scarica un file ---------- */
async function giveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (err) { if (err.name === "AbortError") return false; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

/* ---------- Menu ---------- */
const xd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : ""; };
$("menuBtn").addEventListener("click", () => $("menuDlg").showModal());
$("mExp").addEventListener("click", async () => {
  $("menuDlg").close();
  const data = [["MESE","ACCONTO","DATA ACCONTO","SALDO","DATA SALDO","TOTALE","CEDOLINO","DIFFERENZA","BUSTA PAGA","NOTE"]];
  for (let m = 1; m <= 12; m++) {
    const r = docs[key(year, m)] || {}, t = tot(r), n = num(r.cedolino);
    data.push([`${MESI[m-1]} ${year}`, num(r.acconto), xd(r.dataAcconto), num(r.saldo), xd(r.dataSaldo), docs[key(year, m)] ? t : null, n, n == null ? null : Math.round((t - n) * 100) / 100, r.file || "", r.note || ""]);
  }
  try {
    const ws = XLSX.utils.aoa_to_sheet(data, { cellDates: true, dateNF: "dd/mm/yyyy" }); ws["!cols"] = [16,10,12,10,12,10,10,11,22,24].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Pagamenti " + year);
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    if (await giveFile(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `tracciamento_pagamenti_${year}.xlsx`)) msg("File Excel pronto.");
  } catch (err) { msg("Esportazione non riuscita.", true); }
});

/* ---------- Backup e ripristino ---------- */
const b64 = async blob => { const u8 = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => { const bin = atob(s); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Blob([u8], { type: "application/pdf" }); };

async function backup() {
  $("menuDlg").open && $("menuDlg").close();
  msg("Preparo il backup…");
  try {
    const mesi = await getAll("mesi"), pdfs = await getAll("pdf");
    const out = { app: "stipendi-pwa", versione: 1, creato: new Date().toISOString(), nome: (await conf("nome")) || "", mesi, pdf: [] };
    for (const p of pdfs) out.pdf.push({ id: p.id, name: p.name, data: await b64(p.blob) });
    const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
    if (await giveFile(blob, `stipendi-backup-${today()}.json`)) { await setConf("ultimoBackup", new Date().toISOString()); msg(`Backup pronto: ${mesi.length} mesi, ${pdfs.length} PDF. Conservalo fuori dal telefono (es. Dropbox).`); render(); }
    else msg("");
  } catch (err) { msg("Backup non riuscito: " + (err.message || err), true); }
}
$("mBak").addEventListener("click", backup);

$("restore").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; $("menuDlg").close(); if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== "stipendi-pwa" || !Array.isArray(d.mesi)) throw new Error("Non è un backup di questa app.");
    const n = Object.keys(docs).length;
    if (n && !confirm(`Il ripristino sostituisce i ${n} mesi presenti sul telefono con quelli del backup (${d.mesi.length} mesi). Continuare?`)) return;
    await tx(["mesi","pdf"], "readwrite", t => {
      t.objectStore("mesi").clear(); t.objectStore("pdf").clear();
      for (const p of d.pdf || []) if (p.id && p.data) t.objectStore("pdf").put({ id: p.id, name: p.name || "busta-paga.pdf", blob: unb64(p.data) });
      for (const r of d.mesi) if (r.anno && r.mese) t.objectStore("mesi").put(Object.assign({}, r, { id: key(r.anno, r.mese) }));
    });
    if (d.nome && !(await conf("nome"))) await setConf("nome", d.nome);
    await setConf("ultimoBackup", d.creato || new Date().toISOString());
    persist();
    const ys = d.mesi.map(r => r.anno).filter(Boolean); if (ys.length) year = Math.max(...ys);
    await reload(); msg(`Ripristinati ${d.mesi.length} mesi e ${(d.pdf || []).length} PDF.`);
  } catch (err) { msg("Ripristino non riuscito: " + (err.message || err), true); }
});

/* ---------- Import da Excel ---------- */
function cellNum(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Math.round(v * 100) / 100;
  let s = String(v).replace(/[€\s]/g, "");
  if (!/\d/.test(s)) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/,/g, "");
  return isNaN(+s) ? null : Math.round(+s * 100) / 100;
}
const iso = (y, m, d) => (y > 1999 && m >= 1 && m <= 12 && d >= 1 && d <= 31) ? `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}` : "";
function cellDate(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date && !isNaN(v)) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === "number" && v > 30000 && v < 80000) { const d = XLSX.SSF.parse_date_code(v); return iso(d.y, d.m, d.d); }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return iso(y, +m[2], +m[1]) || iso(y, +m[1], +m[2]); }
  return "";
}
$("xlsIn").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; $("menuDlg").close(); if (!f) return;
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
    const found = [];
    for (const sn of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
      let col = null;
      for (const row of rows) {
        const up = row.map(c => typeof c === "string" ? c.trim().toUpperCase() : "");
        if (!col) { if (up.includes("MESE")) { col = {}; up.forEach((h, i) => { if (h && !(h in col)) col[h] = i; }); } continue; }
        const lab = row[col.MESE]; if (typeof lab !== "string") continue;
        const mm = lab.match(new RegExp("(" + MESI.join("|") + ")\\s*(\\d{4})?", "i")); if (!mm) continue;
        const m = MESI.findIndex(n => n.toLowerCase() === mm[1].toLowerCase()) + 1;
        const y = mm[2] ? +mm[2] : (+(String(sn + " " + f.name).match(/20\d{2}/) || [])[0] || year);
        const g = h => col[h] != null ? row[col[h]] : null;
        const acc = cellNum(g("ACCONTO")), sal = cellNum(g("SALDO")), ced = cellNum(g("CEDOLINO"));
        const dA = cellDate(g("DATA ACCONTO")), dS = cellDate(g("DATA SALDO"));
        const bp = g("BUSTA PAGA"), note = g("NOTE");
        if (!acc && !sal && ced == null && !dA && !dS) continue; // riga vuota
        const extra = [];
        if (g("DATA ACCONTO") && !dA) extra.push(`data acconto "${g("DATA ACCONTO")}"`);
        if (g("DATA SALDO") && !dS) extra.push(`data saldo "${g("DATA SALDO")}"`);
        found.push({ y, m, acconto: acc || null, dataAcconto: dA, saldo: sal || null, dataSaldo: dS, cedolino: ced,
          file: typeof bp === "string" && /\.pdf$/i.test(bp.trim()) ? bp.trim() : "",
          note: [typeof note === "string" ? note : "", extra.length ? "Da controllare: " + extra.join(", ") : ""].filter(Boolean).join(" · ") });
      }
    }
    if (!found.length) throw new Error("non ho trovato righe con una colonna MESE.");
    const clash = found.filter(r => docs[key(r.y, r.m)]).length;
    if (clash && !confirm(`${clash} mesi esistono già sul telefono: i loro importi e date verranno sostituiti da quelli dell'Excel (i PDF allegati restano). Continuare?`)) return;
    await tx(["mesi"], "readwrite", t => {
      for (const r of found) {
        const old = docs[key(r.y, r.m)] || {};
        t.objectStore("mesi").put(clean(r.y, r.m, Object.assign({}, r, { pdf: old.pdf || "", file: old.pdf ? old.file : (r.file || old.file || ""), note: r.note || old.note || "" })));
      }
    });
    persist(); year = Math.max(...found.map(r => r.y)); await reload();
    const chk = found.filter(r => /Da controllare/.test(r.note)).length;
    msg(`Importati ${found.length} mesi dall'Excel.` + (chk ? ` ${chk} hanno date da controllare (vedi note).` : "") + " Ora puoi allegare i PDF da Menu › Carica più buste paga.");
  } catch (err) { msg("Import non riuscito: " + (err.message || err), true); }
});

/* ---------- Impostazioni ---------- */
$("mSet").addEventListener("click", async () => {
  $("menuDlg").close();
  $("sName").value = (await conf("nome")) || "";
  let info = "I dati sono salvati solo in questa app, su questo telefono: non vanno su internet né su GitHub.";
  try {
    if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); info += ` Spazio usato: ${(e.usage / 1048576).toFixed(1)} MB.`; }
    if (navigator.storage?.persisted) info += (await navigator.storage.persisted()) ? " Archivio protetto dalla pulizia automatica." : " Il sistema potrebbe liberare spazio se il telefono è pieno: tieni un backup.";
  } catch (_) {}
  const last = await conf("ultimoBackup");
  info += last ? ` Ultimo backup: ${new Date(last).toLocaleDateString("it-IT")}.` : " Nessun backup ancora.";
  $("storeInfo").textContent = info;
  $("setDlg").showModal();
});
$("sCancel").addEventListener("click", () => $("setDlg").close());
$("setFrm").addEventListener("submit", async e => { e.preventDefault(); await setConf("nome", $("sName").value.trim()); $("setDlg").close(); msg("Impostazioni salvate."); });

/* Chiudi le finestre toccando fuori */
document.querySelectorAll("dialog.sheet").forEach(d => d.addEventListener("click", e => { if (e.target === d) d.close(); }));

/* ---------- Avvio ---------- */
render();
(async () => {
  try {
    idb = await openDb();
    await reload();
    const ys = Object.values(docs).map(d => d.anno);
    if (ys.length && !ys.includes(year)) { year = Math.max(...ys); render(); }
    if (!ys.length) msg("Benvenuto. Per iniziare carica una busta paga, oppure importa il tuo Excel o un backup dal Menu ☰.");
  } catch (err) { loaded = true; render(); msg("Archivio del telefono non disponibile: " + (err.message || err), true); }
})();
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
