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
  Calculator, Github, GripVertical, Building2, CalendarClock, AlertTriangle, Percent,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { storage, paperless, PAPERLESS_ENABLED } from "./api";
import { LANG, TXT, t, getRuntimeCurrencyLocale, getRuntimeDateLocale, getRuntimeAppTitle } from "./i18n";

/* ----------------------------------------------------------------
   Design tokens
------------------------------------------------------------------- */
const C = {
  canvas: "var(--canvas)", card: "var(--card)", ink: "var(--ink)", muted: "var(--muted)", line: "var(--line)",
  a: "var(--a)", b: "var(--b)", gov: "var(--gov)", save: "var(--save)", inc: "var(--inc)", exp: "var(--exp)", warn: "var(--warn)", softA: "var(--soft-a)", softB: "var(--soft-b)",
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
  customPct: "50",
  partners: [
    { id: "p1", name: "", income: "", period: "month", note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" },
    { id: "p2", name: "", income: "", period: "month", note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" },
  ],
  govIncome: [],
  expenses: [],
  savings: [],
  // Each partner's own personal fixed costs — kept separate from the shared
  // `expenses` list so one partner filling theirs in doesn't affect the
  // other's or the joint total.
  personalExpensesA: [],
  personalExpensesB: [],
  overrides: {},
};

/* ----------------------------------------------------------------
   Helpers
------------------------------------------------------------------- */
// — numbers & amounts —
const num = (x) => { const v = parseFloat(String(x).replace(",", ".")); return isFinite(v) ? v : 0; };
const round2 = (n) => Math.round(n * 100) / 100;
const clamp01 = (n) => Math.min(1, Math.max(0, n));
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
const entryKinds = ["govIncome", "expenses", "savings", "personalExpensesA", "personalExpensesB"];
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
// Like monthShort, but always includes the year — a savings projection can
// span several years, so every axis tick needs to disambiguate on its own
// rather than relying on the January tick alone.
const monthShortWithYear = (k, locale = getRuntimeDateLocale()) => { const d = keyToDate(k); const m = new Intl.DateTimeFormat(locale, { month: "short" }).format(d); return `${m} '${String(d.getFullYear()).slice(2)}`; };
const dt = (ts, locale = getRuntimeDateLocale()) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(ts));
const fmtDate = (iso, locale = getRuntimeDateLocale()) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${iso}T00:00:00`));

// — contract duration: start/end date, "ending soon" warning and progress —
const CONTRACT_WARNING_DAYS = 30;
const MS_PER_DAY = 86400000;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
// Days from today until `iso` (negative once past); null without an end date.
const daysUntil = (iso) => iso ? Math.round((new Date(`${iso}T00:00:00`) - startOfToday()) / MS_PER_DAY) : null;
// Share of the start–end span already elapsed, clamped to 0–1; null without both dates.
const durationProgress = (startIso, endIso) => {
  if (!startIso || !endIso) return null;
  const start = new Date(`${startIso}T00:00:00`), end = new Date(`${endIso}T00:00:00`);
  if (end <= start) return null;
  return clamp01((startOfToday() - start) / (end - start));
};
// One year after `iso` (used to default a contract's end date once a start
// date is picked). Feb 29 rolls over to Mar 1 in a non-leap target year,
// which is JS Date's normal behavior for setFullYear.
const addOneYear = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

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
  else if (fig.method === "custom") { const pA = clamp01(num(fig.customPct) / 100); baseA = coupleFunds * pA; baseB = coupleFunds * (1 - pA); }
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
    method: f.method || "income", margePct: f.margePct ?? "0.5", customPct: f.customPct ?? "50",
    partners: (f.partners && f.partners.length ? f.partners : clone(DEFAULT_FIGURES.partners)).map((p) => ({ ...p, period: per(p.period), note: p.note || "", url: p.url || "", correspondent: p.correspondent || "", documentMode: p.documentMode || "auto", documentLabel: p.documentLabel || null, documentId: p.documentId ?? null, startDate: p.startDate || "", endDate: p.endDate || "", warningDays: p.warningDays || "" })),
    govIncome: (f.govIncome || []).map((g) => ({ id: g.id || uid(), label: g.label || "", amount: g.amount ?? "", period: per(g.period), note: g.note || "", url: g.url || "", correspondent: g.correspondent || "", documentMode: g.documentMode || "auto", documentLabel: g.documentLabel || null, documentId: g.documentId ?? null, startDate: g.startDate || "", endDate: g.endDate || "", warningDays: g.warningDays || "", formula: g.formula || undefined })),
    expenses: (f.expenses || []).map((e) => ({ id: e.id || uid(), category: e.category || "", label: e.label || "", amount: e.amount ?? "", period: per(e.period), note: e.note || "", url: e.url || "", correspondent: e.correspondent || "", documentMode: e.documentMode || "auto", documentLabel: e.documentLabel || null, documentId: e.documentId ?? null, startDate: e.startDate || "", endDate: e.endDate || "", warningDays: e.warningDays || "", formula: e.formula || undefined })),
    savings: f.savings ? f.savings.map((s) => ({ id: s.id || uid(), label: s.label || "", amount: s.amount ?? "", period: per(s.period), note: s.note || "", url: s.url || "", correspondent: s.correspondent || "", documentMode: s.documentMode || "auto", documentLabel: s.documentLabel || null, documentId: s.documentId ?? null, startDate: s.startDate || "", endDate: s.endDate || "", warningDays: s.warningDays || "", formula: s.formula || undefined }))
      : (f.jointSavings != null ? [{ id: uid(), label: "Sparen", amount: f.jointSavings, period: "month", note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" }] : []),
    personalExpensesA: (f.personalExpensesA || []).map((e) => ({ id: e.id || uid(), category: e.category || "", label: e.label || "", amount: e.amount ?? "", period: per(e.period), note: e.note || "", url: e.url || "", correspondent: e.correspondent || "", documentMode: e.documentMode || "auto", documentLabel: e.documentLabel || null, documentId: e.documentId ?? null, startDate: e.startDate || "", endDate: e.endDate || "", warningDays: e.warningDays || "", formula: e.formula || undefined })),
    personalExpensesB: (f.personalExpensesB || []).map((e) => ({ id: e.id || uid(), category: e.category || "", label: e.label || "", amount: e.amount ?? "", period: per(e.period), note: e.note || "", url: e.url || "", correspondent: e.correspondent || "", documentMode: e.documentMode || "auto", documentLabel: e.documentLabel || null, documentId: e.documentId ?? null, startDate: e.startDate || "", endDate: e.endDate || "", warningDays: e.warningDays || "", formula: e.formula || undefined })),
    overrides: (f.overrides && typeof f.overrides === "object") ? { ...f.overrides } : {},
  };
}
// "manual" = the stored entry order (drag handles reorder it); the other modes derive an order on the fly.
const SORT_MODES = { govIncome: ["manual", "name"], expenses: ["manual", "category", "name"], savings: ["manual", "name"], personalExpensesA: ["manual", "category", "name"], personalExpensesB: ["manual", "category", "name"] };
const DEFAULT_LIST_SORT = { govIncome: "manual", expenses: "manual", savings: "manual", personalExpensesA: "manual", personalExpensesB: "manual" };
function listSortOf(raw) {
  const out = { ...DEFAULT_LIST_SORT };
  for (const kind of Object.keys(DEFAULT_LIST_SORT)) {
    if (raw && SORT_MODES[kind].includes(raw[kind])) out[kind] = raw[kind];
  }
  return out;
}
// Savings goals (Spaaroverzicht): unlike the per-month figures, goals and
// their sub-accounts aren't month-scoped — they persist across time like
// partner names. A sub-account's monthly contribution is never stored here;
// it's read live from the linked savings entry (see monthlyContributionAt),
// so the balance projection always reflects whatever that entry's amount
// currently is, in every month, without duplicating the figure.
// A recorded actual balance for one month ("checkpoint"). Kept as a map of
// month key -> balance rather than a single value, so correcting the balance
// in a later month (e.g. extra money got deposited) doesn't erase an earlier
// month's own recorded value — each month's correction stands on its own,
// in the data and in the graph.
function migrateCheckpoints(o) {
  if (o.checkpoints && typeof o.checkpoints === "object") return { ...o.checkpoints };
  if (o.checkpointMonth) return { [o.checkpointMonth]: o.checkpointBalance ?? "" };
  return {};
}
function migrateSubAccount(s) {
  return {
    id: s.id || uid(), holder: s.holder || "", bank: s.bank || "", iban: s.iban || "",
    planId: s.planId || "", referenceId: s.referenceId || "",
    sharePercent: s.sharePercent ?? "100", interestRate: s.interestRate ?? "",
  };
}
// A goal is derived 1:1 from a monthly savings entry (see
// SavingsOverviewPage) rather than freely created. Older blobs let each
// sub-account link its own entry and gave the goal a free-typed name —
// fold that into a single entryId per goal (best-effort, from whichever
// sub-account had one); goals that never had one don't correspond to
// anything in the current model and are dropped in normalize() below.
function migrateGoal(g) {
  const entryId = g.entryId || (g.subAccounts || []).find((s) => s.entryId)?.entryId || null;
  // The recorded balance briefly lived per sub-account instead of once per
  // goal — recover it from whichever sub-account had one so a balance
  // entered there isn't silently lost.
  const ownCheckpoints = migrateCheckpoints(g);
  const fallbackSub = (g.subAccounts || []).find((s) => s.checkpointMonth || (s.checkpoints && Object.keys(s.checkpoints).length));
  const checkpoints = Object.keys(ownCheckpoints).length ? ownCheckpoints : (fallbackSub ? migrateCheckpoints(fallbackSub) : {});
  return {
    entryId, targetAmount: g.targetAmount ?? "",
    forwarded: g.forwarded ?? Boolean((g.subAccounts || []).length),
    // A single real observation, whether or not the money is split across
    // several bank sub-accounts.
    checkpoints,
    subAccounts: (g.subAccounts || []).map(migrateSubAccount),
  };
}
function freshData() { const mk = monthKey(new Date()); return { selectedMonth: mk, months: { [mk]: clone(DEFAULT_FIGURES) }, log: [], listSort: { ...DEFAULT_LIST_SORT }, savingsGoals: [] }; }
function normalize(raw) {
  if (!raw) return freshData();
  if (raw.months && raw.selectedMonth) {
    const months = {}; for (const [k, v] of Object.entries(raw.months)) months[k] = migrateFig(v);
    // expenseSort: kept for compatibility with blobs saved by an earlier version of this feature.
    const sortSource = raw.listSort || (raw.expenseSort ? { expenses: raw.expenseSort } : null);
    return { selectedMonth: raw.selectedMonth, months, log: raw.log || [], listSort: listSortOf(sortSource), savingsGoals: (raw.savingsGoals || []).map(migrateGoal).filter((g) => g.entryId) };
  }
  if (raw.partners) { const mk = monthKey(new Date()); return { selectedMonth: mk, months: { [mk]: migrateFig(raw) }, log: [], listSort: { ...DEFAULT_LIST_SORT }, savingsGoals: [] }; }
  return freshData();
}
// The monthly contribution a sub-account's linked savings entry has in a
// given month — read from that month's actual figures if it exists yet, or
// from the nearest earlier month otherwise (an unvisited future month always
// behaves as if it inherited the latest known figures, same as forward
// propagation would eventually produce once the user navigates there).
function monthlyContributionAt(months, entryId, key) {
  if (!entryId) return 0;
  const findIn = (fig) => fig?.savings?.find((x) => x.id === entryId);
  if (months[key]) { const e = findIn(months[key]); return e ? monthlyOf(e, months[key]) : 0; }
  const sorted = Object.keys(months).sort();
  const earlier = sorted.filter((k) => k < key);
  // A checkpoint often predates the earliest month the app actually has
  // figures for (e.g. a start balance from months before you started using
  // this app) — fall back to the earliest month available at all rather
  // than silently treating those months as a €0 contribution.
  const refKey = earlier.length ? earlier[earlier.length - 1] : sorted[0];
  if (!refKey) return 0;
  const e = findIn(months[refKey]);
  return e ? monthlyOf(e, months[refKey]) : 0;
}
// Projects a sub-account's balance across `keys` (sorted, ascending month
// keys), starting from its earliest recorded checkpoint. Never recomputes a
// checkpointed month itself — that's the recorded, real balance — and a
// later checkpoint (e.g. a correction after extra money was deposited)
// overrides the running total from that month on without touching any
// earlier month's own recorded value. Once a target amount is reached the
// balance is capped there and stops growing further, mirroring a goal whose
// contributions stop once it's fully funded.
// Returns, per month key, { balance, interest } — interest is the portion of
// that balance built up from the (optional) annual interest rate so far, so
// the overview can show how much is interest versus the holder's own
// contributions (balance - interest). Interest compounds monthly on the
// running balance (nominal annual rate ÷ 12), which is the standard way
// savings accounts quote and apply a rate.
function projectSubAccountSeries(months, entryId, subAccount, keys, target) {
  const out = {};
  const checkpoints = subAccount.checkpoints || {};
  const checkpointKeys = Object.keys(checkpoints).filter((k) => checkpoints[k] !== "" && checkpoints[k] != null).sort();
  if (!checkpointKeys.length) return out;
  // A goal's monthly contribution can be split across several sub-accounts
  // (e.g. different banks) by percentage, rather than each needing its own
  // dedicated savings entry — all sub-accounts under one goal share the same
  // (goal-level) entryId.
  const share = subAccount.sharePercent === "" || subAccount.sharePercent == null ? 1 : num(subAccount.sharePercent) / 100;
  const monthlyRate = subAccount.interestRate ? num(subAccount.interestRate) / 100 / 12 : 0;
  const firstCheckpoint = checkpointKeys[0];
  let principal = num(checkpoints[firstCheckpoint]);
  let interest = 0;
  let k = firstCheckpoint;
  // Once the target is reached, both stop growing — the total can overshoot
  // the target by at most one month's contribution + interest, kept simple
  // on purpose so balance always equals principal + interest exactly.
  let capped = target != null && principal >= target;
  out[k] = { balance: principal + interest, interest };
  for (const key of keys) {
    if (key <= firstCheckpoint) continue;
    while (k < key) {
      k = shiftMonth(k, 1);
      if (checkpoints[k] !== undefined && checkpoints[k] !== "") {
        principal = num(checkpoints[k]);
        interest = 0;
        capped = target != null && principal >= target;
      } else if (!capped) {
        interest += (principal + interest) * monthlyRate;
        principal += monthlyContributionAt(months, entryId, k) * share;
        if (target != null && principal + interest >= target) capped = true;
      }
    }
    out[key] = { balance: principal + interest, interest };
  }
  return out;
}

/* ----------------------------------------------------------------
   App
------------------------------------------------------------------- */
export default function App() {
  const [data, setData] = useState(freshData);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(true);
  const [view, setView] = useState("month");
  const [open, setOpen] = useState({ inkomen: false, overheid: false, uitgaven: false, sparen: false, statsIncome: true, statsTotals: false, log: false, personalA: true, personalB: true });
  const [showDetails, setShowDetails] = useState(true);
  // null = unbounded, so the range always defaults to (and grows with) all available months.
  const [statsFrom, setStatsFrom] = useState(null);
  const [statsTo, setStatsTo] = useState(null);
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("open-family-finance:theme");
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const saveTimer = useRef(null);
  const margeStart = useRef(null);
  const customStart = useRef(null);

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

  const statsSeries = useMemo(() => series.filter((s) => (!statsFrom || s.key >= statsFrom) && (!statsTo || s.key <= statsTo)), [series, statsFrom, statsTo]);
  const statsFiltered = Boolean(statsFrom || statsTo);

  const byCategoryOf = (list) => {
    const map = {};
    for (const e of list) map[e.category || TXT.otherCategory] = (map[e.category || TXT.otherCategory] || 0) + monthlyOf(e, cur);
    return Object.entries(map).sort((x, y) => y[1] - x[1]);
  };
  const byCategory = useMemo(() => byCategoryOf(cur.expenses), [cur]);
  const byCategoryA = useMemo(() => byCategoryOf(cur.personalExpensesA), [cur]);
  const byCategoryB = useMemo(() => byCategoryOf(cur.personalExpensesB), [cur]);

  // "manual" shows the stored entry order as-is (see reorderListItem); the other
  // modes derive a display order on the fly — mutations still address entries by
  // id, so sorting here never touches storage.
  const listSort = data.listSort || DEFAULT_LIST_SORT;
  const setListSort = (kind, mode) => setData((d) => ({ ...d, listSort: { ...(d.listSort || DEFAULT_LIST_SORT), [kind]: mode } }));
  const sortItems = (kind, items) => {
    const mode = listSort[kind];
    if (mode === "manual") return items;
    const key = (item) => (mode === "category" ? item.category || TXT.otherCategory : item.label || TXT.unnamed);
    return items.slice().sort((a, b) => key(a).localeCompare(key(b), undefined, { sensitivity: "base" }) || (a.label || "").localeCompare(b.label || "", undefined, { sensitivity: "base" }));
  };
  const sortedGovIncome = useMemo(() => sortItems("govIncome", cur.govIncome), [cur.govIncome, listSort.govIncome]);
  const sortedExpenses = useMemo(() => sortItems("expenses", cur.expenses), [cur.expenses, listSort.expenses]);
  const sortedSavings = useMemo(() => sortItems("savings", cur.savings), [cur.savings, listSort.savings]);
  const sortedPersonalA = useMemo(() => sortItems("personalExpensesA", cur.personalExpensesA), [cur.personalExpensesA, listSort.personalExpensesA]);
  const sortedPersonalB = useMemo(() => sortItems("personalExpensesB", cur.personalExpensesB), [cur.personalExpensesB, listSort.personalExpensesB]);

  // Contracts (of any kind: income, gov income, expenses, savings) that are
  // expired or about to expire for the selected month, surfaced as a banner
  // at the top of the page so they aren't only visible on hover.
  const contractWarnings = useMemo(() => {
    const entries = [
      ...cur.partners.map((p, i) => ({ ...p, label: p.name || t(LANG, "partnerName", { n: i + 1 }) })),
      ...cur.govIncome.map((g) => ({ ...g, label: g.label || TXT.unnamed })),
      ...cur.expenses.map((e) => ({ ...e, label: e.label || TXT.unnamed })),
      ...cur.savings.map((s) => ({ ...s, label: s.label || TXT.unnamed })),
      ...cur.personalExpensesA.map((e) => ({ ...e, label: `${cur.partners[0].name || t(LANG, "partnerName", { n: 1 })} · ${e.label || TXT.unnamed}` })),
      ...cur.personalExpensesB.map((e) => ({ ...e, label: `${cur.partners[1].name || t(LANG, "partnerName", { n: 2 })} · ${e.label || TXT.unnamed}` })),
    ];
    return entries.map((entry) => {
      const left = daysUntil(entry.endDate);
      if (left == null) return null;
      const warningDays = entry.warningDays ? num(entry.warningDays) : CONTRACT_WARNING_DAYS;
      const expired = left < 0;
      const endingSoon = left >= 0 && left <= warningDays;
      if (!expired && !endingSoon) return null;
      const status = expired ? t(LANG, "contractExpired", { days: Math.abs(left) }) : t(LANG, "contractEndingSoon", { days: left });
      return { id: entry.id, label: entry.label, status, expired };
    }).filter(Boolean).sort((a, b) => (a.expired === b.expired ? 0 : a.expired ? -1 : 1));
  }, [cur]);

  // Drag-and-drop reordering — only available while a section's sort mode is "manual".
  // Reordering changes the entry order for the selected month only; it does not
  // forward-propagate like value edits do, since order isn't a per-entry field.
  const [dragItem, setDragItem] = useState(null);
  const reorderListItem = (kind, dragId, dropId) => setData((d) => {
    const s = d.selectedMonth;
    const list = d.months[s][kind];
    const from = list.findIndex((x) => x.id === dragId), to = list.findIndex((x) => x.id === dropId);
    if (from === -1 || to === -1 || from === to) return d;
    const next = list.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return { ...d, months: { ...d.months, [s]: { ...d.months[s], [kind]: next } } };
  });
  const dragHandleProps = (kind, id) => ({
    draggable: true,
    onDragStart: (e) => { setDragItem({ kind, id }); e.dataTransfer.effectAllowed = "move"; },
    onDragEnd: () => setDragItem(null),
  });
  const dragRowProps = (kind, id) => ({
    onDragOver: (e) => { if (dragItem?.kind === kind && dragItem.id !== id) e.preventDefault(); },
    onDrop: (e) => { if (dragItem?.kind !== kind) return; e.preventDefault(); reorderListItem(kind, dragItem.id, id); setDragItem(null); },
  });

  // Existing category names across all months, for autocomplete suggestions.
  const categories = useMemo(() => {
    const set = new Set();
    for (const m of Object.values(data.months)) {
      for (const kind of ["expenses", "personalExpensesA", "personalExpensesB"]) {
        for (const e of m[kind] || []) if (e.category) set.add(e.category);
      }
    }
    return [...set].sort();
  }, [data.months]);

  // Bank suggestions for savings sub-accounts: every bank name already typed
  // across any goal, so a second account at the same bank doesn't need
  // retyping it — same idea as the category/correspondent datalists.
  const banks = useMemo(() => {
    const set = new Set();
    for (const g of data.savingsGoals || []) for (const s of g.subAccounts) if (s.bank) set.add(s.bank);
    return [...set].sort();
  }, [data.savingsGoals]);

  // Correspondent suggestions: paperless-ngx's list (if the integration is on)
  // plus anything already typed across all months, so the field stays useful
  // even offline or with values paperless doesn't know about.
  const [paperlessCorrespondents, setPaperlessCorrespondents] = useState([]);
  useEffect(() => {
    if (!PAPERLESS_ENABLED) return;
    let active = true;
    paperless.listCorrespondents().then((list) => { if (active) setPaperlessCorrespondents(list); });
    return () => { active = false; };
  }, []);
  const correspondents = useMemo(() => {
    const set = new Set(paperlessCorrespondents.map((c) => c.name));
    for (const m of Object.values(data.months)) {
      for (const kind of ["partners", "govIncome", "expenses", "savings", "personalExpensesA", "personalExpensesB"]) {
        for (const e of m[kind] || []) if (e.correspondent) set.add(e.correspondent);
      }
    }
    return [...set].sort();
  }, [data.months, paperlessCorrespondents]);
  // Best-effort: mirrors a newly typed correspondent into paperless on blur,
  // skipped for names paperless already knows about.
  const syncCorrespondent = (name) => {
    if (!PAPERLESS_ENABLED || !name) return;
    if (paperlessCorrespondents.some((c) => c.name.toLowerCase() === name.toLowerCase())) return;
    paperless.ensureCorrespondent(name).then((created) => {
      if (created) setPaperlessCorrespondents((list) => [...list, created]);
    });
  };

  // Document types + tags, for the per-entry "preferred label" picker.
  const [paperlessLabels, setPaperlessLabels] = useState({ types: [], tags: [] });
  useEffect(() => {
    if (!PAPERLESS_ENABLED) return;
    let active = true;
    paperless.listLabels().then((labels) => { if (active) setPaperlessLabels(labels); });
    return () => { active = false; };
  }, []);

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

  // Copy one entry's value from the selected month to an explicit, individually
  // picked set of past and/or future months. Only that entry's amount (or
  // formula) is changed in months where it already exists; in months where it
  // doesn't exist yet it is added with just the amount/period (and formula, if
  // any) — never with the entry's note, link, correspondent/document, or
  // contract dates, so copying an amount never silently drags contract
  // metadata along for the ride.
  // Note: copying overwrites manual overrides in the target months on purpose —
  // it is an explicit action — but does not mark the targets as overridden.
  const copyEntryRange = (kind, id, pastKeys, futureKeys) => setData((d) => {
    const s = d.selectedMonth;
    const item = (d.months[s][kind] || []).find((x) => x.id === id);
    if (!item) return d;
    const field = kind === "partners" ? "income" : "amount";
    const targets = new Set([...(pastKeys || []), ...(futureKeys || [])]);
    const months = { ...d.months };
    for (const k of targets) {
      if (k === s || !months[k]) continue;
      const list = months[k][kind] || [];
      const exists = list.some((x) => x.id === id);
      if (kind !== "partners" && item.formula) {
        months[k] = { ...months[k], [kind]: exists
          ? list.map((x) => x.id === id ? { ...x, formula: clone(item.formula), period: item.period } : x)
          : [...list, clone(item)] };
      } else if (exists) {
        months[k] = { ...months[k], [kind]: list.map((x) => x.id === id ? { ...x, [field]: item[field], period: item.period } : x) };
      } else {
        const bare = { ...clone(item), note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" };
        months[k] = { ...months[k], [kind]: [...list, bare] };
      }
    }
    return { ...d, months };
  });

  // Copy the whole selected month's figures (method, marge, partners, gov
  // income, expenses, savings) onto an explicit set of other months — past or
  // future. This overwrites those months entirely, so — like resetMonth — it
  // asks for confirmation first. Each target month keeps its own `overrides`
  // bookkeeping rather than inheriting the source month's, since that map
  // describes what was manually changed in that specific month, not in the
  // one it was copied from.
  const copyMonth = (targetKeys) => {
    if (!targetKeys?.length) return;
    if (!window.confirm(t(LANG, "confirmCopyMonth", { month: monthLong(sel), count: targetKeys.length }))) return;
    setData((d) => {
      const s = d.selectedMonth;
      const source = d.months[s];
      if (!source) return d;
      const months = { ...d.months };
      for (const k of targetKeys) {
        if (k === s || !months[k]) continue;
        const { overrides, ...rest } = clone(source);
        months[k] = { ...rest, overrides: months[k].overrides || {} };
      }
      return { ...d, months };
    });
  };

  const togglePartnerPeriod = (i) => {
    const key = cur.partners[i]?.id || `p${i + 1}`;
    editForward((f) => ({ ...f, partners: f.partners.map((p, idx) => idx === i ? { ...p, period: p.period === "year" ? "month" : "year", income: flip(p.income, p.period) } : p) }), key);
  };
  const setMethod = (method) => editForward((f) => ({ ...f, method }), "__method");
  const setMarge = (margePct) => editForward((f) => ({ ...f, margePct }), "__marge");
  const setCustomPct = (customPct) => editForward((f) => ({ ...f, customPct }), "__customPct");
  // Not cloned: patch is always a fresh object from the caller, and JSON-cloning would
  // silently drop keys explicitly set to `undefined` (e.g. clearing a formula), since
  // JSON.stringify omits undefined values instead of preserving them.
  const setListItem = (k, id, patch) => editForward((f) => ({ ...f, [k]: f[k].map((x) => x.id === id ? { ...x, ...patch } : x) }), id);
  const toggleItemPeriod = (k, id) => editForward((f) => ({ ...f, [k]: f[k].map((x) => x.id === id ? { ...x, period: x.period === "year" ? "month" : "year", amount: flip(x.amount, x.period) } : x) }), id);
  const removeListItem = (k, id) => editForward((f) => ({ ...f, [k]: f[k].filter((x) => x.id !== id) }), id);
  const addListItem = (kind, item) => editForward((f) => (
    (f[kind] || []).some((x) => x.id === item.id) ? f : { ...f, [kind]: [...(f[kind] || []), clone(item)] }
  ), item.id);
  const addGov = () => addListItem("govIncome", { id: uid(), label: "", amount: "", period: "month", note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" });
  const addExpense = () => addListItem("expenses", { id: uid(), category: "", label: "", amount: "", period: "month", note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" });
  const addSaving = () => addListItem("savings", { id: uid(), label: "", amount: "", period: "month", note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" });
  const addPersonalExpense = (which) => addListItem(`personalExpenses${which}`, { id: uid(), category: "", label: "", amount: "", period: "month", note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" });

  // Savings goals aren't month-scoped, so they're mutated directly rather
  // than through editForward/forward-propagation.
  // Goals are keyed by the monthly savings entry they belong to (see
  // SavingsOverviewPage) rather than freely created, so there's no separate
  // "add goal" step — a goal record is created on first use (setting the
  // "forwarded" flag or adding a sub-account) and simply doesn't exist until
  // then; SavingsOverviewPage falls back to sensible defaults meanwhile.
  const mapGoals = (d, entryId, fn) => {
    const goals = d.savingsGoals || [];
    if (goals.some((g) => g.entryId === entryId)) return goals.map((g) => g.entryId === entryId ? fn(g) : g);
    return [...goals, fn({ entryId, targetAmount: "", forwarded: false, checkpoints: {}, subAccounts: [] })];
  };
  const updateGoal = (entryId, patch) => setData((d) => ({ ...d, savingsGoals: mapGoals(d, entryId, (g) => ({ ...g, ...patch })) }));
  const addSubAccount = (entryId) => setData((d) => ({ ...d, savingsGoals: mapGoals(d, entryId, (g) => ({ ...g, forwarded: true, subAccounts: [...g.subAccounts, { id: uid(), holder: "", bank: "", iban: "", planId: "", referenceId: "", sharePercent: "100", interestRate: "" }] })) }));
  const removeSubAccount = (entryId, subId) => setData((d) => ({ ...d, savingsGoals: (d.savingsGoals || []).map((g) => g.entryId === entryId ? { ...g, subAccounts: g.subAccounts.filter((s) => s.id !== subId) } : g) }));
  const updateSubAccount = (entryId, subId, patch) => setData((d) => ({ ...d, savingsGoals: (d.savingsGoals || []).map((g) => g.entryId === entryId ? { ...g, subAccounts: g.subAccounts.map((s) => s.id === subId ? { ...s, ...patch } : s) } : g) }));
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

  // Shared by the joint "Vaste lasten" section and each partner's personal
  // page — same fields, same behavior (sorting, drag reorder, formulas,
  // correspondent/paperless, trend/sparkline, per-entry copy-forward), just
  // scoped to a different list (`kind`) and its own subtotal/category split.
  const renderExpensesList = (kind, items, total, byCat, onAdd, logPrefix = TXT.expensesSection) => {
    const manual = listSort[kind] === "manual";
    return (
      <>
        {items.length > 1 && <SortToggle kind={kind} mode={listSort[kind]} onChange={(m) => setListSort(kind, m)} />}
        {items.map((e) => {
          const formulaActive = Boolean(e.formula);
          const displayAmount = formulaActive ? String(round2(entryAmount(e, cur))) : e.amount;
          return (
            <div style={{ ...St.itemWrap, ...(manual && dragItem?.kind === kind && dragItem.id === e.id ? { opacity: 0.4 } : {}) }} className="entryWrap" key={e.id} {...(manual ? dragRowProps(kind, e.id) : {})}>
              <div className="entry exp">
                <span className="e-lead">
                  <DragHandle active={manual} {...dragHandleProps(kind, e.id)} />
                  <span style={{ ...St.catDot, background: categoryColor(e.category) }} title={e.category || TXT.otherCategory} />
                  <input list="cats" aria-label={TXT.category} value={e.category} placeholder={TXT.categoryPlaceholder} onChange={(ev) => setListItem(kind, e.id, { category: ev.target.value })} style={St.catInput} />
                </span>
                <input className="e-desc" aria-label={TXT.description} value={e.label} placeholder={TXT.descriptionPlaceholder} onChange={(ev) => setListItem(kind, e.id, { label: ev.target.value })} style={St.nameInput} />
                <span className="e-amount"><AmountField value={displayAmount} period={e.period} onValue={(v) => setListItem(kind, e.id, { amount: v })} onPeriod={() => toggleItemPeriod(kind, e.id)} onCommit={(o, n) => logChange(`${logPrefix} · ${e.label || TXT.unnamed}`, o, n)} disabled={formulaActive} /></span>
                <span className="entryActions" style={St.rowActions}>
                  <NoteField value={e.note || ""} onChange={(v) => setListItem(kind, e.id, { note: v })} />
                  <LinkField value={e.url || ""} onChange={(v) => setListItem(kind, e.id, { url: v })} />
                  <CorrespondentField entry={e} onChange={(patch) => setListItem(kind, e.id, patch)} onSync={syncCorrespondent} correspondents={paperlessCorrespondents} labels={paperlessLabels} />
                  <DurationField entry={e} onChange={(patch) => setListItem(kind, e.id, patch)} />
                  <FormulaField entry={e} monthData={cur} onChange={(patch) => setListItem(kind, e.id, patch)} />
                  <TrendIcon income={false} trend={entryTrend(kind, e.id, monthlyOf(e, cur))} />
                  <SparkIcon history={entryHistory(kind, e.id)} />
                  <CopyField pastMonths={pastMonths} futureMonths={futureMonths} onCopy={(pk, fk) => copyEntryRange(kind, e.id, pk, fk)} />
                  <button type="button" aria-label={TXT.delete} onClick={() => removeListItem(kind, e.id)} style={St.iconBtn}><Trash2 size={16} /></button>
                </span>
              </div>
              <DerivedLine monthly={monthlyOf(e, cur)} period={e.period} percent={pctOf(monthlyOf(e, cur), total)} correspondent={e.correspondent} />
            </div>
          );
        })}
        <button type="button" onClick={onAdd} style={St.addBtn}><Plus size={16} /> {TXT.addExpense}</button>
        {byCat.length > 0 && (
          <div style={St.catSummary}>
            <div style={St.catSummaryTitle}>{TXT.perCategory}</div>
            <div style={St.pieBox}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byCat.map(([cat, val]) => ({ name: cat, value: val }))} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="90%" paddingAngle={2}>
                    {byCat.map(([cat]) => <Cell key={cat} fill={categoryColor(cat === TXT.otherCategory ? "" : cat)} />)}
                  </Pie>
                  <Tooltip {...tooltipProps} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {byCat.map(([cat, val]) => (
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
        <SubTotal monthly={total} />
      </>
    );
  };

  // ── Render ──
  return (
    <div style={St.page}>
      <style>{CSS}</style>
      <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      {PAPERLESS_ENABLED && <datalist id="correspondents">{correspondents.map((c) => <option key={c} value={c} />)}</datalist>}
      <datalist id="banks">{banks.map((b) => <option key={b} value={b} />)}</datalist>

      <div style={St.shell} className="shell">
        {contractWarnings.length > 0 && (
          <div style={St.warnBanner} className="fade" role="alert">
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={St.warnBannerBody}>
              {contractWarnings.map((w) => (
                <div key={w.id} style={St.warnBannerRow}>
                  <span style={St.warnBannerLabel}>{w.label}</span>
                  <span style={{ color: w.expired ? C.exp : C.warn }}>{w.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <header style={St.header}>
          <div style={St.headerTop}>
            <h1 style={St.h1}>{APP_TITLE}</h1>
            <button type="button" onClick={toggleTheme} style={St.themeBtn} aria-label={t(LANG, "themeToggle", { theme: theme === "dark" ? TXT.themeLight : TXT.themeDark })}>
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} {theme === "dark" ? TXT.themeLight : TXT.themeDark}
            </button>
          </div>
          <div style={{ ...St.toggle, marginTop: 10 }} role="group" aria-label={TXT.viewToggleAria}>
            <button type="button" onClick={() => setView("month")} style={{ ...St.toggleBtn, ...(view === "month" ? St.toggleOn : {}) }}>{TXT.monthView}</button>
            <button type="button" onClick={() => setView("savings")} style={{ ...St.toggleBtn, ...(view === "savings" ? St.toggleOn : {}) }}>{TXT.savingsOverviewView}</button>
            <button type="button" onClick={() => setView("personalA")} style={{ ...St.toggleBtn, ...(view === "personalA" ? St.toggleOn : {}) }}>{nameA}</button>
            <button type="button" onClick={() => setView("personalB")} style={{ ...St.toggleBtn, ...(view === "personalB" ? St.toggleOn : {}) }}>{nameB}</button>
          </div>
        </header>

        {/* Month — shared by both views: the savings overview edits each
            linked entry's amount for whichever month is selected here, the
            same way the monthly view does. */}
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

        {view === "savings" ? (
          <SavingsOverviewPage
            savingsGoals={data.savingsGoals || []}
            months={data.months}
            savingsEntries={cur.savings}
            currentMonthData={cur}
            sel={sel}
            onUpdateGoal={updateGoal}
            onAddSubAccount={addSubAccount}
            onRemoveSubAccount={removeSubAccount}
            onUpdateSubAccount={updateSubAccount}
          />
        ) : view === "personalA" ? (
          <div className="fade">
            <ColTitle>{nameA}</ColTitle>
            <div style={St.correspondentDocMuted}>{TXT.personalPageHint}</div>
            <Collapsible id="personalA" title={TXT.fixedCosts} icon={<Receipt size={16} style={{ color: C.exp }} />} info={TXT.exp} total={eur(sumM(cur.personalExpensesA, cur))} open={open.personalA} onToggle={toggleSec} style={St.sectionExpenses}>
              {renderExpensesList("personalExpensesA", sortedPersonalA, sumM(cur.personalExpensesA, cur), byCategoryA, () => addPersonalExpense("A"), nameA)}
            </Collapsible>
          </div>
        ) : view === "personalB" ? (
          <div className="fade">
            <ColTitle>{nameB}</ColTitle>
            <div style={St.correspondentDocMuted}>{TXT.personalPageHint}</div>
            <Collapsible id="personalB" title={TXT.fixedCosts} icon={<Receipt size={16} style={{ color: C.exp }} />} info={TXT.exp} total={eur(sumM(cur.personalExpensesB, cur))} open={open.personalB} onToggle={toggleSec} style={St.sectionExpenses}>
              {renderExpensesList("personalExpensesB", sortedPersonalB, sumM(cur.personalExpensesB, cur), byCategoryB, () => addPersonalExpense("B"), nameB)}
            </Collapsible>
          </div>
        ) : (
        <>
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
                  <CorrespondentField entry={p} onChange={(patch) => setPartner(i, patch)} onSync={syncCorrespondent} correspondents={paperlessCorrespondents} labels={paperlessLabels} />
                  <DurationField entry={p} onChange={(patch) => setPartner(i, patch)} />
                  <TrendIcon income trend={entryTrend("partners", p.id, monthlyInc(p))} />
                  <SparkIcon history={entryHistory("partners", p.id)} />
                  <CopyField pastMonths={pastMonths} futureMonths={futureMonths} onCopy={(pk, fk) => copyEntryRange("partners", p.id, pk, fk)} />
                </span>
              </div>
              <DerivedLine monthly={monthlyInc(p)} period={p.period} percent={pctOf(monthlyInc(p), calc.total)} correspondent={p.correspondent} dot />
            </div>
          ))}
          <SubTotal monthly={calc.total} />
        </Collapsible>

        {/* Government */}
        <Collapsible id="overheid" title={TXT.government} icon={<Landmark size={16} style={{ color: C.gov }} />} info={TXT.gov} total={eur(calc.govTotal)} open={open.overheid} onToggle={toggleSec} style={St.sectionIncome}>
          {cur.govIncome.length > 1 && <SortToggle kind="govIncome" mode={listSort.govIncome} onChange={(m) => setListSort("govIncome", m)} />}
          {sortedGovIncome.map((g) => {
            const formulaActive = Boolean(g.formula);
            const displayAmount = formulaActive ? String(round2(entryAmount(g, cur))) : g.amount;
            const manual = listSort.govIncome === "manual";
            return (
              <div style={{ ...St.itemWrap, ...(manual && dragItem?.kind === "govIncome" && dragItem.id === g.id ? { opacity: 0.4 } : {}) }} className="entryWrap" key={g.id} {...(manual ? dragRowProps("govIncome", g.id) : {})}>
                <div className="entry">
                  <span className="e-lead">
                    <DragHandle active={manual} {...dragHandleProps("govIncome", g.id)} />
                    <span style={{ ...St.dot, background: C.gov }} />
                  </span>
                  <input className="e-desc" aria-label={TXT.description} value={g.label} placeholder={TXT.descriptionPlaceholder} onChange={(e) => setListItem("govIncome", g.id, { label: e.target.value })} style={St.nameInput} />
                  <span className="e-amount"><AmountField value={displayAmount} period={g.period} onValue={(v) => setListItem("govIncome", g.id, { amount: v })} onPeriod={() => toggleItemPeriod("govIncome", g.id)} onCommit={(o, n) => logChange(`${TXT.government} · ${g.label || TXT.government}`, o, n)} disabled={formulaActive} /></span>
                  <span className="entryActions" style={St.rowActions}>
                    <NoteField value={g.note || ""} onChange={(v) => setListItem("govIncome", g.id, { note: v })} />
                    <LinkField value={g.url || ""} onChange={(v) => setListItem("govIncome", g.id, { url: v })} />
                    <CorrespondentField entry={g} onChange={(patch) => setListItem("govIncome", g.id, patch)} onSync={syncCorrespondent} correspondents={paperlessCorrespondents} labels={paperlessLabels} />
                    <DurationField entry={g} onChange={(patch) => setListItem("govIncome", g.id, patch)} />
                    <FormulaField entry={g} monthData={cur} onChange={(patch) => setListItem("govIncome", g.id, patch)} />
                    <TrendIcon income trend={entryTrend("govIncome", g.id, monthlyOf(g, cur))} />
                    <SparkIcon history={entryHistory("govIncome", g.id)} />
                    <CopyField pastMonths={pastMonths} futureMonths={futureMonths} onCopy={(pk, fk) => copyEntryRange("govIncome", g.id, pk, fk)} />
                    <button type="button" aria-label={TXT.delete} onClick={() => removeListItem("govIncome", g.id)} style={St.iconBtn}><Trash2 size={16} /></button>
                  </span>
                </div>
                <DerivedLine monthly={monthlyOf(g, cur)} period={g.period} percent={pctOf(monthlyOf(g, cur), calc.govTotal)} correspondent={g.correspondent} dot />
              </div>
            );
          })}
          <button type="button" onClick={addGov} style={St.addBtn}><Plus size={16} /> {TXT.addGovernment}</button>
          <SubTotal monthly={calc.govTotal} />
        </Collapsible>

        <ColTitle>{TXT.allocationSection}</ColTitle>
        {/* Distribution (result) — full width */}
        <section style={St.hero} className="fade">
          <div style={St.methodRow}>
            <span style={St.methodLabel}>{TXT.distributionMethod}</span>
            <div style={St.toggle} role="group" aria-label={TXT.distributionMethod}>
              <button type="button" onClick={() => setMethod("income")} style={{ ...St.toggleBtn, ...(cur.method === "income" ? St.toggleOn : {}) }}>{TXT.incomeMethod}</button>
              <button type="button" onClick={() => setMethod("equal")} style={{ ...St.toggleBtn, ...(cur.method === "equal" ? St.toggleOn : {}) }}>{TXT.equalMethod}</button>
              <button type="button" onClick={() => setMethod("custom")} style={{ ...St.toggleBtn, ...(cur.method === "custom" ? St.toggleOn : {}) }}>{TXT.customMethod}</button>
            </div>
          </div>

          {cur.method === "custom" && (
            <div style={St.customRow}>
              <span style={St.customName}>{nameA}</span>
              <div style={St.money}>
                <input inputMode="decimal" value={cur.customPct}
                  onFocus={() => { customStart.current = cur.customPct; }}
                  onChange={(e) => setCustomPct(e.target.value.replace(/[^0-9.,]/g, ""))}
                  onBlur={() => { if (customStart.current !== cur.customPct) logChange(TXT.customPctLabel, customStart.current, cur.customPct); }}
                  style={{ ...St.moneyInput, width: 44 }} aria-label={t(LANG, "customPctAria", { name: nameA })} />
                <span style={St.euro}>%</span>
              </div>
              <span style={St.customName}>{nameB}: {pct(1 - clamp01(num(cur.customPct) / 100))}</span>
            </div>
          )}

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
              <InfoDot text={cur.method === "equal" ? TXT.fairEqual : cur.method === "custom" ? TXT.fairCustom : TXT.fair} align="right" />
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

        <ColTitle>{TXT.expensesSection}</ColTitle>
        {/* Expenses */}
        <Collapsible id="uitgaven" title={TXT.fixedCosts} icon={<Receipt size={16} style={{ color: C.exp }} />} info={TXT.exp} total={eur(calc.expensesTotal)} open={open.uitgaven} onToggle={toggleSec} style={St.sectionExpenses}>
          {renderExpensesList("expenses", sortedExpenses, calc.expensesTotal, byCategory, addExpense)}
        </Collapsible>

        {/* Savings goals */}
        <Collapsible id="sparen" title={TXT.savingsSection} icon={<PiggyBank size={16} style={{ color: C.save }} />} info={TXT.sav} total={eur(calc.savingsTotal)} open={open.sparen} onToggle={toggleSec} style={St.sectionExpenses}>
          {cur.savings.length > 1 && <SortToggle kind="savings" mode={listSort.savings} onChange={(m) => setListSort("savings", m)} />}
          {sortedSavings.map((s) => {
            const formulaActive = Boolean(s.formula);
            const displayAmount = formulaActive ? String(round2(entryAmount(s, cur))) : s.amount;
            const manual = listSort.savings === "manual";
            return (
              <div style={{ ...St.itemWrap, ...(manual && dragItem?.kind === "savings" && dragItem.id === s.id ? { opacity: 0.4 } : {}) }} className="entryWrap" key={s.id} {...(manual ? dragRowProps("savings", s.id) : {})}>
                <div className="entry">
                  <span className="e-lead">
                    <DragHandle active={manual} {...dragHandleProps("savings", s.id)} />
                    <span style={{ ...St.dot, background: categoryColor(s.label) }} />
                  </span>
                  <input className="e-desc" aria-label={TXT.category} value={s.label} placeholder={TXT.categoryPlaceholder} onChange={(e) => setListItem("savings", s.id, { label: e.target.value })} style={St.nameInput} />
                  <span className="e-amount"><AmountField value={displayAmount} period={s.period} onValue={(v) => setListItem("savings", s.id, { amount: v })} onPeriod={() => toggleItemPeriod("savings", s.id)} onCommit={(o, n) => logChange(`${TXT.savingsSection} · ${s.label || TXT.unnamed}`, o, n)} disabled={formulaActive} /></span>
                  <span className="entryActions" style={St.rowActions}>
                    <NoteField value={s.note || ""} onChange={(v) => setListItem("savings", s.id, { note: v })} />
                    <LinkField value={s.url || ""} onChange={(v) => setListItem("savings", s.id, { url: v })} />
                    <CorrespondentField entry={s} onChange={(patch) => setListItem("savings", s.id, patch)} onSync={syncCorrespondent} correspondents={paperlessCorrespondents} labels={paperlessLabels} />
                    <DurationField entry={s} onChange={(patch) => setListItem("savings", s.id, patch)} />
                    <FormulaField entry={s} monthData={cur} onChange={(patch) => setListItem("savings", s.id, patch)} />
                    <TrendIcon income={false} trend={entryTrend("savings", s.id, monthlyOf(s, cur))} />
                    <SparkIcon history={entryHistory("savings", s.id)} />
                    <CopyField pastMonths={pastMonths} futureMonths={futureMonths} onCopy={(pk, fk) => copyEntryRange("savings", s.id, pk, fk)} />
                    <button type="button" aria-label={TXT.delete} onClick={() => removeListItem("savings", s.id)} style={St.iconBtn}><Trash2 size={16} /></button>
                  </span>
                </div>
                <DerivedLine monthly={monthlyOf(s, cur)} period={s.period} percent={pctOf(monthlyOf(s, cur), calc.savingsTotal)} correspondent={s.correspondent} dot />
              </div>
            );
          })}
          <button type="button" onClick={addSaving} style={St.addBtn}><Plus size={16} /> {TXT.addSaving}</button>
          <SubTotal monthly={calc.savingsTotal} />
        </Collapsible>

        {/* Statistics */}
        <div style={St.savingsPageHead}>
          <ColTitle>{TXT.statistics}</ColTitle>
          <span style={St.headTotal}>{t(LANG, "months", { count: sortedMonths.length })}</span>
        </div>
        {sortedMonths.length >= 2 && (
          <div style={St.statsPeriodRow}>
            <span style={St.sortLabel}>{TXT.statsPeriod}</span>
            <select
              value={statsFrom || sortedMonths[0]}
              onChange={(e) => { const v = e.target.value; setStatsFrom(v === sortedMonths[0] ? null : v); if (v > (statsTo || sortedMonths[sortedMonths.length - 1])) setStatsTo(null); }}
              style={St.copySel} aria-label={TXT.statsPeriodFrom}>
              {sortedMonths.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
            <span style={St.sortLabel}>–</span>
            <select
              value={statsTo || sortedMonths[sortedMonths.length - 1]}
              onChange={(e) => { const v = e.target.value; setStatsTo(v === sortedMonths[sortedMonths.length - 1] ? null : v); if (v < (statsFrom || sortedMonths[0])) setStatsFrom(null); }}
              style={St.copySel} aria-label={TXT.statsPeriodTo}>
              {sortedMonths.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
            {statsFiltered && (
              <button type="button" onClick={() => { setStatsFrom(null); setStatsTo(null); }} style={St.resetBtn}><RotateCcw size={13} /> {TXT.statsPeriodReset}</button>
            )}
          </div>
        )}
        {statsSeries.length < 2 ? (
          <div style={St.emptyHist}>
            <TrendingUp size={18} style={{ color: C.muted }} />
            <span>{TXT.noSeries}</span>
          </div>
        ) : (
          <>
            <Collapsible id="statsIncome" title={TXT.incomePerMonth} open={open.statsIncome} onToggle={toggleSec}>
              <div style={St.chartBox}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statsSeries} margin={{ top: 6, right: 4, left: -6, bottom: 0 }}>
                    <CartesianGrid stroke={C.line} vertical={false} />
                    <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
                    <YAxis tick={tick} axisLine={false} tickLine={false} width={58} tickFormatter={eur0} />
                    <Tooltip {...tooltipProps} /><Legend {...legendProps} />
                    <Bar dataKey="inlegA" name={nameA} fill={C.a} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="inlegB" name={nameB} fill={C.b} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Collapsible>
            <Collapsible id="statsTotals" title={TXT.monthTotals} open={open.statsTotals} onToggle={toggleSec}>
              <div style={St.chartBox}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statsSeries} margin={{ top: 6, right: 8, left: -6, bottom: 0 }}>
                    <CartesianGrid stroke={C.line} vertical={false} />
                    <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
                    <YAxis tick={tick} axisLine={false} tickLine={false} width={58} tickFormatter={eur0} />
                    <Tooltip {...tooltipProps} /><Legend {...legendProps} />
                    <Bar dataKey="income" name={TXT.incomes} fill={C.inc} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="gov" name={TXT.government} fill={C.gov} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" name={TXT.expenses} fill={C.exp} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="savings" name={TXT.savings} fill={C.save} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Collapsible>
          </>
        )}

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
        </>
        )}

        <footer style={St.footer}>
          <span style={St.saveState}>
            {!loaded ? (<><Loader2 size={14} className="spin" /> {TXT.loading}</>) : saved ? (<><Check size={14} style={{ color: C.save }} /> {TXT.saved}</>) : (<><Loader2 size={14} className="spin" /> {TXT.saving}</>) }
          </span>
          <div style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
            {view === "month" && <MonthCopyField pastMonths={pastMonths} futureMonths={futureMonths} onCopy={copyMonth} />}
            {view === "month" && <button type="button" onClick={resetMonth} style={St.resetBtn}><RotateCcw size={14} /> {TXT.restoreThisMonth}</button>}
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

// Shows the correspondent inline (when set) so it's visible at a glance, just
// like the description — instead of only being visible after opening the
// correspondent popover.
function DerivedLine({ monthly, period, percent, dot, correspondent }) {
  const other = period === "year" ? `${eur(monthly)} ${TXT.perMonth}` : `${eur(monthly * 12)} ${TXT.perYear}`;
  return (
    <div style={{ ...St.derived, marginLeft: dot ? 20 : 2 }}>
      = {other}{percent != null ? ` · ${Math.round(percent * 100)}%` : ""}{PAPERLESS_ENABLED && correspondent ? ` · ${correspondent}` : ""}
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

const SORT_LABELS = { manual: "sortManual", category: "sortByCategory", name: "sortByName" };
function SortToggle({ kind, mode, onChange }) {
  return (
    <div style={St.sortRow}>
      <span style={St.sortLabel}>{TXT.sortBy}</span>
      <div style={St.toggle} role="group" aria-label={TXT.sortBy}>
        {SORT_MODES[kind].map((m) => (
          <button key={m} type="button" onClick={() => onChange(m)} style={{ ...St.toggleBtn, ...(mode === m ? St.toggleOn : {}) }}>{TXT[SORT_LABELS[m]]}</button>
        ))}
      </div>
    </div>
  );
}

function DragHandle({ active, ...dragProps }) {
  if (!active) return null;
  return <span {...dragProps} style={St.dragHandle} aria-label={TXT.dragHandle} title={TXT.dragHandle}><GripVertical size={14} /></span>;
}

// Correspondent editing is hidden behind an icon like Note/Link so entries
// that don't need one don't carry a permanently visible input — but once set,
// the name itself is shown directly on DerivedLine (below), so you don't have
// to reopen this popover just to see who it is. Free-text with paperless-ngx
// suggestions (see the #correspondents datalist); when the typed value
// matches a known paperless correspondent, also looks up (and links to) the
// most recent document paperless has for it. Renders nothing
// when the integration is off, per PAPERLESS_ENABLED.
function CorrespondentField({ entry, onChange, onSync, correspondents, labels }) {
  const [open, setOpen] = useState(false);
  const editingRef = useRef(false);
  const timer = useRef(null);
  const rootRef = useRef(null);
  const [doc, setDoc] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docKey, setDocKey] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  useClickOutside(rootRef, open, () => setOpen(false));

  const value = entry.correspondent || "";
  const mode = entry.documentMode || "auto";
  const has = value.trim().length > 0;
  const match = has ? correspondents.find((c) => c.name.toLowerCase() === value.trim().toLowerCase()) : null;

  // Auto mode: (re)fetch whenever the popover opens, the correspondent
  // resolves, or the entry's preferred label changes.
  useEffect(() => {
    if (!open || mode !== "auto" || !match) return;
    const key = `auto:${match.id}:${entry.documentLabel?.kind || ""}:${entry.documentLabel?.id || ""}`;
    if (docKey === key) return;
    setDocLoading(true);
    paperless.latestDocument(match.id, entry.documentLabel).then((d) => { setDoc(d); setDocKey(key); setDocLoading(false); });
  }, [open, mode, match?.id, entry.documentLabel?.kind, entry.documentLabel?.id]);

  // Manual mode: fetch the pinned document's details whenever it's open and the pin changes.
  useEffect(() => {
    if (!open || mode !== "manual" || !entry.documentId) return;
    const key = `manual:${entry.documentId}`;
    if (docKey === key) return;
    setDocLoading(true);
    paperless.getDocument(entry.documentId).then((d) => { setDoc(d); setDocKey(key); setDocLoading(false); });
  }, [open, mode, entry.documentId]);

  const runSearch = (q) => {
    setQuery(q);
    if (!match || !q.trim()) { setResults([]); return; }
    setSearching(true);
    paperless.searchDocuments(match.id, q.trim()).then((r) => { setResults(r); setSearching(false); });
  };
  const pickDocument = (id) => { onChange({ documentId: id }); setResults([]); setQuery(""); setDocKey(null); };
  const changeLabel = (raw) => {
    if (!raw) return onChange({ documentLabel: null });
    const [kind, idStr] = raw.split(":");
    const found = (kind === "tag" ? labels.tags : labels.types).find((l) => String(l.id) === idStr);
    onChange({ documentLabel: found ? { kind, id: found.id, name: found.name } : null });
  };

  const openNow = () => { clearTimeout(timer.current); setOpen(true); };
  const closeSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!editingRef.current) setOpen(false); }, 200); };
  const markEditing = () => { editingRef.current = true; };
  const unmarkEditing = () => { editingRef.current = false; };
  if (!PAPERLESS_ENABLED) return null;

  const docBlock = docLoading ? (
    <span style={St.correspondentDocMuted}><Loader2 size={13} className="spin" /> {TXT.searchingDocument}</span>
  ) : doc ? (
    <a href={doc.url} target="_blank" rel="noopener noreferrer" style={St.correspondentDocLink}>{doc.documentType ? `${doc.documentType} · ` : ""}{doc.title} — {TXT.openInPaperless}</a>
  ) : (
    <span style={St.correspondentDocMuted}>{TXT.noDocumentFound}</span>
  );

  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }}>
      <button type="button" aria-label={TXT.correspondent}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{ ...St.iconBtn, color: (has || entry.documentId) ? C.b : C.muted }}>
        <Building2 size={16} />
      </button>
      {open && (
        <span style={mobilePopupStyle(St.notePop)} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }} onClick={(e) => e.stopPropagation()}>
          <input list="correspondents" value={value} placeholder={TXT.correspondentPlaceholder}
            onChange={(e) => onChange({ correspondent: e.target.value })}
            onFocus={markEditing}
            onBlur={(e) => { unmarkEditing(); onSync(e.target.value); }}
            style={St.noteInput} aria-label={TXT.correspondent} />
          {match && (
            <>
              <div style={St.correspondentModeRow}>
                <button type="button" onClick={() => onChange({ documentMode: "auto" })} style={{ ...St.toggleBtn, ...(mode === "auto" ? St.toggleOn : {}) }}>{TXT.documentModeAuto}</button>
                <button type="button" onClick={() => onChange({ documentMode: "manual" })} style={{ ...St.toggleBtn, ...(mode === "manual" ? St.toggleOn : {}) }}>{TXT.documentModeManual}</button>
              </div>
              {mode === "auto" ? (
                <>
                  <select
                    value={entry.documentLabel ? `${entry.documentLabel.kind}:${entry.documentLabel.id}` : ""}
                    onChange={(e) => changeLabel(e.target.value)}
                    onFocus={markEditing} onBlur={unmarkEditing}
                    style={{ ...St.copySel, width: "100%", maxWidth: "none", marginBottom: 8 }}>
                    <option value="">{TXT.noLabelPreference}</option>
                    <optgroup label={TXT.documentTypes}>
                      {labels.types.map((t) => <option key={`type:${t.id}`} value={`type:${t.id}`}>{t.name}</option>)}
                    </optgroup>
                    <optgroup label={TXT.documentTags}>
                      {labels.tags.map((t) => <option key={`tag:${t.id}`} value={`tag:${t.id}`}>{t.name}</option>)}
                    </optgroup>
                  </select>
                  <div style={St.correspondentDoc}>{docBlock}</div>
                </>
              ) : (
                <>
                  <input value={query} placeholder={TXT.searchDocumentsPlaceholder}
                    onChange={(e) => runSearch(e.target.value)}
                    onFocus={markEditing} onBlur={unmarkEditing}
                    style={St.noteInput} aria-label={TXT.searchDocumentsPlaceholder} />
                  {searching && <span style={St.correspondentDocMuted}><Loader2 size={13} className="spin" /> {TXT.searchingDocument}</span>}
                  {!searching && results.length > 0 && (
                    <div style={St.correspondentResults}>
                      {results.map((r) => (
                        <button key={r.id} type="button" onClick={() => pickDocument(r.id)} style={St.correspondentResult}>
                          {r.documentType ? `${r.documentType} · ` : ""}{r.title}
                        </button>
                      ))}
                    </div>
                  )}
                  {entry.documentId && (
                    <div style={St.correspondentDoc}>
                      {docBlock}
                      <button type="button" onClick={() => { onChange({ documentId: null }); setDocKey(null); }} style={St.correspondentUnlink}>{TXT.clearPinnedDocument}</button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </span>
      )}
    </span>
  );
}

// Contract/subscription duration: start + end date, a progress bar, and a
// warning state (color-coded, visible even with the popover closed) once the
// end date is within CONTRACT_WARNING_DAYS or already passed.
function DurationField({ entry, onChange }) {
  const [open, setOpen] = useState(false);
  // Tracks whether a field in this popover has been focused since it opened.
  // Only reset on an explicit close (outside click / toggling the button
  // shut), never on blur: some browsers momentarily blur the date input while
  // its native calendar overlay is open, which — combined with the pointer
  // appearing to leave the popover onto that overlay — used to auto-close the
  // whole popover mid-pick, forcing a second click before the day could be
  // selected. Once you've started editing, only an explicit close dismisses it.
  const editingRef = useRef(false);
  const timer = useRef(null);
  const rootRef = useRef(null);
  const closeNow = () => { clearTimeout(timer.current); editingRef.current = false; setOpen(false); };
  useClickOutside(rootRef, open, closeNow);

  const start = entry.startDate || "";
  const end = entry.endDate || "";
  const warningDays = entry.warningDays ? num(entry.warningDays) : CONTRACT_WARNING_DAYS;
  const has = Boolean(start || end);
  const left = daysUntil(end);
  const expired = left != null && left < 0;
  const endingSoon = left != null && left >= 0 && left <= warningDays;
  const progress = durationProgress(start, end);
  const color = expired ? C.exp : endingSoon ? C.warn : has ? C.b : C.muted;

  const openNow = () => { clearTimeout(timer.current); setOpen(true); };
  const closeSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!editingRef.current) setOpen(false); }, 200); };
  const markEditing = () => { editingRef.current = true; };

  // Picking a start date defaults the end date to one year later, but only
  // when there's no end date yet — an already-set end date is left alone.
  const setStart = (value) => onChange(value && !end ? { startDate: value, endDate: addOneYear(value) } : { startDate: value });

  const status = expired ? t(LANG, "contractExpired", { days: Math.abs(left) })
    : endingSoon ? t(LANG, "contractEndingSoon", { days: left })
    : end ? t(LANG, "contractActiveUntil", { date: fmtDate(end) })
    : null;

  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }}>
      <button type="button" aria-label={TXT.duration}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => { if (o) editingRef.current = false; return !o; }); }}
        style={{ ...St.iconBtn, color }}>
        <CalendarClock size={16} />
      </button>
      {open && (
        <span style={mobilePopupStyle(St.notePop)} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }} onClick={(e) => e.stopPropagation()}>
          <div style={St.copyTitle}>{TXT.duration}</div>
          <label style={St.copyRow}>
            <span style={St.copyLbl}>{TXT.startDate}</span>
            <input type="date" lang={LANG} value={start} onChange={(e) => setStart(e.target.value)} onFocus={markEditing} style={St.copySel} />
          </label>
          <label style={St.copyRow}>
            <span style={St.copyLbl}>{TXT.endDate}</span>
            <input type="date" lang={LANG} value={end} onChange={(e) => onChange({ endDate: e.target.value })} onFocus={markEditing} style={St.copySel} />
          </label>
          <label style={St.copyRow}>
            <span style={St.copyLbl}>{TXT.warningDays}</span>
            <input inputMode="numeric" value={entry.warningDays || ""} placeholder={String(CONTRACT_WARNING_DAYS)}
              onChange={(e) => onChange({ warningDays: e.target.value.replace(/[^0-9]/g, "") })}
              onFocus={markEditing} style={{ ...St.copySel, width: 60 }} />
          </label>
          {progress != null && (
            <div style={St.progressTrack}><div style={{ ...St.progressFill, width: `${progress * 100}%`, background: color }} /></div>
          )}
          {status && <div style={{ ...St.correspondentDocMuted, color, marginTop: progress != null ? 6 : 8 }}>{status}</div>}
        </span>
      )}
    </span>
  );
}

// Spaaroverzicht: savings goals with one or more sub-accounts (bank/IBAN/plan
// ID), each linked to an existing savings entry for its monthly contribution,
// and projected forward from a recorded checkpoint balance.
// Beyond a year, the "months ahead" options step by whole years rather than
// by 12 every time — a 10-year-out projection listed month by month would
// be a very long dropdown for no extra precision anyone needs.
const HORIZON_OPTIONS = [3, 6, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120];
const horizonLabel = (n) => n < 12 ? t(LANG, "months", { count: n }) : t(LANG, "yearsShort", { count: n / 12 });

function SavingsOverviewPage({ savingsGoals, months, savingsEntries, currentMonthData, sel, onUpdateGoal, onAddSubAccount, onRemoveSubAccount, onUpdateSubAccount }) {
  const [horizon, setHorizon] = useState(24);
  // Accordion: opening one goal collapses whichever other one was open, so
  // the page doesn't turn into a wall of charts once there are several.
  const [openGoalId, setOpenGoalId] = useState(null);
  return (
    <div className="fade">
      <div style={St.savingsPageHead}>
        <ColTitle>{TXT.savingsOverviewView}</ColTitle>
        <label style={St.savingsHorizon}>
          {TXT.projectionMonths}
          <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} style={St.copySel}>
            {HORIZON_OPTIONS.map((n) => <option key={n} value={n}>{horizonLabel(n)}</option>)}
          </select>
        </label>
      </div>
      {savingsEntries.length === 0 && <div style={St.copyEmpty}>{TXT.noSavingsGoals}</div>}
      {savingsEntries.map((entry) => {
        const goal = savingsGoals.find((g) => g.entryId === entry.id) || { entryId: entry.id, targetAmount: "", forwarded: false, checkpoints: {}, subAccounts: [] };
        return (
          <SavingsGoalCard key={entry.id} entry={entry} goal={goal} months={months} currentMonthData={currentMonthData} sel={sel} horizon={horizon}
            open={openGoalId === entry.id}
            onToggleOpen={() => setOpenGoalId((cur) => cur === entry.id ? null : entry.id)}
            onUpdate={(patch) => onUpdateGoal(entry.id, patch)}
            onAddSubAccount={() => onAddSubAccount(entry.id)}
            onRemoveSubAccount={(subId) => onRemoveSubAccount(entry.id, subId)}
            onUpdateSubAccount={(subId, patch) => onUpdateSubAccount(entry.id, subId, patch)}
          />
        );
      })}
    </div>
  );
}

function SavingsGoalCard({ entry, goal, months, currentMonthData, sel, horizon, open, onToggleOpen, onUpdate, onAddSubAccount, onRemoveSubAccount, onUpdateSubAccount }) {
  const forwarded = Boolean(goal.forwarded);
  const subAccounts = goal.subAccounts;
  // The target applies to the goal as a whole, regardless of whether it's
  // forwarded to real sub-accounts.
  const target = goal.targetAmount ? num(goal.targetAmount) : null;
  const entryMonthlyAmount = monthlyOf(entry, currentMonthData);
  // Shown read-only exactly as it's entered in the monthly view (its own
  // amount + period, e.g. "600 /jr") rather than converted to a monthly
  // figure — the same value the monthly view itself shows.
  const formulaActive = Boolean(entry.formula);
  const entryDisplayAmount = formulaActive ? round2(entryAmount(entry, currentMonthData)) : num(entry.amount);
  const entryPeriodSuffix = entry.period === "year" ? TXT.periodYearAbbr : TXT.periodMonthAbbr;
  // Without a separate bank to track, there's still a projection worth
  // showing by default: a single virtual "account" starting at €0 this
  // month, growing by the entry's own amount — same machinery, no bank
  // details needed. Once forwarded, the real (editable) sub-accounts take
  // over instead. Either way, the recorded balance itself is a single
  // real observation at the goal level (entered once above, not per bank)
  // — each account's own checkpoint is that total split by its own share
  // of the contribution, the same way its share of the monthly
  // contribution is derived.
  const effectiveSubAccounts = useMemo(() => {
    const checkpoints = Object.keys(goal.checkpoints || {}).length ? goal.checkpoints : { [sel]: "0" };
    const source = forwarded ? subAccounts : [{ id: `self-${entry.id}`, holder: entry.label || TXT.unnamed, sharePercent: "100", interestRate: "" }];
    return source.map((s) => {
      const share = s.sharePercent === "" || s.sharePercent == null ? 1 : num(s.sharePercent) / 100;
      return { ...s, checkpoints: Object.fromEntries(Object.entries(checkpoints).map(([k, v]) => [k, String(num(v) * share)])) };
    });
  }, [forwarded, subAccounts, entry.id, entry.label, goal.checkpoints, sel]);
  // The table starts at the earliest checkpoint among this goal's
  // accounts — accounts opened later simply show "—" for months before
  // their own checkpoint.
  const earliest = useMemo(() => {
    const allKeys = effectiveSubAccounts.flatMap((s) => Object.keys(s.checkpoints || {})).filter(Boolean).sort();
    return allKeys[0] || null;
  }, [effectiveSubAccounts]);
  const keys = useMemo(() => {
    if (!earliest) return [];
    const out = [earliest];
    let k = earliest;
    for (let i = 0; i < horizon; i++) { k = shiftMonth(k, 1); out.push(k); }
    return out;
  }, [earliest, horizon]);
  const seriesBySub = useMemo(() => {
    const map = {};
    for (const s of effectiveSubAccounts) map[s.id] = projectSubAccountSeries(months, entry.id, s, keys, target);
    return map;
  }, [effectiveSubAccounts, months, entry.id, keys, target]);
  const totalAtEnd = keys.length ? effectiveSubAccounts.reduce((sum, s) => sum + (seriesBySub[s.id][keys[keys.length - 1]]?.balance ?? 0), 0) : 0;
  const reached = target != null && keys.length > 0 && totalAtEnd >= target;
  const hasInterest = effectiveSubAccounts.some((s) => num(s.interestRate) > 0);
  const chartData = useMemo(() => keys.map((k) => {
    const point = { label: monthShortWithYear(k) };
    for (const s of effectiveSubAccounts) point[s.id] = seriesBySub[s.id][k]?.balance ?? null;
    return point;
  }), [keys, seriesBySub, effectiveSubAccounts]);
  // Skip ticks so labels never crowd — aim for roughly 8 visible regardless
  // of how many months the horizon spans.
  const chartTickInterval = Math.max(0, Math.ceil(chartData.length / 8) - 1);

  // The table is collapsed by default and, once opened, reveals 12 months
  // at a time rather than the whole (possibly multi-year) range at once.
  const [tableOpen, setTableOpen] = useState(false);
  const [visibleMonths, setVisibleMonths] = useState(12);
  const visibleKeys = keys.slice(0, visibleMonths);

  return (
    <section style={St.section} className="fade">
      <div role="button" tabIndex={0} aria-expanded={open}
        onClick={onToggleOpen}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleOpen(); } }}
        style={St.collapseHead}>
        <span style={St.savingsGoalName}>{entry.label || TXT.unnamed}</span>
        <span style={{ flex: 1 }} />
        {/* Read-only here on purpose — this is the same monthly entry shown
            in the monthly view, and it should only be editable there. */}
        <span style={St.savingsGoalAmount} title={TXT.savingsGoalAmountInfo}>{eur(entryDisplayAmount)} {entryPeriodSuffix}</span>
        <label style={St.goalForwardedToggle} title={TXT.goalForwardedInfo} onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={forwarded} onChange={(e) => onUpdate({ forwarded: e.target.checked })} />
          {TXT.goalForwardedLabel}
        </label>
        <ChevronDown size={18} style={{ color: C.muted, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s", flexShrink: 0 }} />
      </div>

      {open && (
      <>
      {/* The recorded balance and the target apply to the goal as a whole,
          whether or not it's forwarded to real sub-accounts — a single real
          observation, not one per bank. */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
        <label style={St.copyRow}>
          <span style={St.copyLbl}>{TXT.checkpointBalance}</span>
          <input inputMode="decimal" value={goal.checkpoints?.[sel] ?? ""} placeholder="0,00"
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.,]/g, "");
              const next = { ...(goal.checkpoints || {}) };
              if (v) next[sel] = v; else delete next[sel];
              onUpdate({ checkpoints: next });
            }} style={{ ...St.copySel, width: 90 }} />
        </label>
        <label style={St.copyRow}>
          <span style={St.copyLbl}>{TXT.targetAmount}</span>
          <input inputMode="decimal" value={goal.targetAmount} placeholder={TXT.targetAmountPlaceholder}
            onChange={(e) => onUpdate({ targetAmount: e.target.value.replace(/[^0-9.,]/g, "") })} style={{ ...St.copySel, width: 100 }} />
        </label>
      </div>

      {forwarded && (
        <>
          {subAccounts.map((sub) => (
            <SubAccountRow key={sub.id} sub={sub} entryMonthlyAmount={entryMonthlyAmount}
              onChange={(patch) => onUpdateSubAccount(sub.id, patch)}
              onRemove={() => onRemoveSubAccount(sub.id)} />
          ))}
          {subAccounts.length === 0 && <div style={St.copyEmpty}>{TXT.noSubAccounts}</div>}
          <button type="button" onClick={onAddSubAccount} style={St.addBtn}><Plus size={16} /> {TXT.addSubAccount}</button>
        </>
      )}

      {keys.length >= 2 && (
        <>
          <ChartTitle>{TXT.savingsChartTitle}</ChartTitle>
          <div style={St.chartBox}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 6, right: 20, left: -6, bottom: 0 }}>
                <CartesianGrid stroke={C.line} vertical={false} />
                <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} interval={chartTickInterval} />
                <YAxis tick={tick} axisLine={false} tickLine={false} width={58} tickFormatter={eur0} />
                <Tooltip {...tooltipProps} />
                {forwarded && <Legend {...legendProps} />}
                {effectiveSubAccounts.map((s) => (
                  <Area key={s.id} type="monotone" dataKey={s.id} name={s.holder || TXT.unnamed} stackId="1"
                    stroke={categoryColor(s.holder || s.id)} fill={categoryColor(s.holder || s.id)} fillOpacity={0.35} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {keys.length > 0 && (
        <>
          <button type="button" onClick={() => setTableOpen((o) => !o)} style={St.detailsBtn} aria-expanded={tableOpen}>
            {tableOpen ? TXT.hideTable : TXT.showTable}
            <ChevronDown size={15} style={{ transform: tableOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>
          {tableOpen && (
            <div style={St.savingsTableWrap}>
              <table style={St.savingsTable}>
                <thead>
                  <tr>
                    <th style={{ ...St.savingsTh, textAlign: "left" }}>{TXT.monthColumn}</th>
                    <th style={St.savingsTh}>{TXT.combinedTotal}</th>
                    {forwarded && effectiveSubAccounts.map((s) => <th key={s.id} style={St.savingsTh}>{s.holder || TXT.unnamed}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {visibleKeys.map((k) => {
                    const values = effectiveSubAccounts.map((s) => seriesBySub[s.id][k]);
                    const total = values.reduce((sum, v) => sum + (v?.balance ?? 0), 0);
                    const totalInterest = values.reduce((sum, v) => sum + (v?.interest ?? 0), 0);
                    return (
                      <tr key={k}>
                        <td style={{ ...St.savingsTd, textAlign: "left" }}>{monthLong(k)}</td>
                        <td style={{ ...St.savingsTd, fontWeight: 700 }}>
                          {eur(total)}
                          {hasInterest && <div style={St.savingsTdSub}>{TXT.interestPortion} {eur(totalInterest)}</div>}
                        </td>
                        {forwarded && values.map((v, i) => (
                          <td key={effectiveSubAccounts[i].id} style={St.savingsTd}>
                            {v != null ? (
                              <>
                                {eur(v.balance)}
                                {hasInterest && num(effectiveSubAccounts[i].interestRate) > 0 && <div style={St.savingsTdSub}>{TXT.interestPortion} {eur(v.interest)}</div>}
                              </>
                            ) : "—"}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visibleMonths < keys.length && (
                <button type="button" onClick={() => setVisibleMonths((v) => v + 12)} style={St.addBtn}>{TXT.showMoreMonths}</button>
              )}
            </div>
          )}
        </>
      )}
      {reached && <div style={St.savingsTargetReached}>{TXT.targetReached}</div>}
      </>
      )}
    </section>
  );
}

// Shared by the sub-account icon fields below: the same hover/click popover
// mechanics as Note/Link/Correspondent/Duration elsewhere, including the
// "only close on outside click, never on blur" fix from DurationField (a
// native date input inside one of these can blur the input while its own
// calendar overlay is open, which used to auto-close the whole popover).
function IconPopoverField({ icon: Icon, ariaLabel, active, popStyle, children }) {
  const [open, setOpen] = useState(false);
  const editingRef = useRef(false);
  const timer = useRef(null);
  const rootRef = useRef(null);
  const closeNow = () => { clearTimeout(timer.current); editingRef.current = false; setOpen(false); };
  useClickOutside(rootRef, open, closeNow);
  const openNow = () => { clearTimeout(timer.current); setOpen(true); };
  const closeSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!editingRef.current) setOpen(false); }, 200); };
  const markEditing = () => { editingRef.current = true; };
  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }}>
      <button type="button" aria-label={ariaLabel}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => { if (o) editingRef.current = false; return !o; }); }}
        style={{ ...St.iconBtn, color: active ? C.b : C.muted }}>
        <Icon size={16} />
      </button>
      {open && (
        <span style={mobilePopupStyle({ ...St.notePop, ...popStyle })} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }} onClick={(e) => e.stopPropagation()}>
          {typeof children === "function" ? children(markEditing) : children}
        </span>
      )}
    </span>
  );
}

function SubAccountRow({ sub, entryMonthlyAmount, onChange, onRemove }) {
  const share = sub.sharePercent === "" || sub.sharePercent == null ? 1 : num(sub.sharePercent) / 100;
  const preview = entryMonthlyAmount * share;

  return (
    <div style={St.itemWrap} className="entryWrap">
      <div className="entry">
        <span className="e-lead">
          <span style={{ ...St.catDot, background: categoryColor(sub.holder || sub.id) }} />
          <input list="banks" aria-label={TXT.subAccountBank} value={sub.bank} placeholder={TXT.subAccountBankPlaceholder}
            onChange={(e) => onChange({ bank: e.target.value })} style={St.catInput} />
        </span>
        <input className="e-desc" aria-label={TXT.subAccountHolder} value={sub.holder} placeholder={TXT.subAccountHolderPlaceholder}
          onChange={(e) => onChange({ holder: e.target.value })} style={St.nameInput} />
        <span className="entryActions" style={St.rowActions}>
          <IconPopoverField icon={Percent} ariaLabel={TXT.subAccountShare} active={num(sub.sharePercent ?? 100) !== 100 || num(sub.interestRate) > 0}>
            {(markEditing) => (
              <>
                <div style={St.copyTitle}>{TXT.subAccountShare}</div>
                <div style={St.correspondentDocMuted}>{TXT.subAccountShareInfo}</div>
                <label style={{ ...St.copyRow, marginTop: 8 }}>
                  <span style={St.copyLbl}>{TXT.subAccountShare}</span>
                  <input inputMode="numeric" value={sub.sharePercent ?? "100"} placeholder="100" onFocus={markEditing}
                    onChange={(e) => onChange({ sharePercent: e.target.value.replace(/[^0-9.,]/g, "") })} style={{ ...St.copySel, width: 60 }} />
                </label>
                <div style={St.correspondentDocMuted}>{TXT.subAccountPreview} {eur(preview)} {TXT.perMonth}</div>
                <label style={{ ...St.copyRow, marginTop: 8 }}>
                  <span style={St.copyLbl}>{TXT.subAccountInterestRate}</span>
                  <input inputMode="decimal" value={sub.interestRate} placeholder="0" onFocus={markEditing}
                    onChange={(e) => onChange({ interestRate: e.target.value.replace(/[^0-9.,]/g, "") })} style={{ ...St.copySel, width: 70 }} />
                </label>
                <div style={St.correspondentDocMuted}>{TXT.subAccountInterestRateInfo}</div>
              </>
            )}
          </IconPopoverField>
          <IconPopoverField icon={Building2} ariaLabel={TXT.subAccountBankDetails} active={Boolean(sub.iban || sub.planId || sub.referenceId)}>
            {(markEditing) => (
              <>
                <div style={St.copyTitle}>{TXT.subAccountBankDetails}</div>
                <label style={St.copyRow}>
                  <span style={St.copyLbl}>{TXT.subAccountIban}</span>
                  <input value={sub.iban} placeholder={TXT.subAccountIbanPlaceholder} onFocus={markEditing}
                    onChange={(e) => onChange({ iban: e.target.value })} style={St.copySel} />
                </label>
                <label style={St.copyRow}>
                  <span style={St.copyLbl}>{TXT.subAccountPlanId}</span>
                  <input value={sub.planId} placeholder={TXT.subAccountPlanIdPlaceholder} onFocus={markEditing}
                    onChange={(e) => onChange({ planId: e.target.value })} style={St.copySel} />
                </label>
                <label style={St.copyRow}>
                  <span style={St.copyLbl}>{TXT.subAccountReference}</span>
                  <input value={sub.referenceId} placeholder={TXT.subAccountReferencePlaceholder} onFocus={markEditing}
                    onChange={(e) => onChange({ referenceId: e.target.value })} style={St.copySel} />
                </label>
              </>
            )}
          </IconPopoverField>
          <button type="button" aria-label={TXT.delete} onClick={onRemove} style={St.iconBtn}><Trash2 size={16} /></button>
        </span>
      </div>
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

// Shared by CopyField and MonthCopyField: a checkbox list of months with
// select-all/none, used identically for the "past" and "future" side of
// either copy popover so both features behave the same way.
function MonthChecklist({ months, selected, onToggle, onSelectAll, onClear }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <button type="button" onClick={onSelectAll} style={{ ...St.copyApply, flex: 1 }}>{TXT.copyAll}</button>
        <button type="button" onClick={onClear} style={{ ...St.copyApply, background: C.exp, flex: 1 }}>{TXT.copyNone}</button>
      </div>
      <div style={{ maxHeight: 160, overflowY: "auto", marginBottom: 10 }}>
        {months.map((k) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <input type="checkbox" checked={selected.includes(k)} onChange={() => onToggle(k)} />
            <span style={{ fontSize: 13 }}>{monthLong(k)}</span>
          </label>
        ))}
      </div>
    </>
  );
}

function toggleIn(setSel) { return (key) => setSel((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]); }

function CopyField({ pastMonths, futureMonths, onCopy }) {
  const [open, setOpen] = useState(false);
  const [pastSel, setPastSel] = useState([]);
  const [futureSel, setFutureSel] = useState([]);
  const editingRef = useRef(false);
  const timer = useRef(null);
  const rootRef = useRef(null);
  const has = pastMonths.length || futureMonths.length;
  useClickOutside(rootRef, open, () => setOpen(false));
  const openNow = () => { clearTimeout(timer.current); setOpen(true); };
  const closeSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!editingRef.current) setOpen(false); }, 220); };
  const apply = () => { if (pastSel.length || futureSel.length) { onCopy(pastSel, futureSel); setOpen(false); setPastSel([]); setFutureSel([]); } };
  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }} onFocus={() => { editingRef.current = true; }} onBlur={() => { editingRef.current = false; }}>
      <button type="button" aria-label={TXT.copyAmountAria} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} style={St.iconBtn}><Copy size={16} /></button>
      {open && (
        <span style={mobilePopupStyle(St.copyPop)} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }} onClick={(e) => e.stopPropagation()}>
          <div style={St.copyTitle}>{TXT.copyAmount}</div>
          {!has ? (
            <div style={St.copyEmpty}>{TXT.noMonthsToCopy}</div>
          ) : (
            <>
              {pastMonths.length > 0 && (
                <>
                  <div style={St.copySubLabel}>{TXT.copyToPast}</div>
                  <MonthChecklist months={pastMonths.slice().reverse()} selected={pastSel} onToggle={toggleIn(setPastSel)} onSelectAll={() => setPastSel(pastMonths.slice())} onClear={() => setPastSel([])} />
                </>
              )}
              {futureMonths.length > 0 && (
                <>
                  <div style={St.copySubLabel}>{TXT.copyToFuture}</div>
                  <MonthChecklist months={futureMonths} selected={futureSel} onToggle={toggleIn(setFutureSel)} onSelectAll={() => setFutureSel(futureMonths.slice())} onClear={() => setFutureSel([])} />
                </>
              )}
              <button type="button" onClick={apply} disabled={!pastSel.length && !futureSel.length} style={{ ...St.copyApply, opacity: (!pastSel.length && !futureSel.length) ? 0.5 : 1 }}>{TXT.copy}</button>
            </>
          )}
        </span>
      )}
    </span>
  );
}

function MonthCopyField({ pastMonths, futureMonths, onCopy }) {
  const [open, setOpen] = useState(false);
  const [pastSel, setPastSel] = useState([]);
  const [futureSel, setFutureSel] = useState([]);
  const editingRef = useRef(false);
  const timer = useRef(null);
  const rootRef = useRef(null);
  const has = pastMonths.length || futureMonths.length;
  useClickOutside(rootRef, open, () => setOpen(false));
  const openNow = () => { clearTimeout(timer.current); setOpen(true); };
  const closeSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!editingRef.current) setOpen(false); }, 220); };
  const apply = () => {
    const targets = [...pastSel, ...futureSel];
    if (targets.length) { onCopy(targets); setOpen(false); setPastSel([]); setFutureSel([]); }
  };
  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }} onFocus={() => { editingRef.current = true; }} onBlur={() => { editingRef.current = false; }}>
      <button type="button" aria-label={TXT.copyMonthAria} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} style={St.iconBtn}><Copy size={16} /></button>
      {open && (
        <span style={mobilePopupStyle({ ...St.copyPop, top: "auto", bottom: "calc(100% + 8px)" })} onPointerEnter={(e) => { if (e.pointerType === "mouse") openNow(); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }} onClick={(e) => e.stopPropagation()}>
          <div style={St.copyTitle}>{TXT.copyMonth}</div>
          {!has ? (
            <div style={St.copyEmpty}>{TXT.noPrevMonths}</div>
          ) : (
            <>
              {pastMonths.length > 0 && (
                <>
                  <div style={St.copySubLabel}>{TXT.copyToPast}</div>
                  <MonthChecklist months={pastMonths.slice().reverse()} selected={pastSel} onToggle={toggleIn(setPastSel)} onSelectAll={() => setPastSel(pastMonths.slice())} onClear={() => setPastSel([])} />
                </>
              )}
              {futureMonths.length > 0 && (
                <>
                  <div style={St.copySubLabel}>{TXT.copyToFuture}</div>
                  <MonthChecklist months={futureMonths} selected={futureSel} onToggle={toggleIn(setFutureSel)} onSelectAll={() => setFutureSel(futureMonths.slice())} onClear={() => setFutureSel([])} />
                </>
              )}
              <button type="button" onClick={apply} disabled={!pastSel.length && !futureSel.length} style={{ ...St.copyApply, opacity: (!pastSel.length && !futureSel.length) ? 0.5 : 1 }}>{TXT.copy}</button>
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

  warnBanner: { display: "flex", gap: 10, alignItems: "flex-start", background: "var(--warn-soft)", border: `1px solid ${C.warn}`, color: C.warn, borderRadius: 14, padding: "12px 14px", marginTop: 12, marginBottom: 4 },
  warnBannerBody: { display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 },
  warnBannerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13, flexWrap: "wrap" },
  warnBannerLabel: { color: C.ink, fontWeight: 700 },

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
  customRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  customName: { fontSize: 13, color: C.muted, fontWeight: 600 },
  sortRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10, flexWrap: "wrap" },
  sortLabel: { fontSize: 12.5, color: C.muted, fontWeight: 600 },
  statsPeriodRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  dragHandle: { display: "inline-flex", alignItems: "center", color: C.muted, cursor: "grab", flexShrink: 0, touchAction: "none" },

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
  pieBox: { width: "100%", height: 200, marginBottom: 6 },
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
  correspondentModeRow: { display: "flex", marginBottom: 8 },
  correspondentDoc: { marginTop: 8, paddingTop: 7, borderTop: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  correspondentDocMuted: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.muted },
  correspondentDocLink: { color: C.b, fontWeight: 600, textDecoration: "none", fontSize: 12.5 },
  correspondentResults: { maxHeight: 160, overflowY: "auto", marginTop: 6, display: "flex", flexDirection: "column", gap: 2 },
  correspondentResult: { textAlign: "left", border: "none", background: "transparent", color: C.ink, fontSize: 12.5, padding: "6px 4px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit" },
  correspondentUnlink: { border: "none", background: "transparent", color: C.exp, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 },
  progressTrack: { marginTop: 10, height: 6, borderRadius: 999, background: C.canvas, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 999, transition: "width .2s" },
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
  copySubLabel: { fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 },
  copyRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 },
  copyLbl: { fontSize: 13, color: C.ink },
  copySel: { maxWidth: 134, fontSize: 13, padding: "5px 6px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.card, color: C.ink, fontFamily: "inherit" },
  copyApply: { width: "100%", border: "none", background: C.b, color: "#fff", fontSize: 13.5, fontWeight: 600, padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", marginTop: 2 },
  copyEmpty: { fontSize: 12.5, color: C.muted, lineHeight: 1.45 },

  savingsPageHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 },
  savingsHorizon: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.muted, fontWeight: 600 },
  savingsGoalName: { fontWeight: 700, fontSize: 15, padding: "8px 2px" },
  savingsGoalAmount: { fontSize: 15, fontWeight: 600, color: C.ink, fontVariantNumeric: "tabular-nums", padding: "8px 4px", cursor: "default" },
  goalForwardedToggle: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.muted, fontWeight: 600, cursor: "pointer", marginLeft: 14, whiteSpace: "nowrap" },
  savingsTableWrap: { overflowX: "auto", marginTop: 14 },
  savingsTable: { width: "100%", borderCollapse: "collapse", fontSize: 13, whiteSpace: "nowrap" },
  savingsTh: { textAlign: "right", padding: "6px 10px", color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, background: C.card },
  savingsTd: { textAlign: "right", padding: "5px 10px", color: C.ink, fontVariantNumeric: "tabular-nums", borderBottom: `1px solid ${C.line}` },
  savingsTdSub: { fontSize: 10.5, fontWeight: 500, color: C.muted },
  savingsTargetReached: { marginTop: 10, fontSize: 12.5, fontWeight: 600, color: C.save },
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
