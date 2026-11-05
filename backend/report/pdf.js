/**
 * The monthly report as a PDF: plain black-on-white tables, no charts.
 * Order: the new month at a glance next to the previous one, what changed,
 * this month's transfers (a checklist to tick off on paper), the full month
 * overview, savings balances, and a look back at the previous month.
 */
import PDFDocument from "pdfkit";
import fs from "node:fs";
import { buildReportContent } from "./content.js";

// A Unicode font (€, −, →, ✓); Alpine: `apk add font-dejavu`. Without one,
// fall back to Helvetica and swap the characters it can't draw.
const FONT_DIRS = [process.env.REPORT_FONT_DIR, "/usr/share/fonts/dejavu", "/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/TTF"].filter(Boolean);
function findFonts() {
  for (const dir of FONT_DIRS) {
    const regular = `${dir}/DejaVuSans.ttf`, bold = `${dir}/DejaVuSans-Bold.ttf`;
    if (fs.existsSync(regular) && fs.existsSync(bold)) return { regular, bold };
  }
  return null;
}
const FONTS = findFonts();
const plain = (s) => FONTS ? String(s) : String(s).replace(/[−–]/g, "-").replace(/→/g, ">").replace(/✓/g, "x").replace(/≈/g, "~").replace(/ /g, " ");

const INK = "#111111", MUTED = "#666666", LINE = "#BBBBBB";
const PAGE = { size: "A4", margins: { top: 48, bottom: 52, left: 44, right: 44 } };

