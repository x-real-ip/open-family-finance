/**
 * Open Family Finance — the whole UI lives in this file.
 *
 * Reading guide (top to bottom):
 *   Design tokens .... colors (C); UI texts (TXT) live in ./i18n and ./locales
 *   Helpers .......... numbers, currency and month keys
 *   Core calculation . computeTotals: the fair split
 *   Data model ....... per-month figures + migration/normalization
 *   App .............. state, mutations and page layout
 *   Subcomponents .... fields, popovers, cards, icons
 *   Styles ........... inline styles (St) and global CSS
 *
 * Forward propagation:
 *   An edit in a month is applied to that month AND to every future
 *   month that has no manual override for the same entry. Each month
 *   keeps an `overrides` map ({ [entryId]: true }); editing an entry
 *   in a month marks it overridden there, so later edits to earlier
 *   months no longer touch it. Special keys: "__method", "__marge".
 */
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Trash2, RotateCcw, Check, Loader2, ChevronLeft, ChevronRight,
  ChevronDown, TrendingUp, Landmark, PiggyBank, Wallet, Receipt, MessageSquare, History, Link2,
  ArrowDown, ArrowUp, Minus, Copy, LineChart as LineChartIcon, Sun, Moon,
  Calculator, Github,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { storage } from "./api";
import { LANG, TXT, t, getRuntimeCurrencyLocale, getRuntimeDateLocale, getRuntimeAppTitle } from "./i18n";

/* ----------------------------------------------------------------
   Design tokens
------------------------------------------------------------------- */
const C = {
  canvas: "var(--canvas)", card: "var(--card)", ink: "var(--ink)", muted: "var(--muted)", line: "var(--line)",
  a: "var(--a)", b: "var(--b)", gov: "var(--gov)", save: "var(--save)", inc: "var(--inc)", exp: "var(--exp)", softA: "var(--soft-a)", softB: "var(--soft-b)",
};

const KEY = "open-family-finance:v1";
const APP_TITLE = getRuntimeAppTitle();

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

/* Empty defaults. Real amounts are stored in the database, not in the
   code, so this repository can be public. */
const DEFAULT_FIGURES = {
  method: "income",
  margePct: "0.5",
  partners: [
    { id: "p1", name: "", income: "", period: "month", note: "", url: "" },
    { id: "p2", name: "", income: "", period: "month", note: "", url: "" },
  ],
  govIncome: [],
  expenses: [],
  savings: [],
  overrides: {},
};

/* ----------------------------------------------------------------
   Helpers
------------------------------------------------------------------- */
// — numbers & amounts —
const num = (x) => { const v = parseFloat(String(x).replace(",", ".")); return isFinite(v) ? v : 0; };
const round2 = (n) => Math.round(n * 100) / 100;
const toMonthly = (amountStr, period) => num(amountStr) / (period === "year" ? 12 : 1);
const monthlyOf = (x, monthData, visited = new Set()) => {
  if (x?.formula && monthData) {
    if (visited.has(x.id)) return 0;
    const amount = computeFormulaAmount(x, monthData);
    return toMonthly(amount, x.period);
  }
  return toMonthly(x.amount, x.period);
};
const monthlyInc = (p) => toMonthly(p.income, p.period);
const entryKinds = ["govIncome", "expenses", "savings"];
const findEntryById = (monthData, id) => {
  if (!monthData || !id) return null;
  for (const kind of entryKinds) {
    const item = (monthData[kind] || []).find((x) => x.id === id);
    if (item) return item;
  }
  return null;
};
const computeFormulaAmount = (entry, monthData) => {
  if (!entry?.formula || !monthData) return null;
  const source = findEntryById(monthData, entry.formula.sourceId);
  const sourceMonthly = source ? monthlyOf(source, monthData, new Set([entry.id])) : 0;
  // Support a sequential list of operations (`ops`) or fall back to the legacy single op/factor
  const ops = entry.formula.ops ?? (entry.formula.op ? [{ op: entry.formula.op, factor: entry.formula.factor }] : []);
  let result = sourceMonthly;
  if (ops.length === 0) {
    // No operations specified — return the source amount
    result = sourceMonthly;
  } else {
    for (const step of ops) {
      const op = step.op;
      const factor = num(step.factor);
      if (op === "minus") result = result - factor;
      else if (op === "times") result = result * factor;
      else if (op === "divide") result = factor === 0 ? 0 : result / factor;
      else if (op === "plus") result = result + factor;
    }
  }
  return entry.period === "year" ? result * 12 : result;
};
const entryAmount = (entry, monthData) => {
  const formulaAmount = computeFormulaAmount(entry, monthData);
  return formulaAmount != null ? formulaAmount : num(entry.amount);
};
const sumM = (arr, monthData) => arr.reduce((s, x) => s + monthlyOf(x, monthData), 0);
const flip = (amountStr, fromPeriod) => String(round2(fromPeriod === "year" ? num(amountStr) / 12 : num(amountStr) * 12));
const pctOf = (part, whole) => (whole > 0 ? part / whole : null);

// — formatting (nl-NL) —
function eur(n, locale = getRuntimeCurrencyLocale()) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(isFinite(n) ? n : 0);
}
function eur0(n, locale = getRuntimeCurrencyLocale()) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(isFinite(n) ? n : 0);
}
const pct = (x) => `${Math.round(x * 100)}%`;
const uid = () => Math.random().toString(36).slice(2, 9);
const clone = (o) => JSON.parse(JSON.stringify(o));
function useClickOutside(ref, active, onClose) {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event) => {
      if (!ref.current || ref.current.contains(event.target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown, { passive: true });
    };
  }, [active, onClose, ref]);
}
const mobilePopupStyle = (base) => {
  if (typeof window === "undefined" || window.innerWidth > 640) return base;
  return {
    ...base,
    position: "fixed",
    left: 10,
    right: 10,
    top: "auto",
    bottom: 20,
    width: "auto",
    maxWidth: "calc(100% - 20px)",
    boxSizing: "border-box",
    margin: "0 auto",
    zIndex: 100,
  };
};

// — month keys: "YYYY-MM" —
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const keyToDate = (k) => { const [y, m] = k.split("-").map(Number); return new Date(y, m - 1, 1); };
const shiftMonth = (k, delta) => { const d = keyToDate(k); d.setMonth(d.getMonth() + delta); return monthKey(d); };
const monthLong = (k, locale = getRuntimeDateLocale()) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(keyToDate(k));
const monthShort = (k, locale = getRuntimeDateLocale()) => { const d = keyToDate(k); const m = new Intl.DateTimeFormat(locale, { month: "short" }).format(d); return d.getMonth() === 0 ? `${m} '${String(d.getFullYear()).slice(2)}` : m; };
const dt = (ts, locale = getRuntimeDateLocale()) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(ts));

