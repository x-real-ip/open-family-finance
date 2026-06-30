import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Trash2, RotateCcw, Check, Loader2, ChevronLeft, ChevronRight,
  ChevronDown, TrendingUp, Landmark, PiggyBank, Wallet, Receipt, MessageSquare, History, Link2,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { storage } from "./api";

/* ----------------------------------------------------------------
   Design tokens
------------------------------------------------------------------- */
const C = {
  canvas: "#ECEFEC", card: "#FFFFFF", ink: "#16211F", muted: "#65726E", line: "#DCE2DF",
  a: "#DB6B3A", b: "#1F7A8C", gov: "#7A5BA6", save: "#2E7D52", inc: "#2F6DB0", exp: "#C0443B", softA: "#FBEEE6", softB: "#E6F1F3",
};

const KEY = "open-family-finance:v1";

// User-defined labels get a stable auto color from a hash of the name.
// Hue, saturation and lightness all vary, so distinct names rarely look alike.
function categoryColor(name) {
  if (!name) return "#9aa5a1";
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  h = h >>> 0;
  const hue = h % 360, sat = 50 + ((h >>> 9) % 30), light = 42 + ((h >>> 17) % 14);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

const TXT = {
  model: "Uitgaven plus sparen, min de overheidsbijdrage, is wat jullie samen financieren. Dat verdelen we naar inkomen, plus een kleine buffer.",
  fair: "Wie meer verdient, legt naar verhouding meer in. Na de overboeking houdt ieder hetzelfde percentage van het eigen salaris over.",
  gov: "Toeslagen (kinderbijslag e.d.) komen binnen op de gezamenlijke rekening en verlagen het bedrag dat jullie zelf moeten inleggen.",
  exp: "Kies of typ een categorie. Tik /mnd of /jr om per maand of per jaar in te vullen. Het percentage is het aandeel binnen deze sectie.",
  sav: "Maandelijkse inleg per spaardoel. Tik /mnd of /jr om de invoer te wisselen. Telt mee in wat jullie samen financieren.",
};

/* Empty defaults. Real amounts are stored in the database, not in the
   code, so this repository can be public. */
const DEFAULT_FIGURES = {
  method: "income",
  margePct: "0.5",
  partners: [
    { id: "p1", name: "Partner 1", income: "", period: "month", note: "", url: "" },
    { id: "p2", name: "Partner 2", income: "", period: "month", note: "", url: "" },
  ],
  govIncome: [],
  expenses: [],
  savings: [],
};

/* ----------------------------------------------------------------
   Helpers
------------------------------------------------------------------- */
const num = (x) => { const v = parseFloat(String(x).replace(",", ".")); return isFinite(v) ? v : 0; };
const round2 = (n) => Math.round(n * 100) / 100;
const toMonthly = (amountStr, period) => num(amountStr) / (period === "year" ? 12 : 1);
const monthlyOf = (x) => toMonthly(x.amount, x.period);
const monthlyInc = (p) => toMonthly(p.income, p.period);
const sumM = (arr) => arr.reduce((s, x) => s + monthlyOf(x), 0);
const flip = (amountStr, fromPeriod) => String(round2(fromPeriod === "year" ? num(amountStr) / 12 : num(amountStr) * 12));
const pctOf = (part, whole) => (whole > 0 ? part / whole : null);

const eur = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(isFinite(n) ? n : 0);
const eur0 = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(isFinite(n) ? n : 0);
const pct = (x) => `${Math.round(x * 100)}%`;
const uid = () => Math.random().toString(36).slice(2, 9);
const clone = (o) => JSON.parse(JSON.stringify(o));

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const keyToDate = (k) => { const [y, m] = k.split("-").map(Number); return new Date(y, m - 1, 1); };
const shiftMonth = (k, delta) => { const d = keyToDate(k); d.setMonth(d.getMonth() + delta); return monthKey(d); };
const monthLong = (k) => new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric" }).format(keyToDate(k));
const monthShort = (k) => { const d = keyToDate(k); const m = new Intl.DateTimeFormat("nl-NL", { month: "short" }).format(d); return d.getMonth() === 0 ? `${m} '${String(d.getFullYear()).slice(2)}` : m; };
const dt = (ts) => new Intl.DateTimeFormat("nl-NL", { dateStyle: "short", timeStyle: "short" }).format(new Date(ts));

function computeTotals(fig) {
  const a = monthlyInc(fig.partners[0]), b = monthlyInc(fig.partners[1]), total = a + b;
  const shareA = total > 0 ? a / total : 0.5, shareB = total > 0 ? b / total : 0.5;
  const expensesTotal = sumM(fig.expenses), savingsTotal = sumM(fig.savings);
  const potTotal = expensesTotal + savingsTotal, govTotal = sumM(fig.govIncome);
  const coupleFunds = Math.max(0, potTotal - govTotal);
  const marge = num(fig.margePct) / 100;
  let baseA, baseB;
  if (fig.method === "equal") { baseA = coupleFunds / 2; baseB = coupleFunds / 2; }
  else { baseA = coupleFunds * shareA; baseB = coupleFunds * shareB; }
  const transferA = baseA * (1 + marge), transferB = baseB * (1 + marge);
  const buffer = transferA + transferB - coupleFunds;
  const leftoverA = a - transferA, leftoverB = b - transferB;
  return {
    a, b, total, shareA, shareB, expensesTotal, savingsTotal, potTotal, govTotal, coupleFunds, buffer,
    transferA, transferB, leftoverA, leftoverB,
    keepA: a > 0 ? leftoverA / a : 0, keepB: b > 0 ? leftoverB / b : 0,
    contribShareA: transferA + transferB > 0 ? transferA / (transferA + transferB) : 0.5,
  };
}

function migrateFig(f) {
  if (!f) return clone(DEFAULT_FIGURES);
  const per = (p) => (p === "year" ? "year" : "month");
  return {
    method: f.method || "income", margePct: f.margePct ?? "0.5",
    partners: (f.partners && f.partners.length ? f.partners : clone(DEFAULT_FIGURES.partners)).map((p) => ({ ...p, period: per(p.period), note: p.note || "", url: p.url || "" })),
    govIncome: (f.govIncome || []).map((g) => ({ id: g.id || uid(), label: g.label || "", amount: g.amount ?? "", period: per(g.period), note: g.note || "", url: g.url || "" })),
    expenses: (f.expenses || []).map((e) => ({ id: e.id || uid(), category: e.category || "", label: e.label || "", amount: e.amount ?? "", period: per(e.period), note: e.note || "", url: e.url || "" })),
    savings: f.savings ? f.savings.map((s) => ({ id: s.id || uid(), label: s.label || "", amount: s.amount ?? "", period: per(s.period), note: s.note || "", url: s.url || "" }))
      : (f.jointSavings != null ? [{ id: uid(), label: "Sparen", amount: f.jointSavings, period: "month", note: "", url: "" }] : []),
  };
}
function freshData() { const mk = monthKey(new Date()); return { selectedMonth: mk, months: { [mk]: clone(DEFAULT_FIGURES) }, log: [] }; }
function normalize(raw) {
  if (!raw) return freshData();
  if (raw.months && raw.selectedMonth) {
    const months = {}; for (const [k, v] of Object.entries(raw.months)) months[k] = migrateFig(v);
    return { selectedMonth: raw.selectedMonth, months, log: raw.log || [] };
  }
  if (raw.partners) { const mk = monthKey(new Date()); return { selectedMonth: mk, months: { [mk]: migrateFig(raw) }, log: [] }; }
  return freshData();
}

/* ----------------------------------------------------------------
   App
------------------------------------------------------------------- */
export default function App() {
  const [data, setData] = useState(freshData);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(true);
  const [open, setOpen] = useState({ inkomen: true, overheid: true, uitgaven: true, sparen: true, verloop: true, log: false });
  const [showDetails, setShowDetails] = useState(false);
  const saveTimer = useRef(null);
  const margeStart = useRef(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try { const res = await storage.get(KEY); if (active && res && res.value) setData(normalize(JSON.parse(res.value))); }
      catch (e) {} finally { if (active) setLoaded(true); }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    setSaved(false);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await storage.set(KEY, JSON.stringify(data)); setSaved(true); } catch (e) { setSaved(false); }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [data, loaded]);

  const sel = data.selectedMonth;
  const cur = data.months[sel] || DEFAULT_FIGURES;
  const calc = useMemo(() => computeTotals(cur), [cur]);
  const sortedMonths = useMemo(() => Object.keys(data.months).sort(), [data.months]);
  const isCurrentRealMonth = sel === monthKey(new Date());

  const series = useMemo(() => sortedMonths.map((m) => {
    const t = computeTotals(data.months[m]);
    return {
      key: m, label: monthShort(m),
      Inkomen: Math.round(t.total), Overheidsbijdrage: Math.round(t.govTotal),
      Uitgaven: Math.round(t.expensesTotal), Sparen: Math.round(t.savingsTotal),
      inlegA: Math.round(t.transferA), inlegB: Math.round(t.transferB),
    };
  }), [sortedMonths, data.months]);

  const byCategory = useMemo(() => {
    const map = {};
    for (const e of cur.expenses) map[e.category || "Overig"] = (map[e.category || "Overig"] || 0) + monthlyOf(e);
    return Object.entries(map).sort((x, y) => y[1] - x[1]);
  }, [cur.expenses]);

  // Existing category names across all months, for autocomplete suggestions.
  const categories = useMemo(() => {
    const set = new Set();
    for (const m of Object.values(data.months)) for (const e of m.expenses) if (e.category) set.add(e.category);
    return [...set].sort();
  }, [data.months]);

  const toggleSec = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  const goMonth = (delta) => setData((d) => {
    const next = shiftMonth(d.selectedMonth, delta); const months = { ...d.months };
    if (!months[next]) months[next] = clone(d.months[d.selectedMonth]);
    return { ...d, selectedMonth: next, months };
  });
  const deleteMonth = (m) => setData((d) => {
    if (Object.keys(d.months).length <= 1) return d;
    const months = { ...d.months }; delete months[m];
    const remaining = Object.keys(months).sort();
    const selectedMonth = d.selectedMonth === m ? remaining[remaining.length - 1] : d.selectedMonth;
    return { ...d, selectedMonth, months };
  });

  const patchFig = (updater) => setData((d) => ({ ...d, months: { ...d.months, [d.selectedMonth]: updater(d.months[d.selectedMonth]) } }));
  const setPartner = (i, patch) => patchFig((f) => ({ ...f, partners: f.partners.map((p, idx) => idx === i ? { ...p, ...patch } : p) }));
  // Names belong to a person, not a month: change them in every month and persist.
  const setPartnerName = (i, name) => setData((d) => {
    const months = {};
    for (const [k, m] of Object.entries(d.months)) months[k] = { ...m, partners: m.partners.map((p, idx) => idx === i ? { ...p, name } : p) };
    return { ...d, months };
  });
  // Append a change to the log (date/time, field, old → new). Kept to the last 300 entries.
  const logChange = (label, oldV, newV) => setData((d) => {
    if (String(oldV) === String(newV)) return d;
    const entry = { id: uid(), ts: Date.now(), month: d.selectedMonth, label, old: String(oldV ?? ""), next: String(newV ?? "") };
    return { ...d, log: [entry, ...(d.log || [])].slice(0, 300) };
  });
  const togglePartnerPeriod = (i) => patchFig((f) => ({ ...f, partners: f.partners.map((p, idx) => idx === i ? { ...p, period: p.period === "year" ? "month" : "year", income: flip(p.income, p.period) } : p) }));
  const setMethod = (method) => patchFig((f) => ({ ...f, method }));
  const setMarge = (margePct) => patchFig((f) => ({ ...f, margePct }));
  const setListItem = (k, id, patch) => patchFig((f) => ({ ...f, [k]: f[k].map((x) => x.id === id ? { ...x, ...patch } : x) }));
  const toggleItemPeriod = (k, id) => patchFig((f) => ({ ...f, [k]: f[k].map((x) => x.id === id ? { ...x, period: x.period === "year" ? "month" : "year", amount: flip(x.amount, x.period) } : x) }));
  const removeListItem = (k, id) => patchFig((f) => ({ ...f, [k]: f[k].filter((x) => x.id !== id) }));
  const addGov = () => patchFig((f) => ({ ...f, govIncome: [...f.govIncome, { id: uid(), label: "", amount: "", period: "month", note: "", url: "" }] }));
  const addExpense = () => patchFig((f) => ({ ...f, expenses: [...f.expenses, { id: uid(), category: "", label: "", amount: "", period: "month", note: "", url: "" }] }));
  const addSaving = () => patchFig((f) => ({ ...f, savings: [...f.savings, { id: uid(), label: "", amount: "", period: "month", note: "", url: "" }] }));
  const resetMonth = () => { if (window.confirm(`Cijfers van ${monthLong(sel)} terugzetten naar het voorbeeld?`)) patchFig(() => clone(DEFAULT_FIGURES)); };

  const pA = cur.partners[0], pB = cur.partners[1];
  const nameA = pA.name || "Partner 1", nameB = pB.name || "Partner 2";

  return (
    <div style={St.page}>
      <style>{CSS}</style>
      <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>

      <div style={St.shell}>
        <header style={St.header}>
          <h1 style={St.h1}>Open Family Finance</h1>
          <p style={St.byline}>
            created by{" "}
            <a style={St.link} href="https://github.com/x-real-ip" target="_blank" rel="noopener noreferrer">x-real-ip</a>
            {" · "}
            <a style={St.link} href="https://github.com/x-real-ip/open-family-finance" target="_blank" rel="noopener noreferrer">source on GitHub</a>
          </p>
        </header>

        {/* Month */}
        <div style={St.monthNav} className="fade">
          <button type="button" onClick={() => goMonth(-1)} style={St.navBtn} aria-label="Vorige maand"><ChevronLeft size={18} /></button>
          <div style={St.monthLabelWrap}>
            <span style={St.monthLabel}>{monthLong(sel)}</span>
            {isCurrentRealMonth && <span style={St.nowTag}>nu</span>}
          </div>
          <button type="button" onClick={() => goMonth(1)} style={St.navBtn} aria-label="Volgende maand"><ChevronRight size={18} /></button>
        </div>

        {/* Distribution (result) — full width */}
        <section style={St.hero} className="fade">
          <div style={St.methodRow}>
            <span style={St.methodLabel}>Verdeelmethode</span>
            <div style={St.toggle} role="group" aria-label="Verdeelmethode">
              <button type="button" onClick={() => setMethod("income")} style={{ ...St.toggleBtn, ...(cur.method === "income" ? St.toggleOn : {}) }}>Naar inkomen</button>
              <button type="button" onClick={() => setMethod("equal")} style={{ ...St.toggleBtn, ...(cur.method === "equal" ? St.toggleOn : {}) }}>50 / 50</button>
            </div>
          </div>

          <div style={St.contribGrid}>
            <ContribCard name={nameA} color={C.a} soft={C.softA} amount={calc.transferA} />
            <ContribCard name={nameB} color={C.b} soft={C.softB} amount={calc.transferB} />
          </div>

          <SplitBar label="Inkomen" fracA={calc.shareA} nameA={nameA} nameB={nameB} />
          <SplitBar label="Inleg" fracA={calc.contribShareA} nameA={nameA} nameB={nameB} />

          <div style={St.leftLabel}>
            <span>Houdt zelf over</span>
            <span style={St.fairInline}>
              {cur.method === "income" ? `allebei ${pct(calc.keepA)}` : `${pct(calc.keepA)} · ${pct(calc.keepB)}`}
              <InfoDot text={TXT.fair} align="right" />
            </span>
          </div>
          <div style={St.leftoverGrid}>
            <LeftoverCard name={nameA} color={C.a} amount={calc.leftoverA} />
            <LeftoverCard name={nameB} color={C.b} amount={calc.leftoverB} />
          </div>

          <button type="button" onClick={() => setShowDetails((s) => !s)} style={St.detailsBtn} aria-expanded={showDetails}>
            Hoe is dit berekend?
            <ChevronDown size={15} style={{ transform: showDetails ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>
          {showDetails && (
            <div style={St.details}>
              <Bd label="Uitgaven" value={calc.expensesTotal} />
              <Bd label="Sparen" value={calc.savingsTotal} />
              <Bd label="− Overheidsbijdrage" value={calc.govTotal} sign="− " color={C.gov} />
              <Bd label="= Samen te financieren" value={calc.coupleFunds} strong />
              <Bd label={`+ Buffer (marge ${num(cur.margePct)}%)`} value={calc.buffer} sign="+ " muted />
              <div style={St.margeRow}>
                <span style={St.margeLabel}>Buffer-marge per overboeking</span>
                <div style={St.money}>
                  <input inputMode="decimal" value={cur.margePct}
                    onFocus={() => { margeStart.current = cur.margePct; }}
                    onChange={(e) => setMarge(e.target.value.replace(/[^0-9.,]/g, ""))}
                    onBlur={() => { if (margeStart.current !== cur.margePct) logChange("Buffer-marge (%)", margeStart.current, cur.margePct); }}
                    style={{ ...St.moneyInput, width: 50 }} aria-label="Marge percentage" />
                  <span style={St.euro}>%</span>
                </div>
              </div>
            </div>
          )}
        </section>

        <ColTitle>Inkomsten</ColTitle>
        {/* Income */}
        <Collapsible id="inkomen" title="Inkomen" icon={<Wallet size={16} style={{ color: C.inc }} />} total={eur(calc.total)} open={open.inkomen} onToggle={toggleSec}>
          <div style={St.hint}>Tik op een naam om die te wijzigen — die geldt voor alle maanden.</div>
          {[pA, pB].map((p, i) => (
            <div style={St.itemWrap} key={p.id}>
              <div style={St.row}>
                <span style={{ ...St.dot, background: i === 0 ? C.a : C.b }} />
                <input aria-label={`Naam partner ${i + 1}`} value={p.name} placeholder={`Partner ${i + 1}`} onChange={(e) => setPartnerName(i, e.target.value)} style={{ ...St.nameInput, fontWeight: 600 }} />
                <AmountField value={p.income} period={p.period} onValue={(v) => setPartner(i, { income: v })} onPeriod={() => togglePartnerPeriod(i)} onCommit={(o, n) => logChange(`Inkomen · ${p.name || `Partner ${i + 1}`}`, o, n)} />
                <NoteField value={p.note || ""} onChange={(v) => setPartner(i, { note: v })} />
                <LinkField value={p.url || ""} onChange={(v) => setPartner(i, { url: v })} />
              </div>
              <DerivedLine monthly={monthlyInc(p)} period={p.period} percent={pctOf(monthlyInc(p), calc.total)} dot />
            </div>
          ))}
          <SubTotal monthly={calc.total} />
        </Collapsible>

        {/* Government */}
        <Collapsible id="overheid" title="Overheidsbijdrage" icon={<Landmark size={16} style={{ color: C.gov }} />} info={TXT.gov} total={eur(calc.govTotal)} open={open.overheid} onToggle={toggleSec}>
          {cur.govIncome.map((g) => (
            <div style={St.itemWrap} key={g.id}>
              <div style={St.row}>
                <span style={{ ...St.dot, background: C.gov }} />
                <input aria-label="Omschrijving" value={g.label} placeholder="Toeslag" onChange={(e) => setListItem("govIncome", g.id, { label: e.target.value })} style={St.nameInput} />
                <AmountField value={g.amount} period={g.period} onValue={(v) => setListItem("govIncome", g.id, { amount: v })} onPeriod={() => toggleItemPeriod("govIncome", g.id)} onCommit={(o, n) => logChange(`Overheid · ${g.label || "toeslag"}`, o, n)} />
                <NoteField value={g.note || ""} onChange={(v) => setListItem("govIncome", g.id, { note: v })} />
                <LinkField value={g.url || ""} onChange={(v) => setListItem("govIncome", g.id, { url: v })} />
                <button type="button" aria-label="Verwijderen" onClick={() => removeListItem("govIncome", g.id)} style={St.iconBtn}><Trash2 size={16} /></button>
              </div>
              <DerivedLine monthly={monthlyOf(g)} period={g.period} percent={pctOf(monthlyOf(g), calc.govTotal)} dot />
            </div>
          ))}
          <button type="button" onClick={addGov} style={St.addBtn}><Plus size={16} /> Toeslag toevoegen</button>
          <SubTotal monthly={calc.govTotal} />
        </Collapsible>

        <ColTitle>Uitgaven &amp; sparen</ColTitle>
        {/* Expenses */}
        <Collapsible id="uitgaven" title="Uitgaven" icon={<Receipt size={16} style={{ color: C.exp }} />} info={TXT.exp} total={eur(calc.expensesTotal)} open={open.uitgaven} onToggle={toggleSec}>
          {cur.expenses.map((e) => (
            <div style={St.itemWrap} key={e.id}>
              <div style={St.expRow}>
                <span style={{ ...St.catDot, background: categoryColor(e.category) }} title={e.category || "geen categorie"} />
                <input list="cats" aria-label="Categorie" value={e.category} placeholder="Categorie" onChange={(ev) => setListItem("expenses", e.id, { category: ev.target.value })} style={St.catInput} />
                <input aria-label="Omschrijving" value={e.label} placeholder="Omschrijving" onChange={(ev) => setListItem("expenses", e.id, { label: ev.target.value })} style={St.nameInput} />
                <AmountField value={e.amount} period={e.period} onValue={(v) => setListItem("expenses", e.id, { amount: v })} onPeriod={() => toggleItemPeriod("expenses", e.id)} onCommit={(o, n) => logChange(`Uitgave · ${e.label || "naamloos"}`, o, n)} />
                <NoteField value={e.note || ""} onChange={(v) => setListItem("expenses", e.id, { note: v })} />
                <LinkField value={e.url || ""} onChange={(v) => setListItem("expenses", e.id, { url: v })} />
                <button type="button" aria-label="Verwijderen" onClick={() => removeListItem("expenses", e.id)} style={St.iconBtn}><Trash2 size={16} /></button>
              </div>
              <DerivedLine monthly={monthlyOf(e)} period={e.period} percent={pctOf(monthlyOf(e), calc.expensesTotal)} />
            </div>
          ))}
          <button type="button" onClick={addExpense} style={St.addBtn}><Plus size={16} /> Uitgave toevoegen</button>
          {byCategory.length > 0 && (
            <div style={St.catSummary}>
              <div style={St.catSummaryTitle}>Per categorie</div>
              {byCategory.map(([cat, val]) => (
                <div style={St.catSummaryRow} key={cat}>
                  <span style={St.catName}>
                    <span style={{ ...St.catDot, background: categoryColor(cat === "Overig" ? "" : cat) }} />
                    {cat}
                  </span>
                  <span style={St.catMonthly}>{eur(val)}</span>
                  <span style={St.catYr}>{eur(val * 12)} p/j</span>
                </div>
              ))}
            </div>
          )}
          <SubTotal monthly={calc.expensesTotal} />
        </Collapsible>

        {/* Savings goals */}
        <Collapsible id="sparen" title="Spaardoelen" icon={<PiggyBank size={16} style={{ color: C.save }} />} info={TXT.sav} total={eur(calc.savingsTotal)} open={open.sparen} onToggle={toggleSec}>
          {cur.savings.map((s) => (
            <div style={St.itemWrap} key={s.id}>
              <div style={St.row}>
                <span style={{ ...St.dot, background: categoryColor(s.label) }} />
                <input aria-label="Spaardoel" value={s.label} placeholder="Spaardoel" onChange={(e) => setListItem("savings", s.id, { label: e.target.value })} style={St.nameInput} />
                <AmountField value={s.amount} period={s.period} onValue={(v) => setListItem("savings", s.id, { amount: v })} onPeriod={() => toggleItemPeriod("savings", s.id)} onCommit={(o, n) => logChange(`Sparen · ${s.label || "spaardoel"}`, o, n)} />
                <NoteField value={s.note || ""} onChange={(v) => setListItem("savings", s.id, { note: v })} />
                <LinkField value={s.url || ""} onChange={(v) => setListItem("savings", s.id, { url: v })} />
                <button type="button" aria-label="Verwijderen" onClick={() => removeListItem("savings", s.id)} style={St.iconBtn}><Trash2 size={16} /></button>
              </div>
              <DerivedLine monthly={monthlyOf(s)} period={s.period} percent={pctOf(monthlyOf(s), calc.savingsTotal)} dot />
            </div>
          ))}
          <button type="button" onClick={addSaving} style={St.addBtn}><Plus size={16} /> Spaardoel toevoegen</button>
          <SubTotal monthly={calc.savingsTotal} />
        </Collapsible>

        {/* History */}
        <Collapsible id="verloop" title="Statistieken" total={`${sortedMonths.length} mnd`} open={open.verloop} onToggle={toggleSec}>
          {series.length < 2 ? (
            <div style={St.emptyHist}>
              <TrendingUp size={18} style={{ color: C.muted }} />
              <span>Blader met de pijlen naar een volgende maand om je cijfers bij te werken. Vanaf twee maanden verschijnen hier de grafieken.</span>
            </div>
          ) : (
            <>
              <ChartTitle>Inleg per maand</ChartTitle>
              <div style={St.chartBox}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series} margin={{ top: 6, right: 4, left: -14, bottom: 0 }}>
                    <CartesianGrid stroke={C.line} vertical={false} />
                    <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
                    <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={eur0} />
                    <Tooltip {...tooltipProps} /><Legend {...legendProps} />
                    <Bar dataKey="inlegA" name={nameA} fill={C.a} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="inlegB" name={nameB} fill={C.b} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ChartTitle>Maandtotalen</ChartTitle>
              <div style={St.chartBox}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid stroke={C.line} vertical={false} />
                    <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
                    <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={eur0} />
                    <Tooltip {...tooltipProps} /><Legend {...legendProps} />
                    <Line type="monotone" dataKey="Inkomen" stroke={C.inc} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Overheidsbijdrage" stroke={C.gov} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Uitgaven" stroke={C.exp} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Sparen" stroke={C.save} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
          <div style={St.monthList}>
            {sortedMonths.slice().reverse().map((m) => {
              const t = computeTotals(data.months[m]); const active = m === sel;
              return (
                <div key={m} style={{ ...St.monthItem, ...(active ? St.monthItemActive : {}) }}>
                  <button type="button" onClick={() => setData((d) => ({ ...d, selectedMonth: m }))} style={St.monthItemBtn}>
                    <span style={St.monthItemName}>{monthLong(m)}</span>
                    <span style={St.monthItemPot}>{eur0(t.coupleFunds)} te verdelen</span>
                  </button>
                  {sortedMonths.length > 1 && (
                    <button type="button" aria-label={`${monthLong(m)} verwijderen`} onClick={() => deleteMonth(m)} style={St.iconBtn}><Trash2 size={15} /></button>
                  )}
                </div>
              );
            })}
          </div>
        </Collapsible>

        {/* Change log */}
        <Collapsible id="log" title="Logboek" icon={<History size={16} style={{ color: C.muted }} />} total={`${(data.log || []).length}`} open={open.log} onToggle={toggleSec}>
          {(data.log || []).length === 0 ? (
            <div style={St.logEmpty}>Nog geen wijzigingen vastgelegd. Aanpassingen aan bedragen verschijnen hier met datum, tijd, het gewijzigde veld en de oude en nieuwe waarde.</div>
          ) : (
            <div style={St.logList}>
              {(data.log || []).map((l) => (
                <div key={l.id} style={St.logRow}>
                  <span style={St.logTime}>{dt(l.ts)}</span>
                  <span style={St.logBody}>
                    <span style={St.logLabel}>{l.label}</span>
                    <span style={St.logChange}>
                      <span style={St.logOld}>{l.old || "—"}</span>
                      <span style={St.logArrow}>→</span>
                      <span style={St.logNew}>{l.next || "—"}</span>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Collapsible>

        <footer style={St.footer}>
          <span style={St.saveState}>
            {!loaded ? (<><Loader2 size={14} className="spin" /> Laden…</>) : saved ? (<><Check size={14} style={{ color: C.save }} /> Opgeslagen</>) : (<><Loader2 size={14} className="spin" /> Opslaan…</>)}
          </span>
          <button type="button" onClick={resetMonth} style={St.resetBtn}><RotateCcw size={14} /> Deze maand herstellen</button>
        </footer>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------
   Subcomponents
------------------------------------------------------------------- */
const tick = { fontSize: 11, fill: C.muted, fontFamily: "Inter, sans-serif" };
const tooltipProps = { formatter: (v) => eur(v), contentStyle: { borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 12, fontFamily: "Inter, sans-serif" }, labelStyle: { color: C.muted, fontWeight: 600 } };
const legendProps = { wrapperStyle: { fontSize: 12, fontFamily: "Inter, sans-serif", paddingTop: 4 }, iconType: "circle", iconSize: 8 };

function InfoDot({ text, align = "left" }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}>
      <button type="button" aria-label="Uitleg"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} style={St.infoBtn}>i</button>
      {open && <span style={{ ...St.bubble, ...(align === "right" ? { right: 0 } : { left: 0 }) }} onClick={(e) => e.stopPropagation()}>{text}</span>}
    </span>
  );
}

function PeriodPill({ period, onToggle }) {
  return (
    <button type="button" onClick={onToggle} style={St.periodPill} aria-label="Per maand of per jaar invullen" title="Wissel tussen per maand en per jaar">
      {period === "year" ? "/jr" : "/mnd"}
    </button>
  );
}

function AmountField({ value, period, onValue, onPeriod, onCommit }) {
  return (
    <div style={St.amountField}>
      <PeriodPill period={period} onToggle={onPeriod} />
      <MoneyInput value={value} onChange={onValue} onCommit={onCommit} />
    </div>
  );
}

function DerivedLine({ monthly, period, percent, dot }) {
  const other = period === "year" ? `${eur(monthly)} per maand` : `${eur(monthly * 12)} per jaar`;
  return (
    <div style={{ ...St.derived, marginLeft: dot ? 20 : 2 }}>
      = {other}{percent != null ? ` · ${Math.round(percent * 100)}%` : ""}
    </div>
  );
}

function SubTotal({ monthly }) {
  return (
    <div style={St.subTotal}>
      <span>Totaal</span>
      <span style={St.subTotalVal}>{eur(monthly)} <span style={St.subTotalYr}>· {eur(monthly * 12)} p/j</span></span>
    </div>
  );
}

function Collapsible({ id, title, icon, info, total, open, onToggle, children }) {
  return (
    <section style={St.section} className="fade">
      <div role="button" tabIndex={0} aria-expanded={open}
        onClick={() => onToggle(id)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(id); } }}
        style={St.collapseHead}>
        <span style={St.h2}>{icon}{icon ? " " : ""}{title}</span>
        {info && <InfoDot text={info} />}
        <span style={{ flex: 1 }} />
        {total != null && <span style={St.headTotal}>{total}</span>}
        <ChevronDown size={18} style={{ color: C.muted, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s", flexShrink: 0 }} />
      </div>
      {open && <div style={St.collapseBody}>{children}</div>}
    </section>
  );
}

function ChartTitle({ children }) { return <div style={St.chartTitle}>{children}</div>; }

function ColTitle({ children }) { return <div style={St.colTitle}>{children}</div>; }

function Bd({ label, value, sign = "", color, strong, muted }) {
  return (
    <div style={St.bdRow}>
      <span style={{ color: muted ? C.muted : C.ink, fontWeight: strong ? 700 : 500 }}>{label}</span>
      <span style={{ textAlign: "right" }}>
        <span style={{ color: color || (muted ? C.muted : C.ink), fontWeight: strong ? 700 : 600, fontVariantNumeric: "tabular-nums" }}>{sign}{eur(value)}</span>
        <span style={St.bdYear}>{sign}{eur(value * 12)} p/j</span>
      </span>
    </div>
  );
}

function ContribCard({ name, color, soft, amount }) {
  return (
    <div style={{ ...St.contribCard, background: soft }}>
      <div style={{ ...St.contribName, color }}>{name}</div>
      <div style={St.contribAmount}>{eur(amount)}</div>
      <div style={St.contribSub}>maakt over · {eur0(amount * 12)} p/j</div>
    </div>
  );
}

function LeftoverCard({ name, color, amount }) {
  return (
    <div style={St.leftoverCard}>
      <div style={St.leftoverTop}><span style={{ ...St.dot, background: color, margin: 0 }} /><span style={St.leftoverName}>{name}</span></div>
      <div style={{ ...St.leftoverAmount, color: amount < 0 ? C.a : C.ink }}>{eur(amount)}</div>
      <div style={St.leftoverYr}>{eur0(amount * 12)} p/j</div>
    </div>
  );
}

function SplitBar({ label, fracA, nameA, nameB }) {
  const pa = Math.max(0, Math.min(1, fracA));
  return (
    <div style={St.splitWrap}>
      <div style={St.splitHead}><span style={St.splitLabel}>{label}</span><span style={St.splitPcts}>{pct(pa)} · {pct(1 - pa)}</span></div>
      <div style={St.splitTrack}>
        <div style={{ width: `${pa * 100}%`, background: C.a, borderTopLeftRadius: 999, borderBottomLeftRadius: 999 }} title={nameA} />
        <div style={{ width: `${(1 - pa) * 100}%`, background: C.b, borderTopRightRadius: 999, borderBottomRightRadius: 999 }} title={nameB} />
      </div>
    </div>
  );
}

function MoneyInput({ value, onChange, onCommit }) {
  const startRef = useRef(null);
  return (
    <div style={St.money}>
      <span style={St.euro}>€</span>
      <input inputMode="decimal" value={value} placeholder="0"
        onFocus={() => { startRef.current = value; }}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ""))}
        onBlur={() => { if (onCommit && startRef.current !== value) onCommit(startRef.current, value); }}
        style={St.moneyInput} aria-label="Bedrag" />
    </div>
  );
}

function LinkField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const editingRef = useRef(false);
  const timer = useRef(null);
  const has = value && value.trim().length > 0;
  const href = has ? (/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`) : null;
  const openNow = () => { clearTimeout(timer.current); setOpen(true); };
  const closeSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!editingRef.current) setOpen(false); }, 200); };
  return (
    <span style={{ position: "relative", display: "inline-flex" }} onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button type="button" aria-label="Link bij deze uitgave"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{ ...St.iconBtn, color: has ? C.b : C.muted }}>
        <Link2 size={16} />
      </button>
      {open && (
        <span style={St.notePop} onMouseEnter={openNow} onMouseLeave={closeSoon} onClick={(e) => e.stopPropagation()}>
          <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…"
            onFocus={() => { editingRef.current = true; }}
            onBlur={() => { editingRef.current = false; setOpen(false); }}
            style={St.noteInput} aria-label="URL" />
          {href && <a href={href} target="_blank" rel="noopener noreferrer" style={St.noteLink}>Open link ↗</a>}
        </span>
      )}
    </span>
  );
}

function NoteField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const editingRef = useRef(false);
  const timer = useRef(null);
  const has = value && value.trim().length > 0;
  const openNow = () => { clearTimeout(timer.current); setOpen(true); };
  const closeSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!editingRef.current) setOpen(false); }, 200); };
  return (
    <span style={{ position: "relative", display: "inline-flex" }} onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button type="button" aria-label="Notitie bij deze uitgave"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{ ...St.iconBtn, color: has ? C.b : C.muted }}>
        <MessageSquare size={16} />
      </button>
      {open && (
        <span style={St.notePop} onMouseEnter={openNow} onMouseLeave={closeSoon} onClick={(e) => e.stopPropagation()}>
          <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3}
            placeholder="Notitie bij deze uitgave…"
            onFocus={() => { editingRef.current = true; }}
            onBlur={() => { editingRef.current = false; setOpen(false); }}
            style={St.noteArea} />
        </span>
      )}
    </span>
  );
}

/* ----------------------------------------------------------------
   Styles
------------------------------------------------------------------- */
const St = {
  page: { minHeight: "100vh", background: C.canvas, color: C.ink, fontFamily: "'Inter', system-ui, sans-serif", fontFeatureSettings: "'tnum' 1", padding: "24px 16px 56px" },
  shell: { maxWidth: 780, margin: "0 auto" },

  header: { padding: "8px 4px 16px" },
  eyebrow: { fontSize: 12, letterSpacing: "0.14em", color: C.muted, fontWeight: 600 },
  titleRow: { display: "flex", alignItems: "center", gap: 10, marginTop: 6 },
  h1: { fontFamily: "'Inter', system-ui, sans-serif", fontSize: 32, lineHeight: 1.05, margin: 0, fontWeight: 800, letterSpacing: "-0.02em" },
  byline: { margin: "6px 0 0", fontSize: 13, color: C.muted },
  link: { color: C.b, fontWeight: 600, textDecoration: "none", borderBottom: `1px solid ${C.b}40` },
  colTitle: { fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", color: C.ink, margin: "4px 2px 14px" },

  monthNav: { display: "flex", alignItems: "center", justifyContent: "center", gap: 16, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 6, marginBottom: 14 },
  navBtn: { border: "none", background: C.canvas, color: C.ink, cursor: "pointer", width: 38, height: 38, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center" },
  monthLabelWrap: { display: "flex", alignItems: "center", gap: 8 },
  monthLabel: { fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 17, fontWeight: 700, textTransform: "capitalize" },
  nowTag: { fontSize: 11, fontWeight: 700, color: C.save, background: "#E4F0E9", padding: "2px 7px", borderRadius: 999 },

  hero: { background: C.card, borderRadius: 20, padding: 20, border: `1px solid ${C.line}`, marginBottom: 14 },
  methodRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 10, flexWrap: "wrap" },
  methodLabel: { fontSize: 13, color: C.muted, fontWeight: 600 },
  toggle: { display: "inline-flex", background: C.canvas, borderRadius: 999, padding: 3 },
  toggleBtn: { border: "none", background: "transparent", padding: "7px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, color: C.muted, cursor: "pointer", fontFamily: "inherit" },
  toggleOn: { background: C.card, color: C.ink, boxShadow: "0 1px 3px rgba(0,0,0,0.10)" },

  contribGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 },
  contribCard: { borderRadius: 14, padding: "14px 14px 13px" },
  contribName: { fontSize: 13, fontWeight: 700, marginBottom: 4 },
  contribAmount: { fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 25, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1 },
  contribSub: { fontSize: 11.5, color: C.muted, marginTop: 6 },

  splitWrap: { marginTop: 12 },
  splitHead: { display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 },
  splitLabel: { color: C.muted, fontWeight: 600 },
  splitPcts: { color: C.muted, fontVariantNumeric: "tabular-nums" },
  splitTrack: { display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: C.canvas },

  leftLabel: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 10, fontSize: 13, color: C.muted, fontWeight: 600 },
  fairInline: { display: "inline-flex", alignItems: "center", gap: 6, color: C.ink },
  leftoverGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  leftoverCard: { border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 13px" },
  leftoverTop: { display: "flex", alignItems: "center", gap: 7, marginBottom: 6 },
  leftoverName: { fontSize: 13, fontWeight: 600, color: C.muted },
  leftoverAmount: { fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 22, fontWeight: 700 },
  leftoverYr: { fontSize: 11.5, color: C.muted, marginTop: 3 },

  detailsBtn: { display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "transparent", color: C.muted, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginTop: 16, padding: 0 },
  details: { marginTop: 12, background: C.canvas, borderRadius: 12, padding: "12px 14px" },
  bdRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0", fontSize: 13.5 },
  bdYear: { display: "block", fontSize: 11, color: C.muted, fontVariantNumeric: "tabular-nums" },
  margeRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}`, gap: 10 },
  margeLabel: { fontSize: 13, color: C.muted },

  section: { background: C.card, borderRadius: 18, padding: "16px 18px", border: `1px solid ${C.line}`, marginBottom: 12 },
  collapseHead: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none", outline: "none" },
  collapseBody: { marginTop: 14 },
  h2: { fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 19, fontWeight: 700, margin: 0, display: "inline-flex", alignItems: "center", gap: 6 },
  headTotal: { fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 16, color: C.ink, fontVariantNumeric: "tabular-nums" },

  itemWrap: { marginBottom: 12 },
  row: { display: "flex", alignItems: "center", gap: 10 },
  expRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  dot: { width: 10, height: 10, borderRadius: 999, flexShrink: 0 },
  nameInput: { flex: 1, minWidth: 90, border: "none", borderBottom: `1px solid ${C.line}`, background: "transparent", padding: "8px 2px", fontSize: 15, color: C.ink, fontFamily: "inherit", outline: "none" },
  catInput: { width: 104, flexShrink: 0, border: "none", borderBottom: `1px solid ${C.line}`, background: C.canvas, borderRadius: "6px 6px 0 0", padding: "8px 8px", fontSize: 12.5, color: C.muted, fontFamily: "inherit", outline: "none" },
  derived: { fontSize: 12, color: C.muted, marginTop: 4, fontVariantNumeric: "tabular-nums" },

  amountField: { display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 },
  periodPill: { border: "none", background: C.canvas, color: C.muted, fontSize: 11, fontWeight: 700, padding: "5px 7px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", minWidth: 38, textAlign: "center" },
  money: { display: "inline-flex", alignItems: "center", background: C.canvas, borderRadius: 10, padding: "0 10px", flexShrink: 0 },
  euro: { fontSize: 14, color: C.muted, marginRight: 2 },
  moneyInput: { width: 72, border: "none", background: "transparent", padding: "9px 0", fontSize: 15, textAlign: "right", color: C.ink, fontFamily: "inherit", fontVariantNumeric: "tabular-nums", outline: "none" },

  iconBtn: { border: "none", background: "transparent", color: C.muted, cursor: "pointer", padding: 6, borderRadius: 8, display: "inline-flex", flexShrink: 0 },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 6, border: `1px dashed ${C.line}`, background: "transparent", color: C.muted, padding: "9px 12px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginTop: 2 },

  catSummary: { marginTop: 14, background: C.canvas, borderRadius: 12, padding: "12px 14px" },
  catSummaryTitle: { fontSize: 12, fontWeight: 700, color: C.muted, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 },
  catSummaryRow: { display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "baseline", columnGap: 14, fontSize: 13.5, padding: "3px 0" },
  catName: { display: "inline-flex", alignItems: "center", gap: 7, color: C.ink, minWidth: 0 },
  catMonthly: { textAlign: "right", fontVariantNumeric: "tabular-nums", color: C.ink, fontWeight: 600, whiteSpace: "nowrap" },
  catSummaryVal: { fontVariantNumeric: "tabular-nums", color: C.ink },
  catYr: { color: C.muted, fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  catDot: { width: 10, height: 10, borderRadius: 999, flexShrink: 0 },
  hint: { fontSize: 12.5, color: C.muted, margin: "0 2px 10px", lineHeight: 1.4 },
  notePop: { position: "absolute", top: "calc(100% + 8px)", right: 0, width: 230, maxWidth: "70vw", background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.14)", padding: 8, zIndex: 30 },
  noteArea: { width: "100%", border: "none", outline: "none", resize: "vertical", fontFamily: "inherit", fontSize: 13, lineHeight: 1.45, color: C.ink, background: "transparent" },
  noteInput: { width: "100%", border: "none", outline: "none", fontFamily: "inherit", fontSize: 13, color: C.ink, background: "transparent" },
  noteLink: { display: "inline-block", marginTop: 8, fontSize: 12.5, color: C.b, fontWeight: 600, textDecoration: "none", borderTop: `1px solid ${C.line}`, paddingTop: 7, width: "100%" },
  logEmpty: { fontSize: 13.5, lineHeight: 1.5, color: C.muted, background: C.canvas, borderRadius: 12, padding: "14px 14px" },
  logList: { display: "flex", flexDirection: "column", gap: 2, maxHeight: 360, overflowY: "auto" },
  logRow: { display: "flex", gap: 12, alignItems: "baseline", padding: "7px 4px", borderBottom: `1px solid ${C.line}` },
  logTime: { fontSize: 12, color: C.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0, minWidth: 96 },
  logBody: { display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "baseline", flex: 1 },
  logLabel: { fontSize: 13.5, color: C.ink, fontWeight: 600 },
  logChange: { display: "inline-flex", alignItems: "baseline", gap: 6, fontSize: 13, fontVariantNumeric: "tabular-nums" },
  logOld: { color: C.muted, textDecoration: "line-through" },
  logArrow: { color: C.muted },
  logNew: { color: C.ink, fontWeight: 600 },

  subTotal: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}`, fontSize: 14, color: C.muted },
  subTotalVal: { fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 17, color: C.ink },
  subTotalYr: { fontFamily: "'Inter', sans-serif", fontSize: 12.5, color: C.muted, fontWeight: 400 },

  chartTitle: { fontSize: 13, fontWeight: 600, color: C.muted, margin: "6px 2px 8px" },
  chartBox: { width: "100%", height: 220, marginBottom: 18 },
  emptyHist: { display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, lineHeight: 1.5, color: C.muted, background: C.canvas, borderRadius: 12, padding: "14px 14px" },

  monthList: { marginTop: 6, borderTop: `1px solid ${C.line}`, paddingTop: 10 },
  monthItem: { display: "flex", alignItems: "center", gap: 4, borderRadius: 10, paddingRight: 4 },
  monthItemActive: { background: C.canvas },
  monthItemBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", border: "none", background: "transparent", cursor: "pointer", padding: "9px 10px", fontFamily: "inherit", color: C.ink },
  monthItemName: { fontSize: 14, fontWeight: 600, textTransform: "capitalize" },
  monthItemPot: { fontSize: 12.5, color: C.muted, fontVariantNumeric: "tabular-nums" },

  infoBtn: { width: 18, height: 18, borderRadius: 999, border: `1px solid ${C.line}`, background: C.card, color: C.muted, fontSize: 11, fontWeight: 700, fontStyle: "italic", lineHeight: 1, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, fontFamily: "Georgia, serif" },
  bubble: { position: "absolute", top: "calc(100% + 8px)", width: 230, maxWidth: "70vw", background: C.ink, color: "#F4F6F5", fontSize: 12.5, lineHeight: 1.45, padding: "10px 12px", borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.18)", zIndex: 30, fontWeight: 400, fontStyle: "normal" },

  footer: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 4px 0", flexWrap: "wrap", gap: 10 },
  saveState: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: C.muted },
  resetBtn: { display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "transparent", color: C.muted, fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Inter:wght@400;500;600;700&display=swap');
* { box-sizing: border-box; }
.layout { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: start; }
@media (min-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
}
input::placeholder { color: #9aa5a1; }
input:focus-visible, button:focus-visible, [role="button"]:focus-visible { outline: 2px solid ${C.b}; outline-offset: 2px; border-radius: 6px; }
.spin { animation: sp 1s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
.fade { animation: fade .4s ease both; }
@keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .fade, .spin { animation: none !important; } }
`;