export function renderReportPdf(raw, month, { lang = "nl", appTitle = "" } = {}) {
  const R = buildReportContent(raw, month, lang);
  const { L } = R;
  const doc = new PDFDocument({ ...PAGE, bufferPages: true, info: { Title: L.t("reportTitle", { month: R.current.title }), Author: appTitle || L.text.appTitle } });
  if (FONTS) { doc.registerFont("regular", FONTS.regular); doc.registerFont("bold", FONTS.bold); }
  const REG = FONTS ? "regular" : "Helvetica", BOLD = FONTS ? "bold" : "Helvetica-Bold";
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (h) => { if (doc.y + h > bottom()) doc.addPage(); };
  const text = (s, opts = {}) => doc.text(plain(s), opts);

  const title = (s) => { ensure(60); doc.moveDown(0.6); doc.font(BOLD).fontSize(15).fillColor(INK); text(s, { width }); doc.moveDown(0.3); };
  const subtitle = (s) => { ensure(40); doc.moveDown(0.5); doc.font(BOLD).fontSize(10.5).fillColor(INK); text(s.toUpperCase(), { width, characterSpacing: 0.4 }); doc.moveDown(0.15); };
  const note = (s) => { doc.font(REG).fontSize(9).fillColor(MUTED); text(s, { width }); doc.fillColor(INK); };

  // A simple table: columns { label, width (fraction), align }, rows of
  // cells (strings) with optional { strong, muted, indent, box }.
  const table = (columns, rows, { header = true } = {}) => {
    const widths = columns.map((c) => c.width * width);
    const pad = 4;
    const drawRow = (cells, { strong = false, muted = false, indent = false, box = null, head = false } = {}) => {
      doc.font(strong || head ? BOLD : REG).fontSize(head ? 8.5 : 9.5);
      const heights = cells.map((c, i) => doc.heightOfString(plain(c ?? ""), { width: widths[i] - pad * 2 - (i === 0 && (indent || box != null) ? 14 : 0) }));
      const h = Math.max(...heights, 10) + pad * 2;
      if (doc.y + h > bottom()) { doc.addPage(); if (header && !head) drawRow(columns.map((c) => c.label), { head: true }); }
      const y = doc.y;
      let x = left;
      cells.forEach((c, i) => {
        let cx = x + pad, cw = widths[i] - pad * 2;
        if (i === 0 && box != null) {
          doc.lineWidth(0.8).strokeColor(INK).rect(cx, y + pad + 1, 9, 9).stroke();
          if (box) { doc.lineWidth(1.2).moveTo(cx + 2, y + pad + 6).lineTo(cx + 4, y + pad + 8.5).lineTo(cx + 7.5, y + pad + 2.5).stroke(); }
          cx += 14; cw -= 14;
        } else if (i === 0 && indent) { cx += 14; cw -= 14; }
        doc.fillColor(head || muted || (i > 0 && columns[i].muted) ? MUTED : INK);
        doc.text(plain(c ?? ""), cx, y + pad, { width: cw, align: columns[i].align || "left" });
        x += widths[i];
      });
      doc.lineWidth(head || strong ? 0.9 : 0.4).strokeColor(head ? INK : LINE).moveTo(left, y + h).lineTo(left + width, y + h).stroke();
      doc.x = left; doc.y = y + h;
    };
    if (header) drawRow(columns.map((c) => c.label), { head: true });
    for (const r of rows) drawRow(r.cells, r);
    doc.fillColor(INK); doc.moveDown(0.4);
  };
  const diff = (a, b) => (b == null ? "" : Math.abs(a - b) < 0.005 ? "" : `${a - b > 0 ? "+" : "−"} ${L.eur(Math.abs(a - b))}`);

  // ── Header ──
  doc.font(REG).fontSize(9).fillColor(MUTED); text(appTitle || L.text.appTitle, { width });
  doc.font(BOLD).fontSize(20).fillColor(INK); text(L.t("reportTitle", { month: R.current.title }), { width });
  doc.font(REG).fontSize(9).fillColor(MUTED); text(L.t("reportGenerated", { date: L.dateTime(new Date()) }), { width });
  doc.fillColor(INK);

  // ── At a glance: previous vs this month ──
  title(L.text.reportGlanceTitle);
  if (R.previous) {
    table([{ label: "", width: 0.43 }, { label: R.previous.title, width: 0.19, align: "right" }, { label: R.current.title, width: 0.19, align: "right" }, { label: L.text.reportColDiff, width: 0.19, align: "right" }],
      R.comparison.map((r) => ({ cells: [r.label, L.eur(r.previous), L.eur(r.value), diff(r.value, r.previous)], strong: r.id === "joint" })));
  } else {
    table([{ label: "", width: 0.6 }, { label: R.current.title, width: 0.4, align: "right" }], R.comparison.map((r) => ({ cells: [r.label, L.eur(r.value)], strong: r.id === "joint" })));
    note(L.text.reportNoPrevious);
  }

  // ── What changed ──
  if (R.previous) {
    title(L.t("reportChangesTitle", { month: R.previous.title }));
    if (!R.changes.length) note(L.text.reportNoChanges);
    else table([{ label: L.text.sheetColLabel, width: 0.34 }, { label: L.text.reportColWhat, width: 0.22, muted: true }, { label: R.previous.title, width: 0.15, align: "right" }, { label: R.current.title, width: 0.15, align: "right" }, { label: L.text.reportColDiff, width: 0.14, align: "right" }],
      R.changes.map((c) => ({ cells: [c.label, `${L.text[c.kind === "added" ? "reportChangeAdded" : c.kind === "removed" ? "reportChangeRemoved" : "reportChangeChanged"]} · ${c.group}`, c.kind === "added" ? "" : L.eur(c.previous), c.kind === "removed" ? "" : L.eur(c.monthly), diff(c.monthly, c.previous)] })));
  }

  // ── Transfers (checklist) ──
  const transferTable = (rows, { stop = false } = {}) => table(
    [{ label: `${L.text.transferFrom} → ${L.text.reportColTo}`, width: 0.5 }, { label: L.text.reportColDetails, width: 0.32, muted: true }, { label: L.text.reportColAmount, width: 0.18, align: "right" }],
    rows.map((r) => ({
      box: r.ticked,
      cells: [
        `${r.from} → ${r.to}${r.purpose ? `\n${r.purpose}` : ""}${r.status ? `\n${r.status}` : ""}`,
        [r.iban && `${L.text.subAccountIban}: ${r.iban}`, r.reference && `${L.text.subAccountReference}: ${r.reference}`, r.day != null && `${L.text.transferDayLabel}: ${r.day ? L.t("transferDayValue", { day: r.day }) : L.text.reportNotSet}`].filter(Boolean).join("\n"),
        `${stop ? "" : ""}${L.eur(r.amount)}\n${r.once ? L.text.transferOnce : L.text.periodMonthAbbr}`,
      ],
    })));
  const transfers = (m) => {
    const t = m.transfers;
    const done = t.rows.filter((r) => r.ticked).length + t.stopped.filter((r) => r.ticked).length;
    const total = t.rows.length + t.stopped.length;
    if (!total) { note(L.text.transfersEmpty); return; }
    note(L.t("transfersProgress", { done, total }));
    transferTable(t.rows);
    if (t.stopped.length) { subtitle(L.text.transfersStoppedTitle); note(L.t("transfersStoppedHint", { month: R.previous?.title || "" })); transferTable(t.stopped, { stop: true }); }
  };
  title(L.t("reportTransfersTitle", { month: R.current.title }));
  transfers(R.current);

  // ── Full month overview (the "Table" page) ──
  const sheet = (m) => {
    for (const s of m.sheet) {
      subtitle(s.title);
      const rows = s.rows.filter((r) => !r.strong).length ? s.rows : [{ label: L.text.printNoEntries, monthly: null, muted: true }, ...s.rows];
      table([{ label: L.text.sheetColLabel, width: 0.46 }, { label: L.text.sheetColCategory, width: 0.2, muted: true }, { label: L.text.sheetColMonth, width: 0.17, align: "right" }, { label: L.text.sheetColYear, width: 0.17, align: "right" }],
        rows.map((r) => ({ cells: [r.label, r.category || "", r.monthly == null ? "" : L.eur(r.monthly), r.monthly == null ? "" : L.eur(r.monthly * 12)], strong: r.strong, indent: r.indent, muted: r.muted })), { header: false });
    }
  };
  doc.addPage();
  title(L.t("reportOverviewTitle", { month: R.current.title }));
  sheet(R.current);

  // ── Savings ──
  const savings = (m) => {
    if (!m.savings.length) { note(L.text.noSavingsGoals); return; }
    const grand = m.savings.reduce((s, p) => s + p.total, 0);
    for (const pot of m.savings) {
      subtitle([pot.label, pot.owner, `${L.eur(pot.monthly)} ${L.text.periodMonthAbbr}`, pot.target ? L.t("reportTarget", { amount: L.eur(pot.target) }) : ""].filter(Boolean).join(" · "));
      table([{ label: L.text.reportColAccount, width: 0.42 }, { label: L.text.reportColRate, width: 0.14, align: "right", muted: true }, { label: L.text.reportColBalance, width: 0.22, align: "right" }, { label: "", width: 0.22, muted: true }],
        [...pot.accounts.map((a) => ({ cells: [a.owners ? `${a.name} (${a.owners})` : a.name, a.rate != null ? `${String(a.rate).replace(".", ",")}%` : "", a.balance == null ? "–" : L.eur(a.balance),
          a.balance == null ? L.text.reportNotSet : a.entered ? L.text.reportBalanceEntered : L.t("reportBalanceProjected", { month: a.lastRecorded ? L.monthLong(a.lastRecorded) : "" })] })),
        ...(pot.accounts.length > 1 ? [{ cells: [L.text.reportPotTotal, "", L.eur(pot.total), ""], strong: true }] : [])], { header: false });
    }
    table([{ label: "", width: 0.56 }, { label: "", width: 0.22, align: "right" }, { label: "", width: 0.22 }], [{ cells: [L.text.reportSavingsTotal, L.eur(grand), ""], strong: true }], { header: false });
  };
  title(L.t("reportSavingsTitle", { month: R.current.title }));
  savings(R.current);

  // ── Changes made in the app ──
  const log = (m) => {
    if (!m.log.length) return;
    subtitle(L.t("reportLogTitle", { month: m.title }));
    table([{ label: L.text.reportColWhen, width: 0.22, muted: true }, { label: L.text.sheetColLabel, width: 0.42 }, { label: L.text.reportColChange, width: 0.36 }],
      m.log.map((x) => ({ cells: [L.dateTime(new Date(x.ts)), x.label, `${x.old || "—"} → ${x.next || "—"}`] })));
  };
  log(R.current);

  // ── Look back at the previous month ──
  if (R.previous) {
    doc.addPage();
    title(L.t("reportLookbackTitle", { month: R.previous.title }));
    subtitle(L.t("reportTransfersTitle", { month: R.previous.title }));
    transfers(R.previous);
    sheet(R.previous);
    subtitle(L.t("reportSavingsTitle", { month: R.previous.title }));
    savings(R.previous);
    log(R.previous);
  }

  // Page numbers.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font(REG).fontSize(8).fillColor(MUTED);
    const y = doc.page.height - doc.page.margins.bottom + 18;
    doc.page.margins.bottom = 0;
    doc.text(plain(`${L.t("reportTitle", { month: R.current.title })} · ${L.t("reportPage", { n: i + 1, total: range.count })}`), left, y, { width, align: "right", lineBreak: false });
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