/* ----------------------------------------------------------------
   Core calculation — the fair split

   coupleFunds = expenses + savings − government benefits
   Each partner contributes a share of coupleFunds — proportional to
   net income ("verhouding") or 50/50 ("equal") — plus a small safety
   margin (margePct). leftover = own salary − own contribution.
------------------------------------------------------------------- */
function computeTotals(fig) {
  const a = monthlyInc(fig.partners[0]), b = monthlyInc(fig.partners[1]), total = a + b;
  const shareA = total > 0 ? a / total : 0.5, shareB = total > 0 ? b / total : 0.5;
  const expensesTotal = sumM(fig.expenses, fig), savingsTotal = sumM(fig.savings, fig);
  const potTotal = expensesTotal + savingsTotal, govTotal = sumM(fig.govIncome, fig);
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

/* ----------------------------------------------------------------
   Data model & persistence

   State shape: { selectedMonth, months: { "YYYY-MM": figures }, log }
   Month keys sort lexicographically = chronologically. Everything is
   stored as one JSON blob under KEY (Postgres via /api; localStorage
   in the standalone preview). migrate/normalize keep older saved
   blobs compatible with the current shape.
------------------------------------------------------------------- */
function migrateFig(f) {
  if (!f) return clone(DEFAULT_FIGURES);
  const per = (p) => (p === "year" ? "year" : "month");
  return {
    method: f.method || "income", margePct: f.margePct ?? "0.5",
    partners: (f.partners && f.partners.length ? f.partners : clone(DEFAULT_FIGURES.partners)).map((p) => ({ ...p, period: per(p.period), note: p.note || "", url: p.url || "" })),
    govIncome: (f.govIncome || []).map((g) => ({ id: g.id || uid(), label: g.label || "", amount: g.amount ?? "", period: per(g.period), note: g.note || "", url: g.url || "", formula: g.formula || undefined })),
    expenses: (f.expenses || []).map((e) => ({ id: e.id || uid(), category: e.category || "", label: e.label || "", amount: e.amount ?? "", period: per(e.period), note: e.note || "", url: e.url || "", formula: e.formula || undefined })),
    savings: f.savings ? f.savings.map((s) => ({ id: s.id || uid(), label: s.label || "", amount: s.amount ?? "", period: per(s.period), note: s.note || "", url: s.url || "", formula: s.formula || undefined }))
      : (f.jointSavings != null ? [{ id: uid(), label: "Sparen", amount: f.jointSavings, period: "month", note: "", url: "" }] : []),
    overrides: (f.overrides && typeof f.overrides === "object") ? { ...f.overrides } : {},
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
  const [open, setOpen] = useState({ inkomen: false, overheid: false, uitgaven: false, sparen: false, verloop: true, log: false });
  const [showDetails, setShowDetails] = useState(false);
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("open-family-finance:theme");
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const saveTimer = useRef(null);
  const margeStart = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = LANG;
    document.title = APP_TITLE;
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("open-family-finance:theme");
    if (stored === "dark" || stored === "light") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event) => setTheme(event.matches ? "dark" : "light");
    mql.addEventListener?.("change", onChange) ?? mql.addListener(onChange);
    return () => { mql.removeEventListener?.("change", onChange) ?? mql.removeListener(onChange); };
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem("open-family-finance:theme", next);
    setTheme(next);
  };

  // ── Load once on mount, then autosave (debounced) ──
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

  // ── Derived state for the selected month ──
  const sel = data.selectedMonth;
  const cur = data.months[sel] || DEFAULT_FIGURES;
  const calc = useMemo(() => computeTotals(cur), [cur]);
  const sortedMonths = useMemo(() => Object.keys(data.months).sort(), [data.months]);
  const pastMonths = useMemo(() => sortedMonths.filter((k) => k < sel), [sortedMonths, sel]);
  const futureMonths = useMemo(() => sortedMonths.filter((k) => k > sel), [sortedMonths, sel]);
  const isCurrentRealMonth = sel === monthKey(new Date());

  const series = useMemo(() => sortedMonths.map((m) => {
    const t = computeTotals(data.months[m]);
    return {
      key: m, label: monthShort(m),
      income: Math.round(t.total), gov: Math.round(t.govTotal),
      expenses: Math.round(t.expensesTotal), savings: Math.round(t.savingsTotal),
      inlegA: Math.round(t.transferA), inlegB: Math.round(t.transferB),
    };
  }), [sortedMonths, data.months]);

  const byCategory = useMemo(() => {
    const map = {};
    for (const e of cur.expenses) map[e.category || TXT.otherCategory] = (map[e.category || TXT.otherCategory] || 0) + monthlyOf(e, cur);
    return Object.entries(map).sort((x, y) => y[1] - x[1]);
  }, [cur]);

  // Existing category names across all months, for autocomplete suggestions.
  const categories = useMemo(() => {
    const set = new Set();
    for (const m of Object.values(data.months)) for (const e of m.expenses) if (e.category) set.add(e.category);
    return [...set].sort();
  }, [data.months]);

  // History of one entry (matched by id) across all months, for the sparkline.
  const entryHistory = (kind, id) => {
    const out = [];
    for (const m of sortedMonths) {
      const it = ((data.months[m] && data.months[m][kind]) || []).find((x) => x.id === id);
      if (!it) continue;
      const v = kind === "partners" ? monthlyInc(it) : monthlyOf(it, data.months[m]);
      out.push({ month: m, label: monthShort(m), value: Math.round(v) });
    }
    return out;
  };
  // Compare the current value to the most recent earlier month that had an entered value.
  const entryTrend = (kind, id, curVal) => {
    if (!(curVal > 0)) return null;
    const idx = sortedMonths.indexOf(sel);
    for (let i = idx - 1; i >= 0; i--) {
      const it = ((data.months[sortedMonths[i]] && data.months[sortedMonths[i]][kind]) || []).find((x) => x.id === id);
      if (!it) continue;
      const prev = toMonthly(kind === "partners" ? it.income : it.amount, it.period);
      if (prev > 0) {
        if (Math.abs(curVal - prev) < 0.005) return null;
        return { dir: curVal > prev ? "up" : "down", prev, cur: curVal };
      }
    }
    return null;
  };

  const toggleSec = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  // ── Month navigation: seed a new month from the nearest earlier one ──
  const goMonth = (delta) => setData((d) => {
    const next = shiftMonth(d.selectedMonth, delta); const months = { ...d.months };
    if (!months[next]) {
      const earlier = Object.keys(months).filter((k) => k < next).sort();
      months[next] = clone(earlier.length ? months[earlier[earlier.length - 1]] : DEFAULT_FIGURES);
    }
    return { ...d, selectedMonth: next, months };
  });
  const goCurrent = () => setData((d) => {
    const current = monthKey(new Date());
    const months = { ...d.months };
    if (!months[current]) {
      const earlier = Object.keys(months).filter((k) => k < current).sort();
      months[current] = clone(earlier.length ? months[earlier[earlier.length - 1]] : DEFAULT_FIGURES);
    }
    return { ...d, selectedMonth: current, months };
  });
  const deleteMonth = (m) => setData((d) => {
    if (Object.keys(d.months).length <= 1) return d;
    const months = { ...d.months }; delete months[m];
    const remaining = Object.keys(months).sort();
    const selectedMonth = d.selectedMonth === m ? remaining[remaining.length - 1] : d.selectedMonth;
    return { ...d, selectedMonth, months };
  });

  // ── Mutations ──
  // Forward-propagation model: an edit changes the selected month AND
  // every future month that has no manual override for the same key,
  // but only when the selected month is the real current month or later.
  // Edits in actual past months only apply to that month.
  // The edited month itself is marked overridden, so it keeps its value
  // when an even earlier month is changed later on.
  const markOverride = (f, key) => ({ ...f, overrides: { ...(f.overrides || {}), [key]: true } });

  const editForward = (updater, overrideKey) => setData((d) => {
    const s = d.selectedMonth;
    const currentRealMonth = monthKey(new Date());
    const months = { ...d.months };
    months[s] = markOverride(updater(months[s]), overrideKey);
    if (s >= currentRealMonth) {
      for (const k of Object.keys(months)) {
        if (k <= s) continue;
        if (months[k].overrides && months[k].overrides[overrideKey]) continue;
        months[k] = updater(months[k]);
      }
    }
    return { ...d, months };
  });

  const setPartner = (i, patch) => {
    const key = cur.partners[i]?.id || `p${i + 1}`;
    editForward((f) => ({ ...f, partners: f.partners.map((p, idx) => idx === i ? { ...p, ...patch } : p) }), key);
  };
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

  // Copy one entry's value from the selected month to existing past/future months,
  // bounded by the chosen months (inclusive). Only that entry's amount is changed
  // in months where it exists; in months where it was removed it is re-added.
  // Note: copying overwrites manual overrides in the target months on purpose —
  // it is an explicit action — but does not mark the targets as overridden.
  const copyEntryRange = (kind, id, pastKey, futureKey) => setData((d) => {
    const s = d.selectedMonth;
    const item = (d.months[s][kind] || []).find((x) => x.id === id);
    if (!item) return d;
    const field = kind === "partners" ? "income" : "amount";
    const months = { ...d.months };
    for (const k of Object.keys(months)) {
      if (k === s) continue;
      const inPast = pastKey && k >= pastKey && k < s;
      const inFuture = futureKey && k > s && k <= futureKey;
      if (!inPast && !inFuture) continue;
      const list = months[k][kind] || [];
      const exists = list.some((x) => x.id === id);
      // If the item we're copying is formula-driven, copy the formula to the target
      // months but do not overwrite other entries' amounts (source entries remain unchanged).
      if (kind !== "partners" && item.formula) {
        months[k] = { ...months[k], [kind]: exists
          ? list.map((x) => x.id === id ? { ...x, formula: clone(item.formula), period: item.period } : x)
          : [...list, clone(item)] };
      } else {
        months[k] = { ...months[k], [kind]: exists
          ? list.map((x) => x.id === id ? { ...x, [field]: item[field], period: item.period } : x)
          : [...list, clone(item)] };
      }
    }
    return { ...d, months };
  });

  const copyMonthToPast = (targetMonths) => setData((d) => {
    const s = d.selectedMonth;
    const source = d.months[s];
    if (!source || !targetMonths?.length) return d;
    const months = { ...d.months };
    for (const k of targetMonths) {
      if (k === s || !months[k]) continue;
      months[k] = clone(source);
    }
    return { ...d, months };
  });

  const togglePartnerPeriod = (i) => {
    const key = cur.partners[i]?.id || `p${i + 1}`;
    editForward((f) => ({ ...f, partners: f.partners.map((p, idx) => idx === i ? { ...p, period: p.period === "year" ? "month" : "year", income: flip(p.income, p.period) } : p) }), key);
  };
  const setMethod = (method) => editForward((f) => ({ ...f, method }), "__method");
  const setMarge = (margePct) => editForward((f) => ({ ...f, margePct }), "__marge");
  const setListItem = (k, id, patch) => editForward((f) => ({ ...f, [k]: f[k].map((x) => x.id === id ? { ...x, ...clone(patch) } : x) }), id);
  const toggleItemPeriod = (k, id) => editForward((f) => ({ ...f, [k]: f[k].map((x) => x.id === id ? { ...x, period: x.period === "year" ? "month" : "year", amount: flip(x.amount, x.period) } : x) }), id);
  const removeListItem = (k, id) => editForward((f) => ({ ...f, [k]: f[k].filter((x) => x.id !== id) }), id);
  const addListItem = (kind, item) => editForward((f) => (
    (f[kind] || []).some((x) => x.id === item.id) ? f : { ...f, [kind]: [...(f[kind] || []), clone(item)] }
  ), item.id);
  const addGov = () => addListItem("govIncome", { id: uid(), label: "", amount: "", period: "month", note: "", url: "" });
  const addExpense = () => addListItem("expenses", { id: uid(), category: "", label: "", amount: "", period: "month", note: "", url: "" });
  const addSaving = () => addListItem("savings", { id: uid(), label: "", amount: "", period: "month", note: "", url: "" });
  // Reset the selected month: take over the figures of the nearest earlier
  // month and clear this month's overrides, so it follows the baseline again.
  // Without an earlier month it falls back to the empty defaults.
  const resetMonth = () => {
    const earlier = sortedMonths.filter((k) => k < sel);
    const hasEarlier = earlier.length > 0;
    const msg = hasEarlier
      ? t(LANG, "restoreMonthFromPrevious", { month: monthLong(sel), source: monthLong(earlier[earlier.length - 1]) })
      : t(LANG, "restoreMonthFromEmpty", { month: monthLong(sel) });
    if (!window.confirm(msg)) return;
    setData((d) => {
      const s = d.selectedMonth;
      const keys = Object.keys(d.months).filter((k) => k < s).sort();
      const source = keys.length ? d.months[keys[keys.length - 1]] : null;
      const fresh = clone(source || DEFAULT_FIGURES);
      fresh.overrides = {};
      if (!source) {
        // Keep the (global) partner names when falling back to the defaults.
        fresh.partners = fresh.partners.map((p, i) => ({ ...p, name: d.months[s]?.partners?.[i]?.name || p.name }));
      }
      return { ...d, months: { ...d.months, [s]: fresh } };
    });
  };
  const pA = cur.partners[0], pB = cur.partners[1];
  const nameA = pA.name || t(LANG, "partnerName", { n: 1 }), nameB = pB.name || t(LANG, "partnerName", { n: 2 });

  // ── Render ──
  return (
    <div style={St.page}>
      <style>{CSS}</style>
      <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>

      <div style={St.shell} className="shell">
        <header style={St.header}>
          <div style={St.headerTop}>
            <h1 style={St.h1}>{APP_TITLE}</h1>
            <button type="button" onClick={toggleTheme} style={St.themeBtn} aria-label={t(LANG, "themeToggle", { theme: theme === "dark" ? TXT.themeLight : TXT.themeDark })}>
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} {theme === "dark" ? TXT.themeLight : TXT.themeDark}
            </button>
          </div>
        </header>

        {/* Month */}
        <div style={St.monthNav} className="fade">
          <button type="button" onClick={() => goMonth(-1)} style={St.navBtn} aria-label={TXT.previousMonth}><ChevronLeft size={18} /></button>
          <div style={St.monthLabelWrap}>
            <span style={St.monthLabel}>{monthLong(sel)}</span>
            {isCurrentRealMonth && <span style={St.nowTag}>{TXT.nowTag}</span>}
          </div>
          <select value={sel} onChange={(e) => setData((d) => ({ ...d, selectedMonth: e.target.value }))} style={St.monthSelect} aria-label={TXT.chooseMonth}>
            {sortedMonths.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
          </select>
          <button type="button" onClick={goCurrent} style={St.currentBtn} aria-label={TXT.currentMonth}>{TXT.currentMonth}</button>
          <button type="button" onClick={() => goMonth(1)} style={St.navBtn} aria-label={TXT.nextMonth}><ChevronRight size={18} /></button>
          {sortedMonths.length > 1 && (
            <button type="button" onClick={() => deleteMonth(sel)} style={St.navBtn} aria-label={`${TXT.deleteMonth} · ${monthLong(sel)}`}><Trash2 size={16} /></button>
          )}
        </div>

        {/* Distribution (result) — full width */}
        <section style={St.hero} className="fade">
          <div style={St.methodRow}>
            <span style={St.methodLabel}>{TXT.distributionMethod}</span>
            <div style={St.toggle} role="group" aria-label={TXT.distributionMethod}>
              <button type="button" onClick={() => setMethod("income")} style={{ ...St.toggleBtn, ...(cur.method === "income" ? St.toggleOn : {}) }}>{TXT.incomeMethod}</button>
              <button type="button" onClick={() => setMethod("equal")} style={{ ...St.toggleBtn, ...(cur.method === "equal" ? St.toggleOn : {}) }}>{TXT.equalMethod}</button>
            </div>
          </div>

          <div style={St.contribGrid}>
            <ContribCard name={nameA} color={C.a} soft={C.softA} amount={calc.transferA} />
            <ContribCard name={nameB} color={C.b} soft={C.softB} amount={calc.transferB} />
          </div>

<SplitBar label={TXT.incomeSplit} fracA={calc.shareA} nameA={nameA} nameB={nameB} />
            <SplitBar label={TXT.contributionSplit} fracA={calc.contribShareA} nameA={nameA} nameB={nameB} />

          <div style={St.leftLabel}>
            <span>{TXT.keepsLeft}</span>
            <span style={St.fairInline}>
              {cur.method === "income" ? `${pct(calc.keepA)}` : `${pct(calc.keepA)} · ${pct(calc.keepB)}`}
              <InfoDot text={TXT.fair} align="right" />
            </span>
          </div>
          <div style={St.leftoverGrid}>
            <LeftoverCard name={nameA} color={C.a} amount={calc.leftoverA} />
            <LeftoverCard name={nameB} color={C.b} amount={calc.leftoverB} />
          </div>

          <button type="button" onClick={() => setShowDetails((s) => !s)} style={St.detailsBtn} aria-expanded={showDetails}>
            {TXT.howComputed}
            <ChevronDown size={15} style={{ transform: showDetails ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>
          {showDetails && (
            <div style={St.details}>
              <div style={St.detailsHeader}>{TXT.howComputedHeader}</div>
              <div style={St.detailSection}>
                <Bd label={TXT.expenses} value={calc.expensesTotal} />
                <Bd label={TXT.savings} value={calc.savingsTotal} />
                <div style={St.detailSubtotal}>
                  <span style={St.detailSubtotalLabel}>{TXT.subtotalExpensesSavings}</span>
                  <span style={St.detailSubtotalValue}>{eur(calc.expensesTotal + calc.savingsTotal)}</span>
                </div>
              </div>
              <div style={St.detailSection}>
                <Bd label={TXT.governmentBenefit} value={calc.govTotal} sign="− " color={C.gov} />
              </div>
              <div style={St.detailResult}>
                <span>{TXT.coupleFunds}</span>
                <span>{eur(calc.coupleFunds)}</span>
              </div>
              <Bd label={t(LANG, "buffer", { pct: num(cur.margePct) })} value={calc.buffer} sign="+ " muted />
              <div style={St.margeRow}>
                <span style={St.margeLabel}>{TXT.bufferMarginTransfer}</span>
                <div style={St.money}>
                  <input inputMode="decimal" value={cur.margePct}
                    onFocus={() => { margeStart.current = cur.margePct; }}
                    onChange={(e) => setMarge(e.target.value.replace(/[^0-9.,]/g, ""))}
                    onBlur={() => { if (margeStart.current !== cur.margePct) logChange(TXT.bufferMarginPct, margeStart.current, cur.margePct); }}
                    style={{ ...St.moneyInput, width: 50 }} aria-label={TXT.marginPercentage} />
                  <span style={St.euro}>%</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Statistics */}
        <Collapsible id="verloop" title={TXT.statistics} total={t(LANG, "months", { count: sortedMonths.length })} open={open.verloop} onToggle={toggleSec}>
          {series.length < 2 ? (
            <div style={St.emptyHist}>
              <TrendingUp size={18} style={{ color: C.muted }} />
              <span>{TXT.noSeries}</span>
            </div>
          ) : (
            <>
              <ChartTitle>{TXT.incomePerMonth}</ChartTitle>
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
              <ChartTitle>{TXT.monthTotals}</ChartTitle>
              <div style={St.chartBox}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid stroke={C.line} vertical={false} />
                    <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
                    <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={eur0} />
                    <Tooltip {...tooltipProps} /><Legend {...legendProps} />
                    <Bar dataKey="income" name={TXT.incomes} fill={C.inc} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="gov" name={TXT.government} fill={C.gov} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" name={TXT.expenses} fill={C.exp} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="savings" name={TXT.savings} fill={C.save} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Collapsible>

        <ColTitle>{TXT.incomes}</ColTitle>
        {/* Income */}
        <Collapsible id="inkomen" title={TXT.salarySection} icon={<Wallet size={16} style={{ color: C.inc }} />} info={TXT.salary} total={eur(calc.total)} open={open.inkomen} onToggle={toggleSec} style={St.sectionIncome}>
          {[pA, pB].map((p, i) => (
            <div style={St.itemWrap} className="entryWrap" key={p.id}>
              <div className="entry">
                <span className="e-lead"><span style={{ ...St.dot, background: i === 0 ? C.a : C.b }} /></span>
                <input className="e-desc" aria-label={t(LANG, "partnerName", { n: i + 1 })} value={p.name} placeholder={t(LANG, "partnerPlaceholder", { n: i + 1 })} onChange={(e) => setPartnerName(i, e.target.value)} style={{ ...St.nameInput, fontWeight: 600 }} />
                <span className="e-amount"><AmountField value={p.income} period={p.period} onValue={(v) => setPartner(i, { income: v })} onPeriod={() => togglePartnerPeriod(i)} onCommit={(o, n) => logChange(`${TXT.salarySection} · ${p.name || t(LANG, "partnerName", { n: i + 1 })}`, o, n)} /></span>
                <span className="entryActions" style={St.rowActions}>
                  <NoteField value={p.note || ""} onChange={(v) => setPartner(i, { note: v })} />
                  <LinkField value={p.url || ""} onChange={(v) => setPartner(i, { url: v })} />
                  <TrendIcon income trend={entryTrend("partners", p.id, monthlyInc(p))} />
                  <SparkIcon history={entryHistory("partners", p.id)} />
                  <CopyField pastMonths={pastMonths} futureMonths={futureMonths} onCopy={(pk, fk) => copyEntryRange("partners", p.id, pk, fk)} />
                </span>
              </div>
              <DerivedLine monthly={monthlyInc(p)} period={p.period} percent={pctOf(monthlyInc(p), calc.total)} dot />
            </div>
          ))}
          <SubTotal monthly={calc.total} />
        </Collapsible>

        {/* Government */}
        <Collapsible id="overheid" title={TXT.government} icon={<Landmark size={16} style={{ color: C.gov }} />} info={TXT.gov} total={eur(calc.govTotal)} open={open.overheid} onToggle={toggleSec} style={St.sectionIncome}>
          {cur.govIncome.map((g) => {
            const formulaActive = Boolean(g.formula);
            const displayAmount = formulaActive ? String(round2(entryAmount(g, cur))) : g.amount;
            return (
              <div style={St.itemWrap} className="entryWrap" key={g.id}>
                <div className="entry">
                  <span className="e-lead"><span style={{ ...St.dot, background: C.gov }} /></span>
                  <input className="e-desc" aria-label={TXT.description} value={g.label} placeholder={TXT.descriptionPlaceholder} onChange={(e) => setListItem("govIncome", g.id, { label: e.target.value })} style={St.nameInput} />
                  <span className="e-amount"><AmountField value={displayAmount} period={g.period} onValue={(v) => setListItem("govIncome", g.id, { amount: v })} onPeriod={() => toggleItemPeriod("govIncome", g.id)} onCommit={(o, n) => logChange(`${TXT.government} · ${g.label || TXT.government}`, o, n)} disabled={formulaActive} /></span>
                  <span className="entryActions" style={St.rowActions}>
                    <NoteField value={g.note || ""} onChange={(v) => setListItem("govIncome", g.id, { note: v })} />
                    <LinkField value={g.url || ""} onChange={(v) => setListItem("govIncome", g.id, { url: v })} />
                    <FormulaField entry={g} monthData={cur} onChange={(patch) => setListItem("govIncome", g.id, patch)} />
                    <TrendIcon income trend={entryTrend("govIncome", g.id, monthlyOf(g, cur))} />
                    <SparkIcon history={entryHistory("govIncome", g.id)} />
                    <CopyField pastMonths={pastMonths} futureMonths={futureMonths} onCopy={(pk, fk) => copyEntryRange("govIncome", g.id, pk, fk)} />
                    <button type="button" aria-label={TXT.delete} onClick={() => removeListItem("govIncome", g.id)} style={St.iconBtn}><Trash2 size={16} /></button>
                  </span>
                </div>
                <DerivedLine monthly={monthlyOf(g, cur)} period={g.period} percent={pctOf(monthlyOf(g, cur), calc.govTotal)} dot />
              </div>
            );
          })}
          <button type="button" onClick={addGov} style={St.addBtn}><Plus size={16} /> {TXT.addGovernment}</button>
          <SubTotal monthly={calc.govTotal} />
        </Collapsible>

        <ColTitle>{TXT.expensesSection}</ColTitle>
        {/* Expenses */}
        <Collapsible id="uitgaven" title={TXT.fixedCosts} icon={<Receipt size={16} style={{ color: C.exp }} />} info={TXT.exp} total={eur(calc.expensesTotal)} open={open.uitgaven} onToggle={toggleSec} style={St.sectionExpenses}>
          {cur.expenses.map((e) => {
            const formulaActive = Boolean(e.formula);
            const displayAmount = formulaActive ? String(round2(entryAmount(e, cur))) : e.amount;
            return (
              <div style={St.itemWrap} className="entryWrap" key={e.id}>
                <div className="entry exp">
                  <span className="e-lead">
                    <span style={{ ...St.catDot, background: categoryColor(e.category) }} title={e.category || TXT.otherCategory} />
                    <input list="cats" aria-label={TXT.category} value={e.category} placeholder={TXT.categoryPlaceholder} onChange={(ev) => setListItem("expenses", e.id, { category: ev.target.value })} style={St.catInput} />
                  </span>
                  <input className="e-desc" aria-label={TXT.description} value={e.label} placeholder={TXT.descriptionPlaceholder} onChange={(ev) => setListItem("expenses", e.id, { label: ev.target.value })} style={St.nameInput} />
                  <span className="e-amount"><AmountField value={displayAmount} period={e.period} onValue={(v) => setListItem("expenses", e.id, { amount: v })} onPeriod={() => toggleItemPeriod("expenses", e.id)} onCommit={(o, n) => logChange(`${TXT.expensesSection} · ${e.label || TXT.unnamed}`, o, n)} disabled={formulaActive} /></span>
                  <span className="entryActions" style={St.rowActions}>
                    <NoteField value={e.note || ""} onChange={(v) => setListItem("expenses", e.id, { note: v })} />
                    <LinkField value={e.url || ""} onChange={(v) => setListItem("expenses", e.id, { url: v })} />
                    <FormulaField entry={e} monthData={cur} onChange={(patch) => setListItem("expenses", e.id, patch)} />
                    <TrendIcon income={false} trend={entryTrend("expenses", e.id, monthlyOf(e, cur))} />
                    <SparkIcon history={entryHistory("expenses", e.id)} />
                    <CopyField pastMonths={pastMonths} futureMonths={futureMonths} onCopy={(pk, fk) => copyEntryRange("expenses", e.id, pk, fk)} />
                    <button type="button" aria-label={TXT.delete} onClick={() => removeListItem("expenses", e.id)} style={St.iconBtn}><Trash2 size={16} /></button>
                  </span>
                </div>
                <DerivedLine monthly={monthlyOf(e, cur)} period={e.period} percent={pctOf(monthlyOf(e, cur), calc.expensesTotal)} />
              </div>
            );
          })}
          <button type="button" onClick={addExpense} style={St.addBtn}><Plus size={16} /> {TXT.addExpense}</button>
          {byCategory.length > 0 && (
            <div style={St.catSummary}>
              <div style={St.catSummaryTitle}>{TXT.perCategory}</div>
              {byCategory.map(([cat, val]) => (
                <div style={St.catSummaryRow} key={cat}>
                  <span style={St.catName}>
                    <span style={{ ...St.catDot, background: categoryColor(cat === TXT.otherCategory ? "" : cat) }} />
                    {cat}
                  </span>
                  <span style={St.catMonthly}>{eur(val)}</span>
                  <span style={St.catYr}>{eur(val * 12)} {TXT.perYearShort}</span>
                </div>
              ))}
            </div>
          )}
          <SubTotal monthly={calc.expensesTotal} />
        </Collapsible>

        {/* Savings goals */}
        <Collapsible id="sparen" title={TXT.savingsSection} icon={<PiggyBank size={16} style={{ color: C.save }} />} info={TXT.sav} total={eur(calc.savingsTotal)} open={open.sparen} onToggle={toggleSec} style={St.sectionExpenses}>
          {cur.savings.map((s) => {
            const formulaActive = Boolean(s.formula);
            const displayAmount = formulaActive ? String(round2(entryAmount(s, cur))) : s.amount;
            return (
              <div style={St.itemWrap} className="entryWrap" key={s.id}>
                <div className="entry">
                  <span className="e-lead"><span style={{ ...St.dot, background: categoryColor(s.label) }} /></span>
                  <input className="e-desc" aria-label={TXT.category} value={s.label} placeholder={TXT.categoryPlaceholder} onChange={(e) => setListItem("savings", s.id, { label: e.target.value })} style={St.nameInput} />
                  <span className="e-amount"><AmountField value={displayAmount} period={s.period} onValue={(v) => setListItem("savings", s.id, { amount: v })} onPeriod={() => toggleItemPeriod("savings", s.id)} onCommit={(o, n) => logChange(`${TXT.savingsSection} · ${s.label || TXT.unnamed}`, o, n)} disabled={formulaActive} /></span>
                  <span className="entryActions" style={St.rowActions}>
                    <NoteField value={s.note || ""} onChange={(v) => setListItem("savings", s.id, { note: v })} />
                    <LinkField value={s.url || ""} onChange={(v) => setListItem("savings", s.id, { url: v })} />
                    <FormulaField entry={s} monthData={cur} onChange={(patch) => setListItem("savings", s.id, patch)} />
                    <TrendIcon income={false} trend={entryTrend("savings", s.id, monthlyOf(s, cur))} />
                    <SparkIcon history={entryHistory("savings", s.id)} />
                    <CopyField pastMonths={pastMonths} futureMonths={futureMonths} onCopy={(pk, fk) => copyEntryRange("savings", s.id, pk, fk)} />
                    <button type="button" aria-label={TXT.delete} onClick={() => removeListItem("savings", s.id)} style={St.iconBtn}><Trash2 size={16} /></button>
                  </span>
                </div>
                <DerivedLine monthly={monthlyOf(s, cur)} period={s.period} percent={pctOf(monthlyOf(s, cur), calc.savingsTotal)} dot />
              </div>
            );
          })}
          <button type="button" onClick={addSaving} style={St.addBtn}><Plus size={16} /> {TXT.addSaving}</button>
          <SubTotal monthly={calc.savingsTotal} />
        </Collapsible>

        {/* Change log */}
        <Collapsible id="log" title={TXT.logbook} icon={<History size={16} style={{ color: C.muted }} />} total={`${(data.log || []).length}`} open={open.log} onToggle={toggleSec}>
          {(data.log || []).length === 0 ? (
            <div style={St.logEmpty}>{TXT.logEmpty}</div>
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
            {!loaded ? (<><Loader2 size={14} className="spin" /> {TXT.loading}</>) : saved ? (<><Check size={14} style={{ color: C.save }} /> {TXT.saved}</>) : (<><Loader2 size={14} className="spin" /> {TXT.saving}</>) }
          </span>
          <div style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
            <MonthCopyField pastMonths={pastMonths} onCopy={copyMonthToPast} />
            <button type="button" onClick={resetMonth} style={St.resetBtn}><RotateCcw size={14} /> {TXT.restoreThisMonth}</button>
            <a href="https://github.com/x-real-ip/open-family-finance" target="_blank" rel="noopener noreferrer" style={St.githubLink} aria-label={TXT.sourceOnGitHub} title={TXT.sourceOnGitHub}>
              <Github size={16} />
            </a>
          </div>
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
  const rootRef = useRef(null);
  useClickOutside(rootRef, open, () => setOpen(false));
  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}>
      <button type="button" aria-label={TXT.help}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") setOpen(true); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") setOpen(false); }} style={St.infoBtn}>i</button>
      {open && <span style={mobilePopupStyle({ ...St.bubble, ...(align === "right" ? { right: 0 } : { left: 0 }) })} onClick={(e) => e.stopPropagation()}>{text}</span>}
    </span>
  );
}

function PeriodPill({ period, onToggle }) {
  return (
    <button type="button" onClick={onToggle} style={St.periodPill} aria-label={TXT.periodToggle} title={TXT.periodToggle}>
      {period === "year" ? TXT.periodYearAbbr : TXT.periodMonthAbbr}
    </button>
  );
}

function AmountField({ value, period, onValue, onPeriod, onCommit, disabled }) {
  return (
    <div style={St.amountField}>
      <PeriodPill period={period} onToggle={onPeriod} />
      <MoneyInput value={value} onChange={onValue} onCommit={onCommit} disabled={disabled} />
    </div>
  );
}

function DerivedLine({ monthly, period, percent, dot }) {
  const other = period === "year" ? `${eur(monthly)} ${TXT.perMonth}` : `${eur(monthly * 12)} ${TXT.perYear}`;
  return (
    <div style={{ ...St.derived, marginLeft: dot ? 20 : 2 }}>
      = {other}{percent != null ? ` · ${Math.round(percent * 100)}%` : ""}
    </div>
  );
}

function SubTotal({ monthly }) {
  return (
    <div style={St.subTotal}>
      <span>{TXT.total}</span>
      <span style={St.subTotalVal}>{eur(monthly)} <span style={St.subTotalYr}>· {eur(monthly * 12)} {TXT.perYearShort}</span></span>
    </div>
  );
}

function Collapsible({ id, title, icon, info, total, open, onToggle, children, style }) {
  return (
    <section style={{ ...St.section, ...style }} className="fade">
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
        <span style={St.bdYear}>{sign}{eur(value * 12)} {TXT.perYearShort}</span>
      </span>
    </div>
  );
}

function ContribCard({ name, color, soft, amount }) {
  return (
    <div style={{ ...St.contribCard, background: soft }}>
      <div style={{ ...St.contribName, color }}>{name}</div>
      <div style={St.contribAmount}>{eur(amount)}</div>
      <div style={St.contribSub}>{t(LANG, "makesOver", { value: eur0(amount * 12) })}</div>
    </div>
  );
}

function LeftoverCard({ name, color, amount }) {
  return (
    <div style={St.leftoverCard}>
      <div style={St.leftoverTop}><span style={{ ...St.dot, background: color, margin: 0 }} /><span style={St.leftoverName}>{name}</span></div>
      <div style={{ ...St.leftoverAmount, color: amount < 0 ? C.a : C.ink }}>{eur(amount)}</div>
      <div style={St.leftoverYr}>{eur0(amount * 12)} {TXT.perYearShort}</div>
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

function MoneyInput({ value, onChange, onCommit, disabled }) {
  const startRef = useRef(null);
  return (
    <div style={St.money}>
      <span style={St.euro}>€</span>
      <input inputMode="decimal" value={value} placeholder="0"
        onFocus={() => { startRef.current = value; }}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ""))}
        onBlur={() => { if (onCommit && startRef.current !== value) onCommit(startRef.current, value); }}
        style={{ ...St.moneyInput, opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "text" }}
        aria-label={TXT.amount}
        disabled={disabled} />
    </div>
  );
}

function TrendIcon({ trend, income }) {
  const up = trend && trend.dir === "up";     // amount increased vs previous month
  const down = trend && trend.dir === "down"; // amount decreased vs previous month
  let Icon = Minus, color = C.muted, title = TXT.trendNoChange;
  if (up || down) {
    Icon = up ? ArrowUp : ArrowDown;                  // arrow follows the number
    const good = income ? up : down;                  // income: up is good · expenses/savings: down is good
    color = good ? C.save : C.exp;                    // green = good, red = bad
    title = `${up ? TXT.trendHigher : TXT.trendLower} (${eur(trend.prev)} → ${eur(trend.cur)})`;
  }
  return <span style={St.trendIcon} title={title}><Icon size={16} color={color} /></span>;
}

function Sparkline({ data }) {
  const W = 212, H = 56, pad = 6;
  if (!data || data.length < 2) return <div style={St.sparkEmpty}>{TXT.noHistory}</div>;
  const vals = data.map((d) => d.value);
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const x = (i) => pad + (i * (W - 2 * pad)) / (data.length - 1);
  const y = (v) => H - pad - ((v - min) * (H - 2 * pad)) / span;
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const last = data[data.length - 1];
  return (
    <div>
      <svg width={W} height={H} style={{ display: "block" }}>
        <polyline fill="none" stroke={C.b} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={pts} />
        {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.value)} r={i === data.length - 1 ? 3 : 2} fill={i === data.length - 1 ? C.ink : C.b} />)}
      </svg>
      <div style={St.sparkCap}><span>{data[0].label} – {last.label}</span><span style={St.sparkVal}>{eur(last.value)}</span></div>
    </div>
  );
}

function CopyField({ pastMonths, futureMonths, onCopy }) {
  const [open, setOpen] = useState(false);
  const [past, setPast] = useState("");
  const [future, setFuture] = useState("");
  const editingRef = useRef(false);
  const timer = useRef(null);
  const rootRef = useRef(null);
  const has = pastMonths.length || futureMonths.length;
  useClickOutside(rootRef, open, () => setOpen(false));
  const openNow = () => { clearTimeout(timer.current); setOpen(true); };
  const closeSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!editingRef.current) setOpen(false); }, 220); };
  const apply = () => { onCopy(past || null, future || null); setOpen(false); setPast(""); setFuture(""); };
  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }}>
      <button type="button" aria-label={TXT.copyAmountAria} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} style={St.iconBtn}><Copy size={16} /></button>
      {open && (
        <span style={mobilePopupStyle(St.copyPop)} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }} onClick={(e) => e.stopPropagation()}>
          <div style={St.copyTitle}>{TXT.copyAmount}</div>
          {!has ? (
            <div style={St.copyEmpty}>{TXT.noMonthsToCopy}</div>
          ) : (
            <>
              <label style={St.copyRow}>
                <span style={St.copyLbl}>{TXT.copyAmount}</span>
                <select value={past} onChange={(e) => setPast(e.target.value)} onFocus={() => { editingRef.current = true; }} onBlur={() => { editingRef.current = false; }} style={St.copySel} disabled={!pastMonths.length}>
                  <option value="">—</option>
                  {pastMonths.slice().reverse().map((k) => <option key={k} value={k}>{monthLong(k)}</option>)}
                </select>
              </label>
              <label style={St.copyRow}>
                <span style={St.copyLbl}>{TXT.copyMonth}</span>
                <select value={future} onChange={(e) => setFuture(e.target.value)} onFocus={() => { editingRef.current = true; }} onBlur={() => { editingRef.current = false; }} style={St.copySel} disabled={!futureMonths.length}>
                  <option value="">—</option>
                  {futureMonths.map((k) => <option key={k} value={k}>{monthLong(k)}</option>)}
                </select>
              </label>
              <button type="button" onClick={apply} disabled={!past && !future} style={{ ...St.copyApply, opacity: (!past && !future) ? 0.5 : 1 }}>{TXT.copy}</button>
            </>
          )}
        </span>
      )}
    </span>
  );
}

function MonthCopyField({ pastMonths, onCopy }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const editingRef = useRef(false);
  const timer = useRef(null);
  const rootRef = useRef(null);
  const has = pastMonths.length > 0;
  useClickOutside(rootRef, open, () => setOpen(false));
  const openNow = () => { clearTimeout(timer.current); setOpen(true); };
  const closeSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!editingRef.current) setOpen(false); }, 220); };
  const toggleMonth = (key) => {
    setSelected((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };
  const selectAll = () => setSelected(pastMonths.slice());
  const clearAll = () => setSelected([]);
  const apply = () => { if (selected.length) { onCopy(selected); setOpen(false); setSelected([]); } };
  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }}>
      <button type="button" aria-label={TXT.copyMonthAria} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} style={St.iconBtn}><Copy size={16} /></button>
      {open && (
        <span style={mobilePopupStyle({ ...St.copyPop, top: "auto", bottom: "calc(100% + 8px)" })} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }} onClick={(e) => e.stopPropagation()}>
          <div style={St.copyTitle}>{TXT.copyMonth}</div>
          {!has ? (
            <div style={St.copyEmpty}>{TXT.noPrevMonths}</div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                <button type="button" onClick={selectAll} style={{ ...St.copyApply, flex: 1 }}>{TXT.copyAll}</button>
                <button type="button" onClick={clearAll} style={{ ...St.copyApply, background: C.exp, flex: 1 }}>{TXT.copyNone}</button>
              </div>
              <div style={{ maxHeight: 240, overflowY: "auto", marginBottom: 10 }}>
                {pastMonths.slice().reverse().map((k) => (
                  <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <input type="checkbox" checked={selected.includes(k)} onChange={() => toggleMonth(k)} />
                    <span style={{ fontSize: 13 }}>{monthLong(k)}</span>
                  </label>
                ))}
              </div>
              <button type="button" onClick={apply} disabled={!selected.length} style={{ ...St.copyApply, opacity: selected.length ? 1 : 0.5 }}>{TXT.copy}</button>
            </>
          )}
        </span>
      )}
    </span>
  );
}

function SparkIcon({ history }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const rootRef = useRef(null);
  useClickOutside(rootRef, open, () => setOpen(false));
  const has = history && history.length >= 2;
  const openNow = () => { clearTimeout(timer.current); setOpen(true); };
  const closeSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 200); };
  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }}>
      <button type="button" aria-label={TXT.priceTrend} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{ ...St.iconBtn, color: has ? C.b : C.muted }}>
        <LineChartIcon size={16} />
      </button>
      {open && (
        <span style={mobilePopupStyle(St.notePop)} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }} onClick={(e) => e.stopPropagation()}>
          <div style={St.sparkTitle}>{TXT.priceTrend}</div>
          <Sparkline data={history} />
        </span>
      )}
    </span>
  );
}

function LinkField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const editingRef = useRef(false);
  const timer = useRef(null);
  const rootRef = useRef(null);
  useClickOutside(rootRef, open, () => setOpen(false));
  const has = value && value.trim().length > 0;
  const href = has ? (/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`) : null;
  const openNow = () => { clearTimeout(timer.current); setOpen(true); };
  // Note: saving happens live via onChange; closing only hides the popover.
  const closeSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!editingRef.current) setOpen(false); }, 200); };
  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }}>
      <button type="button" aria-label={TXT.link}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{ ...St.iconBtn, color: has ? C.b : C.muted }}>
        <Link2 size={16} />
      </button>
      {open && (
        <span style={mobilePopupStyle(St.notePop)} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }} onClick={(e) => e.stopPropagation()}>
          <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…"
            onFocus={() => { editingRef.current = true; }}
            onBlur={() => { editingRef.current = false; setOpen(false); }}
            style={St.noteInput} aria-label={TXT.link} />
          {href && <a href={href} target="_blank" rel="noopener noreferrer" style={St.noteLink}>{TXT.openLink}</a>}
        </span>
      )}
    </span>
  );
}

function FormulaField({ entry, monthData, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useClickOutside(rootRef, open, () => setOpen(false));
  const [sourceId, setSourceId] = useState(entry.formula?.sourceId || "");
  // ops: sequential operations [{op: 'minus'|'times'|'divide'|'plus', factor: '12'}]
  const [ops, setOps] = useState(() => {
    if (entry.formula?.ops) return entry.formula.ops.map((s) => ({ op: s.op, factor: String(s.factor ?? "0") }));
    if (entry.formula?.op) return [{ op: entry.formula.op, factor: String(entry.formula.factor ?? "0") }];
    return [];
  });
  const editingRef = useRef(false);
  const timer = useRef(null);
  const has = Boolean(entry.formula);
  const openNow = () => { clearTimeout(timer.current); setOpen(true); };
  const closeSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!editingRef.current) setOpen(false); }, 200); };
  const entries = [];
  for (const kind of entryKinds) {
    for (const item of monthData[kind] || []) {
      if (item.id === entry.id) continue;
      const label = kind === "govIncome" ? (item.label || TXT.government)
        : kind === "expenses" ? `${item.category || TXT.expensesSection}${item.label ? ` · ${item.label}` : ""}`
        : kind === "savings" ? (item.label || TXT.savingsSection)
        : item.label || item.id;
      entries.push({ id: item.id, label, kind });
    }
  }
  const selected = entries.find((e) => e.id === sourceId);
  const preview = computeFormulaAmount({ ...entry, formula: { sourceId, ops } }, monthData);
  const onSave = () => {
    if (!sourceId) return;
    onChange({ formula: { sourceId, ops } });
  };
  const onRemove = () => {
    setSourceId(""); setOps([]); onChange({ formula: undefined });
  };
  const updateSource = (value) => { setSourceId(value); setOpen(true); onChange({ formula: { sourceId: value, ops } }); };
  const updateOpAt = (idx, newOp) => { const n = ops.slice(); n[idx] = { ...n[idx], op: newOp }; setOps(n); onChange({ formula: { sourceId, ops: n } }); };
  const updateFactorAt = (idx, newFactor) => { const n = ops.slice(); n[idx] = { ...n[idx], factor: newFactor }; setOps(n); onChange({ formula: { sourceId, ops: n } }); };
  const addOp = () => { const n = [...ops, { op: "minus", factor: "0" }]; setOps(n); onChange({ formula: { sourceId, ops: n } }); };
  const removeOpAt = (idx) => { const n = ops.slice(); n.splice(idx, 1); setOps(n); onChange({ formula: { sourceId, ops: n } }); };
  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }}>
      <button type="button" aria-label={TXT.link} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} style={{ ...St.iconBtn, color: has ? C.b : C.muted }}>
        <Calculator size={16} />
      </button>
      {open && (
        <span style={mobilePopupStyle(St.notePop)} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }} onClick={(e) => e.stopPropagation()}>
          <div style={St.copyTitle}>{TXT.sourceRule}</div>
          <label style={St.copyRow}>
            <span style={St.copyLbl}>{TXT.sourceRule}</span>
            <select value={sourceId} onChange={(e) => updateSource(e.target.value)} onFocus={() => { editingRef.current = true; }} onBlur={() => { editingRef.current = false; }} style={St.copySel}>
              <option value="">— {TXT.selectSource} —</option>
              {entries.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <div style={{ marginBottom: 6 }}>
            <div style={{ marginBottom: 6, fontSize: 13, color: C.muted }}>{TXT.addOperation}</div>
            {ops.map((step, idx) => (
              <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <select value={step.op} onChange={(e) => updateOpAt(idx, e.target.value)} style={St.copySel}>
                  <option value="minus">{TXT.minus || "min"}</option>
                  <option value="plus">{TXT.plus || "plus"}</option>
                  <option value="times">{TXT.times || "keer"}</option>
                  <option value="divide">{TXT.divide || "gedeeld door"}</option>
                </select>
                <input value={step.factor} onChange={(e) => updateFactorAt(idx, e.target.value.replace(/[^0-9.,-]/g, ""))} style={{ ...St.copySel, width: 110 }} inputMode="decimal" />
                <button type="button" onClick={() => removeOpAt(idx)} style={{ ...St.copyApply, background: C.exp }}>{TXT.delete}</button>
              </div>
            ))}
            <button type="button" onClick={addOp} style={{ ...St.copyApply, marginTop: 4 }}>{TXT.addOperation}</button>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: C.muted }}>
            {selected ? `${TXT.sourceLabel}: ${selected.label}` : TXT.selectSource}
          </div>
          <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600 }}>
            {TXT.preview}: {preview != null ? eur(preview) : "—"}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 10 }}>
            <button type="button" onClick={onSave} style={{ ...St.copyApply, opacity: sourceId ? 1 : 0.5 }} disabled={!sourceId}>{TXT.save}</button>
            {has && <button type="button" onClick={onRemove} style={{ ...St.copyApply, background: C.exp }}>{TXT.delete}</button>}
          </div>
        </span>
      )}
    </span>
  );
}

function NoteField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const editingRef = useRef(false);
  const timer = useRef(null);
  const rootRef = useRef(null);
  useClickOutside(rootRef, open, () => setOpen(false));
  const has = value && value.trim().length > 0;
  const openNow = () => { clearTimeout(timer.current); setOpen(true); };
  const closeSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!editingRef.current) setOpen(false); }, 200); };
  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }}>
      <button type="button" aria-label={TXT.note}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{ ...St.iconBtn, color: has ? C.b : C.muted }}>
        <MessageSquare size={16} />
      </button>
      {open && (
        <span style={mobilePopupStyle(St.notePop)} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }} onClick={(e) => e.stopPropagation()}>
          <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3}
            placeholder={TXT.notePlaceholder}
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
  page: { minHeight: "100vh", background: C.canvas, color: C.ink, fontFamily: "'Inter', system-ui, sans-serif", fontFeatureSettings: "'tnum' 1", padding: "24px 20px 56px" },
  shell: { maxWidth: 1120, width: "100%", margin: "0 auto" },

  header: { padding: "8px 4px 16px" },
  headerTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" },
  eyebrow: { fontSize: 12, letterSpacing: "0.14em", color: C.muted, fontWeight: 600 },
  titleRow: { display: "flex", alignItems: "center", gap: 10, marginTop: 6 },
  h1: { fontFamily: "'Inter', system-ui, sans-serif", fontSize: 32, lineHeight: 1.05, margin: 0, fontWeight: 800, letterSpacing: "-0.02em" },
  colTitle: { fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", color: C.ink, margin: "4px 2px 14px" },

  monthNav: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "10px 14px", marginBottom: 14, flexWrap: "wrap" },
  navBtn: { border: "none", background: C.canvas, color: C.ink, cursor: "pointer", width: 38, height: 38, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center" },
  monthLabelWrap: { display: "flex", alignItems: "center", gap: 8, minWidth: 220, flex: "1 1 220px" },
  monthLabel: { fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 17, fontWeight: 700, textTransform: "capitalize" },
  nowTag: { fontSize: 11, fontWeight: 700, color: C.save, background: "#E4F0E9", padding: "2px 7px", borderRadius: 999 },
  monthSelect: { minWidth: 180, flex: "1 1 260px", border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", background: C.canvas, color: C.ink, fontSize: 13, cursor: "pointer", outline: "none" },
  currentBtn: { minWidth: 140, border: "none", background: C.canvas, color: C.ink, cursor: "pointer", borderRadius: 10, padding: "10px 12px", fontSize: 13, fontWeight: 700, boxShadow: "0 1px 2px rgba(0,0,0,0.08)", whiteSpace: "nowrap" },

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
  detailsHeader: { fontSize: 14, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted },
  detailSection: { paddingBottom: 12, marginBottom: 12, borderBottom: `1px solid ${C.line}` },
  detailSubtotal: { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0", paddingTop: 10, borderTop: `1px solid ${C.line}`, fontSize: 13.5, color: C.ink, fontWeight: 600 },
  detailSubtotalLabel: { color: C.muted },
  detailSubtotalValue: { fontVariantNumeric: "tabular-nums", color: C.ink },
  detailResult: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0 0", borderTop: `1px solid ${C.line}`, fontSize: 15, fontWeight: 700, color: C.ink },
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
  sectionIncome: { background: "rgba(46, 125, 82, 0.08)", border: `1px solid rgba(46, 125, 82, 0.18)` },
  sectionExpenses: { background: "rgba(192, 68, 59, 0.08)", border: `1px solid rgba(192, 68, 59, 0.18)` },
  collapseHead: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none", outline: "none" },
  collapseBody: { marginTop: 14 },
  h2: { fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 19, fontWeight: 700, margin: 0, display: "inline-flex", alignItems: "center", gap: 6 },
  headTotal: { fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 16, color: C.ink, fontVariantNumeric: "tabular-nums" },

  itemWrap: { marginBottom: 12 },
  row: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  rowActions: { display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 },
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
  notePop: { position: "absolute", top: "calc(100% + 8px)", right: 0, width: "min(360px, 90vw)", maxWidth: "90vw", boxSizing: "border-box", background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.16)", padding: 12, zIndex: 40 },
  noteArea: { width: "100%", border: "none", outline: "none", resize: "vertical", fontFamily: "inherit", fontSize: 13, lineHeight: 1.45, color: C.ink, background: "transparent" },
  noteInput: { width: "100%", border: "none", outline: "none", fontFamily: "inherit", fontSize: 13, color: C.ink, background: "transparent" },
  noteLink: { display: "inline-block", marginTop: 8, fontSize: 12.5, color: C.b, fontWeight: 600, textDecoration: "none", borderTop: `1px solid ${C.line}`, paddingTop: 7, width: "100%" },
  trendIcon: { width: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  sparkTitle: { fontSize: 12, fontWeight: 700, color: C.muted, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 6 },
  sparkCap: { display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: C.muted },
  sparkVal: { fontVariantNumeric: "tabular-nums", color: C.ink, fontWeight: 600 },
  sparkEmpty: { fontSize: 12.5, color: C.muted, lineHeight: 1.45 },
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

  infoBtn: { width: 18, height: 18, borderRadius: 999, border: `1px solid ${C.line}`, background: C.card, color: C.muted, fontSize: 11, fontWeight: 700, fontStyle: "italic", lineHeight: 1, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, fontFamily: "Georgia, serif" },
  bubble: { position: "absolute", top: "calc(100% + 8px)", width: 230, maxWidth: "70vw", background: C.card, color: C.ink, fontSize: 12.5, lineHeight: 1.45, padding: "10px 12px", borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.18)", zIndex: 30, fontWeight: 400, fontStyle: "normal" },

  footer: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 4px 0", flexWrap: "wrap", gap: 10 },
  themeBtn: { display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid transparent", background: C.card, color: C.ink, padding: "8px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" },
  saveState: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: C.muted },
  resetBtn: { display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "transparent", color: C.muted, fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
  githubLink: { display: "inline-flex", alignItems: "center", justifyContent: "center", color: C.muted, padding: 6, borderRadius: 8 },
  copyPop: { position: "absolute", top: "calc(100% + 8px)", right: 0, width: "min(360px, 90vw)", maxWidth: "90vw", boxSizing: "border-box", background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.16)", padding: 12, zIndex: 50 },
  copyTitle: { fontSize: 12, fontWeight: 700, color: C.muted, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 },
  copyRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 },
  copyLbl: { fontSize: 13, color: C.ink },
  copySel: { maxWidth: 134, fontSize: 13, padding: "5px 6px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.card, color: C.ink, fontFamily: "inherit" },
  copyApply: { width: "100%", border: "none", background: C.b, color: "#fff", fontSize: 13.5, fontWeight: 600, padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", marginTop: 2 },
  copyEmpty: { fontSize: 12.5, color: C.muted, lineHeight: 1.45 },
};

// Global CSS: fonts, input focus states, popovers and the mobile (≤560px) card layout.
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Inter:wght@400;500;600;700&display=swap');
* { box-sizing: border-box; }
.layout { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: start; }
@media (min-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
  .shell { max-width: 960px; }
}
@media (min-width: 1200px) {
  .shell { max-width: 1140px; }
}
input::placeholder { color: #9aa5a1; }
input:focus-visible, button:focus-visible, [role="button"]:focus-visible { outline: 2px solid ${C.b}; outline-offset: 2px; border-radius: 6px; }
.spin { animation: sp 1s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
/* fill-mode "backwards" (niet "both"): een animatie die toegepast blijft op
   transform/opacity maakt van het element permanent een eigen stacking context,
   waardoor popovers (z-index) onder latere secties/kaarten vallen. */
.fade { animation: fade .4s ease backwards; }
@keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.entry { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.entry.exp { gap: 8px; }
.entry .e-lead { display: contents; }
.entry .e-desc { flex: 1; min-width: 90px; }
.entry .e-amount { display: inline-flex; flex-shrink: 0; }
.entry .entryActions { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; }
@media (max-width: 560px) {
  .entryWrap { background: ${C.card}; border: 1px solid ${C.line}; border-radius: 12px; padding: 10px 12px; }
  .entry { display: grid; grid-template-columns: 1fr auto; grid-template-areas: "desc amount" "lead actions"; gap: 8px; align-items: center; }
  .entry .e-desc { grid-area: desc; min-width: 0; font-weight: 700; }
  .entry .e-amount { grid-area: amount; justify-self: end; }
  .entry .e-lead { grid-area: lead; display: flex; align-items: center; gap: 8px; min-width: 0; }
  .entry .entryActions { grid-area: actions; justify-self: end; margin-left: auto; }
  .entryActions button { padding: 5px !important; }
}
@media (prefers-reduced-motion: reduce) { .fade, .spin { animation: none !important; } }
`;
