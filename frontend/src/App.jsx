/**
 * Open Family Finance — the whole UI lives in this file.
 *
 * Reading guide (top to bottom):
 *   Design tokens .... colors (C); UI texts (TXT) live in ./i18n and ./locales
 *   Calculations ..... ./finance.js (split, data model, savings projections)
 *   Helpers .......... formatting, dates
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
 *   Amounts and deletes are the exception: they change only the selected
 *   month, and when the entry also exists in later months a dialog asks
 *   whether to apply the change there too (see commitAmount and
 *   requestDelete), so a change is never silently skipped or spread.
 */
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Trash2, RotateCcw, Check, Loader2, ChevronLeft, ChevronRight,
  ChevronDown, TrendingUp, Landmark, PiggyBank, Wallet, Receipt, History, Link2,
  Copy, Sun, Moon,
  Calculator, Github, GripVertical, Building2, CalendarClock, AlertTriangle, Printer,
  MoreHorizontal, CalendarDays, Waypoints, Search, X, Users, StickyNote,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Sankey, Rectangle, Layer,
} from "recharts";
import { storage, paperless, PAPERLESS_ENABLED } from "./api";
import { LANG, TXT, t, getRuntimeCurrencyLocale, getRuntimeDateLocale, getRuntimeAppTitle } from "./i18n";
import {
  DEFAULT_PERSON, DEFAULT_FIGURES, num, round2, clamp01, toMonthly, monthlyOf, monthlyInc,
  entryKinds, findEntryById, computeFormulaAmount, entryAmount, sumM, PERSONAL_KINDS, listAt, withList,
  allSavingsOf, flip, pctOf, uid, clone, monthKey, keyToDate, shiftMonth,
  figuresFor, computeTotals, migrateFig, SORT_MODES, DEFAULT_LIST_SORT, listSortOf, migrateCheckpoints, migrateSubAccount,
  migrateGoal, freshData, normalize, monthlyContributionAt, subAccountContribution, projectSubAccountSeries,
  valueAt, transferAmountAt, setTransferAmountAt, transferTargetKey, FROM_START, goalAccounts, balanceAt, accountOwnerShares, interestTip, personalTotals, isDeposit, depositEnd, isMonthKey,
} from "./finance";

/* ----------------------------------------------------------------
   Design tokens
------------------------------------------------------------------- */
const C = {
  canvas: "var(--canvas)", card: "var(--card)", ink: "var(--ink)", muted: "var(--muted)", line: "var(--line)",
  a: "var(--a)", b: "var(--b)", c: "var(--c)", d: "var(--d)", e: "var(--e)",
  gov: "var(--gov)", save: "var(--save)", inc: "var(--inc)", exp: "var(--exp)", warn: "var(--warn)",
  softA: "var(--soft-a)", softB: "var(--soft-b)", softC: "var(--soft-c)", softD: "var(--soft-d)", softE: "var(--soft-e)",
};

// Up to 5 people get a hand-picked, theme-aware color pair (main + soft
// background tint); indices 0/1 are the original two colors, unchanged, so a
// 2-person household looks pixel-identical to before this was generalized.
// Beyond 5, fall back to categoryColor keyed by id (stable, but not
// theme-tuned and has no separate soft tint).
const PERSON_PALETTE = [
  { main: C.a, soft: C.softA }, { main: C.b, soft: C.softB },
  { main: C.c, soft: C.softC }, { main: C.d, soft: C.softD }, { main: C.e, soft: C.softE },
];
function personColor(person, index) {
  if (index < PERSON_PALETTE.length) return PERSON_PALETTE[index];
  const main = categoryColor(person.id);
  return { main, soft: main };
}
// A person's personal-page section, tinted with their own color instead of a
// fixed background — one function instead of a style per person/slot.
function sectionPersonalStyle(color) {
  return { background: `color-mix(in srgb, ${color} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 18%, transparent)` };
}

const KEY = "open-family-finance:v1";
const OPEN_KEY = "open-family-finance:open";
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

// — formatting (nl-NL) —
function eur(n, locale = getRuntimeCurrencyLocale()) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(isFinite(n) ? n : 0);
}
function eur0(n, locale = getRuntimeCurrencyLocale()) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(isFinite(n) ? n : 0);
}
const pct = (x) => `${Math.round(x * 100)}%`;
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
const monthLong = (k, locale = getRuntimeDateLocale()) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(keyToDate(k));
const monthShort = (k, locale = getRuntimeDateLocale()) => { const d = keyToDate(k); const m = new Intl.DateTimeFormat(locale, { month: "short" }).format(d); return d.getMonth() === 0 ? `${m} '${String(d.getFullYear()).slice(2)}` : m; };
// Like monthShort, but always includes the year — a savings projection can
// span several years, so every axis tick needs to disambiguate on its own
// rather than relying on the January tick alone.
const monthShortWithYear = (k, locale = getRuntimeDateLocale()) => { const d = keyToDate(k); const m = new Intl.DateTimeFormat(locale, { month: "short" }).format(d); return `${m} '${String(d.getFullYear()).slice(2)}`; };
const dt = (ts, locale = getRuntimeDateLocale()) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(ts));
// "nov '26" or "nov '26 – mrt '27" for a sorted, non-empty list of month keys.
const monthRange = (keys) => keys.length === 1 ? monthShortWithYear(keys[0]) : `${monthShortWithYear(keys[0])} – ${monthShortWithYear(keys[keys.length - 1])}`;
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

// Groups a list of entries with a `category` field (expenses, personal
// expenses) by category, monthly-resolving formulas — same grouping and
// coloring convention as the expenses pie chart elsewhere, just
// parameterized instead of closing over `cur` directly.
function groupByCategory(list, monthData) {
  const map = {};
  for (const e of list) {
    const cat = e.category || TXT.otherCategory;
    map[cat] = (map[cat] || 0) + monthlyOf(e, monthData);
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

// Builds a Sankey node/link graph tracing salary to the last known
// destination, for one month's figures + its already-computed totals.
// Amounts all come from monthlyOf/calc (which already resolve formulas),
// never raw entry.amount. Sankey can't render negative or zero-value links,
// so leftover/unallocated amounts are clamped to ≥0 and zero-value links are
// skipped outright — a negative leftover is already surfaced elsewhere (the
// red LeftoverCard).
//
// `detail` controls how far the graph is exploded, each level a strict
// superset of the previous one's nodes/links (so switching levels never
// reshuffles the diagram, it only adds or removes leaves):
//   1 — totals only: salary/contribution/leftover per person, gov, pot,
//       and expenses/savings/buffer as single totals.
//   2 — level 1, plus expenses and savings broken into their own
//       categories/entries.
//   3 — level 2, plus each person's leftover broken into their personal
//       expense categories + whatever's unallocated.
function buildCashflow(cur, calc, detail) {
  const nodes = [];
  const links = [];
  const indexOf = new Map();
  const addNode = (key, name, color) => {
    if (indexOf.has(key)) return indexOf.get(key);
    indexOf.set(key, nodes.length);
    nodes.push({ name, color });
    return indexOf.get(key);
  };
  const addLink = (sourceKey, targetKey, value) => {
    if (!(value > 0)) return;
    const source = indexOf.get(sourceKey);
    // Colored like the money's origin (the person or category it's leaving),
    // not a flat neutral grey — same colors used for that node itself.
    links.push({ source, target: indexOf.get(targetKey), value: round2(value), color: nodes[source].color });
  };

  const potKey = "pot", expKey = "exp", saveKey = "save", bufferKey = "buffer";
  addNode(potKey, TXT.cashflowSharedPot, C.inc);
  addNode(expKey, TXT.fixedCosts, C.exp);
  addNode(saveKey, TXT.savingsSection, C.save);
  addNode(bufferKey, TXT.cashflowBuffer, C.warn);

  if (calc.govTotal > 0) {
    addNode("gov", TXT.government, C.gov);
    addLink("gov", potKey, calc.govTotal);
  }

  const incomeById = Object.fromEntries(calc.people.map((p) => [p.id, p.income]));
  cur.partners.forEach((p, i) => {
    if (!(incomeById[p.id] > 0)) return; // no income yet (e.g. a freshly added person) — nothing to trace
    const name = p.name || t(LANG, "personName", { n: i + 1 });
    const color = personColor(p, i).main;
    const salaryKey = `salary-${p.id}`, contribKey = `contrib-${p.id}`, leftoverKey = `leftover-${p.id}`;
    addNode(salaryKey, t(LANG, "cashflowSalary", { name }), color);
    addNode(contribKey, t(LANG, "cashflowContribution", { name }), color);
    addNode(leftoverKey, t(LANG, "cashflowLeftover", { name }), color);
    addLink(salaryKey, contribKey, calc.transfers[p.id] || 0);
    addLink(contribKey, potKey, calc.transfers[p.id] || 0);
    const leftover = Math.max(0, calc.leftovers[p.id] || 0);
    addLink(salaryKey, leftoverKey, leftover);

    if (detail >= 3) {
      // Personal expenses, grouped by category, funded from this person's own
      // leftover; whatever isn't tracked stays "unallocated" — the last known
      // place this model can follow that money to.
      let personalSum = 0;
      for (const [cat, amount] of groupByCategory(cur.personalExpenses[p.id] || [], cur)) {
        if (!(amount > 0)) continue;
        personalSum += amount;
        const catKey = `personal-${p.id}-${cat}`;
        addNode(catKey, cat, categoryColor(cat));
        addLink(leftoverKey, catKey, amount);
      }
      for (const s of cur.personalSavings?.[p.id] || []) {
        const amount = monthlyOf(s, cur);
        if (!(amount > 0)) continue;
        personalSum += amount;
        const label = s.label || TXT.unnamed;
        const saveKey = `personal-save-${p.id}-${s.id}`;
        addNode(saveKey, `${label} (${TXT.savingsShort})`, C.save);
        addLink(leftoverKey, saveKey, amount);
      }
      const unallocated = Math.max(0, leftover - personalSum);
      if (unallocated > 0) {
        const unallocatedKey = `unallocated-${p.id}`;
        addNode(unallocatedKey, t(LANG, "cashflowUnallocated", { name }), color);
        addLink(leftoverKey, unallocatedKey, unallocated);
      }
    }
  });

  if (detail >= 2) {
    for (const [cat, amount] of groupByCategory(cur.expenses, cur)) {
      if (!(amount > 0)) continue;
      const catKey = `exp-${cat}`;
      addNode(catKey, cat, categoryColor(cat));
      addLink(expKey, catKey, amount);
    }

    for (const s of cur.savings) {
      const amount = monthlyOf(s, cur);
      if (!(amount > 0)) continue;
      const label = s.label || TXT.unnamed;
      const saveEntryKey = `save-${s.id}`;
      addNode(saveEntryKey, label, categoryColor(label));
      addLink(saveKey, saveEntryKey, amount);
    }
  }

  addLink(potKey, expKey, calc.expensesTotal);
  addLink(potKey, saveKey, calc.savingsTotal);
  addLink(potKey, bufferKey, calc.buffer);

  // A node with no outgoing link is a terminal/rightmost one — used by
  // SankeyNode to flip its label to the other side so it never spills past
  // the chart's right edge, regardless of how many columns this level has.
  const hasOutgoing = new Set(links.map((l) => l.source));
  nodes.forEach((n, i) => { n.isSink = !hasOutgoing.has(i); });

  return { nodes, links };
}

/* ----------------------------------------------------------------
   App
------------------------------------------------------------------- */
export default function App() {
  const [data, setData] = useState(freshData);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(true);
  const [view, setView] = useState("month");
  // Which sections are expanded is remembered per browser, so the page
  // comes back the way you left it.
  const [open, setOpen] = useState(() => {
    const defaults = { inkomen: true, overheid: true, uitgaven: true, sparen: true, statsIncome: true, statsPersonal: true, statsTotals: false, log: false };
    try { return { ...defaults, ...JSON.parse(window.localStorage.getItem(OPEN_KEY) || "{}") }; } catch { return defaults; }
  });
  useEffect(() => { try { window.localStorage.setItem(OPEN_KEY, JSON.stringify(open)); } catch { /* storage unavailable */ } }, [open]);
  const [showDetails, setShowDetails] = useState(false);
  // null = unbounded, so the range always defaults to (and grows with) all available months.
  const [statsFrom, setStatsFrom] = useState(null);
  const [statsTo, setStatsTo] = useState(null);
  // null = nothing being printed; otherwise { type: "month", key } or { type: "year", year }.
  const [printJob, setPrintJob] = useState(null);
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("open-family-finance:theme");
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const saveTimer = useRef(null);
  const margeStart = useRef(null);
  const customStart = useRef({}); // one remembered "before" value per person id, for the log

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
  // A failed load (network error, 401, 5xx) must never flip `loaded`: the
  // autosave below would then PUT the empty freshData() over the real blob.
  // Only "not found" (storage.get → null) counts as a genuinely new install.
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await storage.get(KEY);
        if (!active) return;
        if (res && res.value) setData(normalize(JSON.parse(res.value)));
        setLoadError(false);
        setLoaded(true);
      } catch (e) {
        console.error("Could not load state", e);
        if (active) setLoadError(true);
      }
    })();
    return () => { active = false; };
  }, [loadAttempt]);

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
  // A "history" month: one that's already passed. Its figures are greyed out
  // and read-only until explicitly unlocked, as a guard against accidental
  // edits while just browsing back through old months — re-locks the moment
  // you navigate to a different month.
  const isHistoryMonth = sel < monthKey(new Date());
  const [unlockedMonth, setUnlockedMonth] = useState(null);
  const historyLocked = isHistoryMonth && unlockedMonth !== sel;

  // ── Print / PDF export: a plain, read-only rendering of one month or a
  // whole year, triggered by window.print() rather than a PDF library — the
  // browser's own "save as PDF" in the print dialog is exactly what this
  // needs, with no new dependency. Months never visited yet (rest of a
  // printed year) are derived the same way goMonth would seed them, without
  // writing anything back to `data.months`.
  const printMonths = useMemo(() => {
    if (!printJob) return [];
    const keys = printJob.type === "year"
      ? Array.from({ length: 12 }, (_, i) => `${printJob.year}-${String(i + 1).padStart(2, "0")}`)
      : [printJob.key];
    return keys.map((key) => { const fig = figuresFor(data.months, key); return { key, fig, calc: computeTotals(fig) }; });
  }, [printJob, data.months]);
  useEffect(() => {
    if (!printMonths.length) return;
    const id = requestAnimationFrame(() => window.print());
    const onAfter = () => setPrintJob(null);
    window.addEventListener("afterprint", onAfter);
    return () => { cancelAnimationFrame(id); window.removeEventListener("afterprint", onAfter); };
  }, [printMonths]);

  // Chart only the people currently in `cur` — a person absent from an older
  // month simply reads 0 there (display-only, no data loss).
  const series = useMemo(() => sortedMonths.map((m) => {
    const totals = computeTotals(data.months[m]);
    const row = {
      key: m, label: monthShort(m),
      income: Math.round(totals.total), gov: Math.round(totals.govTotal),
      expenses: Math.round(totals.expensesTotal), savings: Math.round(totals.savingsTotal),
    };
    for (const p of cur.partners) {
      row[`inleg_${p.id}`] = Math.round(totals.transfers[p.id] || 0);
      const own = personalTotals(data.months[m], totals, p.id);
      row[`free_${p.id}`] = Math.round(own.free);
      row[`ownsav_${p.id}`] = Math.round(own.savTotal);
    }
    return row;
  }), [sortedMonths, data.months, cur.partners]);

  const statsSeries = useMemo(() => series.filter((s) => (!statsFrom || s.key >= statsFrom) && (!statsTo || s.key <= statsTo)), [series, statsFrom, statsTo]);
  const statsFiltered = Boolean(statsFrom || statsTo);

  const byCategoryOf = (list) => {
    const map = {};
    for (const e of list) map[e.category || TXT.otherCategory] = (map[e.category || TXT.otherCategory] || 0) + monthlyOf(e, cur);
    return Object.entries(map).sort((x, y) => y[1] - x[1]);
  };
  const byCategory = useMemo(() => byCategoryOf(cur.expenses), [cur]);

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

  // ── Search / filter ──
  // A free-text query, matched word by word against name, category, note,
  // correspondent, link and amount, plus an optional expense-category chip.
  // Purely a view filter: totals, the split and storage are never affected.
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState(null);
  const searchRef = useRef(null);
  const queryWords = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const filtering = queryWords.length > 0 || catFilter != null;
  const matchesFilter = (e) => {
    if (catFilter != null && !("category" in e && (e.category || TXT.otherCategory) === catFilter)) return false;
    if (!queryWords.length) return true;
    const hay = [e.name, e.label, e.category, e.note, e.correspondent, e.url, e.amount, e.income]
      .filter((v) => v != null && v !== "").join(" ").toLowerCase();
    return queryWords.every((w) => hay.includes(w));
  };
  const clearFilter = () => { setQuery(""); setCatFilter(null); };
  // A category chip belongs to the list it was picked from, so drop it when switching pages.
  useEffect(() => { setCatFilter(null); }, [view]);
  // "/" focuses the search field, unless you're already typing somewhere.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const visiblePartners = cur.partners.map((p, i) => ({ p, i })).filter(({ p }) => matchesFilter(p));
  const visibleGov = sortedGovIncome.filter(matchesFilter);
  const visibleExpenses = sortedExpenses.filter(matchesFilter);
  const visibleSavings = sortedSavings.filter(matchesFilter);

  // Contracts (of any kind: income, gov income, expenses, savings) that are
  // expired or about to expire for the selected month, surfaced as a banner
  // at the top of the page so they aren't only visible on hover.
  const contractWarnings = useMemo(() => {
    const entries = [
      ...cur.partners.map((p, i) => ({ ...p, label: p.name || t(LANG, "personName", { n: i + 1 }) })),
      ...cur.govIncome.map((g) => ({ ...g, label: g.label || TXT.unnamed })),
      ...cur.expenses.map((e) => ({ ...e, label: e.label || TXT.unnamed })),
      ...cur.savings.map((s) => ({ ...s, label: s.label || TXT.unnamed })),
      // Personal entries too — an own subscription running out matters just as much.
      ...cur.partners.flatMap((p, i) => PERSONAL_KINDS.flatMap((kind) => listAt(cur, kind, p.id).map((e) => ({ ...e, label: `${p.name || t(LANG, "personName", { n: i + 1 })} · ${e.label || TXT.unnamed}` })))),
      // Deposits whose term ends (on the 1st of their end month) — the money
      // needs a new destination then. Only shown up to a month after the end,
      // after that it's no news anymore.
      ...(data.savingsGoals || []).flatMap((g) => (g.subAccounts || []).filter((x) => depositEnd(x)).map((x) => ({
        id: x.id, label: accountName(x), endDate: `${depositEnd(x)}-01`, recentOnly: true,
      }))),
    ];
    return entries.map((entry) => {
      const left = daysUntil(entry.endDate);
      if (left == null) return null;
      if (entry.recentOnly && left < -CONTRACT_WARNING_DAYS) return null;
      const warningDays = entry.warningDays ? num(entry.warningDays) : CONTRACT_WARNING_DAYS;
      const expired = left < 0;
      const endingSoon = left >= 0 && left <= warningDays;
      if (!expired && !endingSoon) return null;
      const status = expired ? t(LANG, "contractExpired", { days: Math.abs(left) }) : t(LANG, "contractEndingSoon", { days: left });
      return { id: entry.id, label: entry.label, status, expired };
    }).filter(Boolean).sort((a, b) => (a.expired === b.expired ? 0 : a.expired ? -1 : 1));
  }, [cur, data.savingsGoals]);

  // Drag-and-drop reordering — only available while a section's sort mode is "manual".
  // Reordering changes the entry order for the selected month only; it does not
  // forward-propagate like value edits do, since order isn't a per-entry field.
  const [dragItem, setDragItem] = useState(null);
  // `personId` scopes reordering/dragging to one person's personal-expense
  // list (kind in PERSONAL_KINDS); null for every other (flat) list.
  const reorderListItem = (kind, dragId, dropId, personId = null) => setData((d) => {
    const s = d.selectedMonth;
    const list = listAt(d.months[s], kind, personId);
    const from = list.findIndex((x) => x.id === dragId), to = list.findIndex((x) => x.id === dropId);
    if (from === -1 || to === -1 || from === to) return d;
    const next = list.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return { ...d, months: { ...d.months, [s]: withList(d.months[s], kind, personId, next) } };
  });
  const dragHandleProps = (kind, id, personId = null) => ({
    draggable: true,
    onDragStart: (e) => { setDragItem({ kind, id, personId }); e.dataTransfer.effectAllowed = "move"; },
    onDragEnd: () => setDragItem(null),
  });
  const dragRowProps = (kind, id, personId = null) => ({
    onDragOver: (e) => { if (dragItem?.kind === kind && dragItem?.personId === personId && dragItem.id !== id) e.preventDefault(); },
    onDrop: (e) => { if (dragItem?.kind !== kind || dragItem?.personId !== personId) return; e.preventDefault(); reorderListItem(kind, dragItem.id, id, personId); setDragItem(null); },
  });

  // Existing category names across all months, for autocomplete suggestions.
  const categories = useMemo(() => {
    const set = new Set();
    for (const m of Object.values(data.months)) for (const e of m.expenses) if (e.category) set.add(e.category);
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
      for (const kind of ["partners", "govIncome", "expenses", "savings"]) {
        for (const e of m[kind]) if (e.correspondent) set.add(e.correspondent);
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

  // `personId` scopes a lookup to one person's own list (kind in
  // PERSONAL_KINDS, see listAt); null for every other (flat) list.
  // History of one entry (matched by id) across all months, for the sparkline.
  const entryHistory = (kind, id, personId = null) => {
    const out = [];
    for (const m of sortedMonths) {
      const it = listAt(data.months[m], kind, personId).find((x) => x.id === id);
      if (!it) continue;
      const v = kind === "partners" ? monthlyInc(it) : monthlyOf(it, data.months[m]);
      out.push({ month: m, label: monthShort(m), value: Math.round(v) });
    }
    return out;
  };
  // ── Month comparison ──
  // Every entry is compared (by id) with the nearest existing month on
  // either side, so a difference shows right in the row (MonthRail) instead
  // of only after opening the sparkline. Entries that exist in a neighbour
  // month but not in this one show up as ghost rows (see renderGhosts).
  // Amounts compare as monthly values, so /mnd ↔ /jr alone isn't a change.
  const prevKey = pastMonths.length ? pastMonths[pastMonths.length - 1] : null;
  const nextKey = futureMonths.length ? futureMonths[0] : null;
  const valueOf = (kind, e, fig) => (kind === "partners" ? monthlyInc(e) : monthlyOf(e, fig));
  const compareSide = (key, kind, id, curVal, personId) => {
    if (!key) return null;
    const fig = data.months[key];
    const it = listAt(fig, kind, personId).find((x) => x.id === id);
    if (!it) return { key, status: "absent" };
    const value = valueOf(kind, it, fig);
    return { key, value, status: Math.abs(value - curVal) < 0.005 ? "same" : "changed" };
  };
  const neighbours = (kind, e, personId = null) => {
    const curVal = valueOf(kind, e, cur);
    return { cur: curVal, prev: compareSide(prevKey, kind, e.id, curVal, personId), next: compareSide(nextKey, kind, e.id, curVal, personId) };
  };
  // Months after the selected one that still contain this entry.
  const laterMonthsWith = (kind, id, personId = null) => futureMonths.filter((k) => listAt(data.months[k], kind, personId).some((x) => x.id === id));
  // Whole-month summary against both neighbours, over every list (personal
  // ones included): which entries are only here, only there, or differ.
  const monthDiff = useMemo(() => {
    const sectionOf = (kind, personId, fig) => {
      if (!PERSONAL_KINDS.includes(kind)) return { partners: TXT.salarySection, govIncome: TXT.government, expenses: TXT.fixedCosts, savings: TXT.savingsSection }[kind];
      const i = fig.partners.findIndex((p) => p.id === personId);
      const who = (i >= 0 && fig.partners[i].name) || t(LANG, "personName", { n: i + 1 });
      return kind === "personalSavings" ? `${who} · ${TXT.savingsSection}` : who;
    };
    const entriesOf = (fig) => [
      ...fig.partners.map((e) => ({ kind: "partners", personId: null, e })),
      ...entryKinds.flatMap((kind) => (fig[kind] || []).map((e) => ({ kind, personId: null, e }))),
      ...PERSONAL_KINDS.flatMap((kind) => Object.entries(fig[kind] || {}).flatMap(([personId, list]) => list.map((e) => ({ kind, personId, e })))),
    ].map((x) => ({ ...x, label: x.e.label || x.e.name || TXT.unnamed, section: sectionOf(x.kind, x.personId, fig), value: valueOf(x.kind, x.e, fig) }));
    const diff = (key) => {
      if (!key) return null;
      const out = { key, onlyHere: [], onlyThere: [], changed: [] };
      for (const x of entriesOf(cur)) {
        const side = compareSide(key, x.kind, x.e.id, x.value, x.personId);
        if (side.status === "absent") out.onlyHere.push(x);
        else if (side.status === "changed") out.changed.push({ ...x, other: side.value });
      }
      for (const x of entriesOf(data.months[key])) {
        if (!listAt(cur, x.kind, x.personId).some((y) => y.id === x.e.id)) out.onlyThere.push(x);
      }
      return out;
    };
    return { prev: diff(prevKey), next: diff(nextKey) };
  }, [data.months, sel]);

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
  const deleteMonth = (m) => {
    if (!window.confirm(t(LANG, "confirmDeleteMonth", { month: monthLong(m) }))) return;
    setData((d) => {
      if (Object.keys(d.months).length <= 1) return d;
      const months = { ...d.months }; delete months[m];
      const remaining = Object.keys(months).sort();
      const selectedMonth = d.selectedMonth === m ? remaining[remaining.length - 1] : d.selectedMonth;
      return { ...d, selectedMonth, months };
    });
  };

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

  const setPartner = (id, patch) => editForward((f) => ({ ...f, partners: f.partners.map((p) => p.id === id ? { ...p, ...patch } : p) }), id);
  // Names belong to a person, not a month: change them in every month and persist.
  const setPartnerName = (id, name) => setData((d) => {
    const months = {};
    for (const [k, m] of Object.entries(d.months)) months[k] = { ...m, partners: m.partners.map((p) => p.id === id ? { ...p, name } : p) };
    return { ...d, months };
  });
  // A person's existence is structural, like their name — not a per-month
  // value — so it's set/removed across every month, not forward-propagated.
  const addPerson = () => {
    const id = uid();
    setData((d) => {
      const months = {};
      for (const [k, m] of Object.entries(d.months)) {
        months[k] = {
          ...m,
          partners: [...m.partners, { ...DEFAULT_PERSON, id }],
          customPct: { ...m.customPct, [id]: "" },
          personalExpenses: { ...m.personalExpenses, [id]: [] },
          personalSavings: { ...(m.personalSavings || {}), [id]: [] },
        };
      }
      return { ...d, months };
    });
  };
  const removePerson = (id) => {
    if (cur.partners.length <= 1) return;
    const i = cur.partners.findIndex((p) => p.id === id);
    const label = personName(cur.partners[i], i);
    if (!window.confirm(t(LANG, "confirmRemovePerson", { name: label }))) return;
    setData((d) => {
      const months = {};
      for (const [k, m] of Object.entries(d.months)) {
        const { [id]: _p1, ...restPersonal } = m.personalExpenses;
        const { [id]: _p2, ...restCustomPct } = m.customPct;
        const { [id]: _p3, ...restSavings } = m.personalSavings || {};
        months[k] = { ...m, partners: m.partners.filter((p) => p.id !== id), personalExpenses: restPersonal, personalSavings: restSavings, customPct: restCustomPct };
      }
      return { ...d, months };
    });
  };
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

  const togglePartnerPeriod = (id) => editForward((f) => ({ ...f, partners: f.partners.map((p) => p.id === id ? { ...p, period: p.period === "year" ? "month" : "year", income: flip(p.income, p.period) } : p) }), id);
  const setMethod = (method) => editForward((f) => ({ ...f, method }), "__method");
  const setMarge = (margePct) => editForward((f) => ({ ...f, margePct }), "__marge");
  // One override key per person, so editing one person's % doesn't lock the others' out of forward-propagation.
  const setCustomPct = (personId, value) => editForward((f) => ({ ...f, customPct: { ...f.customPct, [personId]: value } }), `__customPct_${personId}`);
  // Not cloned: patch is always a fresh object from the caller, and JSON-cloning would
  // silently drop keys explicitly set to `undefined` (e.g. clearing a formula), since
  // JSON.stringify omits undefined values instead of preserving them.
  const setListItem = (k, id, patch) => editForward((f) => ({ ...f, [k]: f[k].map((x) => x.id === id ? { ...x, ...patch } : x) }), id);
  const toggleItemPeriod = (k, id) => editForward((f) => ({ ...f, [k]: f[k].map((x) => x.id === id ? { ...x, period: x.period === "year" ? "month" : "year", amount: flip(x.amount, x.period) } : x) }), id);
  const addListItem = (kind, item) => editForward((f) => (
    (f[kind] || []).some((x) => x.id === item.id) ? f : { ...f, [kind]: [...(f[kind] || []), clone(item)] }
  ), item.id);
  const addGov = () => addListItem("govIncome", { id: uid(), label: "", amount: "", period: "month", note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" });
  const addExpense = () => addListItem("expenses", { id: uid(), category: "", label: "", amount: "", period: "month", note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" });
  const addSaving = () => addListItem("savings", { id: uid(), label: "", amount: "", period: "month", note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" });
  // The personal lists are one level deeper (keyed by person id) than the flat
  // lists above, so it gets its own small set of mutators rather than
  // threading an extra key through the generic ones.
  const setPersonalItem = (kind, personId, id, patch) => editForward((f) => withList(f, kind, personId, listAt(f, kind, personId).map((x) => x.id === id ? { ...x, ...patch } : x)), id);
  const togglePersonalItemPeriod = (kind, personId, id) => editForward((f) => withList(f, kind, personId, listAt(f, kind, personId).map((x) => x.id === id ? { ...x, period: x.period === "year" ? "month" : "year", amount: flip(x.amount, x.period) } : x)), id);
  // Removing an entry is scoped explicitly instead of following
  // editForward's override rules: an entry that still exists in later
  // months asks whether to remove it only here or here and onwards
  // (DeleteScopeDialog), since a silently surviving copy in some later
  // month is easy to miss.
  const removeEntryFrom = (kind, id, keys, personId = null) => setData((d) => {
    const months = { ...d.months };
    for (const k of keys) {
      const fig = months[k];
      if (!fig) continue;
      months[k] = withList(fig, kind, personId, listAt(fig, kind, personId).filter((x) => x.id !== id));
    }
    return { ...d, months };
  });
  const [pendingDelete, setPendingDelete] = useState(null);
  const requestDelete = (kind, e, personId = null) => {
    const later = laterMonthsWith(kind, e.id, personId);
    if (!later.length) removeEntryFrom(kind, e.id, [sel], personId);
    else setPendingDelete({ kind, id: e.id, personId, label: e.label || TXT.unnamed, later });
  };
  const confirmDelete = (forward) => {
    const { kind, id, personId, later } = pendingDelete;
    removeEntryFrom(kind, id, forward ? [sel, ...later] : [sel], personId);
    setPendingDelete(null);
  };
  // Amounts: typing changes only the selected month (marked overridden);
  // on blur, if later months hold this entry with a different amount, a
  // dialog asks whether to apply the new amount there too, so a change is
  // never silently left behind in (or pushed into) later months.
  const amountField = (kind) => (kind === "partners" ? "income" : "amount");
  const setAmountHere = (kind, id, value, personId = null) => setData((d) => {
    const s = d.selectedMonth, fig = d.months[s], field = amountField(kind);
    const list = listAt(fig, kind, personId).map((x) => x.id === id ? { ...x, [field]: value } : x);
    const next = withList(fig, kind, personId, list);
    return { ...d, months: { ...d.months, [s]: markOverride(next, id) } };
  });
  const [pendingAmount, setPendingAmount] = useState(null);
  const commitAmount = (kind, e, personId, logLabel, oldV, newV) => {
    logChange(logLabel, oldV, newV);
    const curVal = valueOf(kind, e, cur);
    const later = laterMonthsWith(kind, e.id, personId).filter((k) => compareSide(k, kind, e.id, curVal, personId).status === "changed");
    if (later.length) setPendingAmount({ kind, id: e.id, personId, label: e.label || e.name || TXT.unnamed, amount: eur(curVal), later });
  };
  const confirmAmount = (forward) => {
    const { kind, id, personId, later } = pendingAmount;
    setPendingAmount(null);
    if (!forward) return;
    const field = amountField(kind);
    setData((d) => {
      const item = listAt(d.months[d.selectedMonth], kind, personId).find((x) => x.id === id);
      if (!item) return d;
      const months = { ...d.months };
      for (const k of later) {
        const fig = months[k];
        const list = listAt(fig, kind, personId).map((x) => x.id === id ? { ...x, [field]: item[field], period: item.period } : x);
        months[k] = withList(fig, kind, personId, list);
      }
      return { ...d, months };
    });
  };
  // Put a ghost row's entry (from a neighbour month) back into this month
  // only; marked overridden so an edit in an earlier month leaves it alone.
  const restoreEntry = (kind, entry, personId = null) => setData((d) => {
    const s = d.selectedMonth, fig = d.months[s];
    if (listAt(fig, kind, personId).some((x) => x.id === entry.id)) return d;
    const next = withList(fig, kind, personId, [...listAt(fig, kind, personId), clone(entry)]);
    return { ...d, months: { ...d.months, [s]: markOverride(next, entry.id) } };
  });
  // One id for both the entry and its override key (they used to be two separate uid() calls).
  const addPersonalExpense = (personId) => {
    const id = uid();
    editForward((f) => withList(f, "personalExpenses", personId, [...listAt(f, "personalExpenses", personId), { id, category: "", label: "", amount: "", period: "month", note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" }]), id);
  };
  const addPersonalSaving = (personId) => {
    const id = uid();
    editForward((f) => withList(f, "personalSavings", personId, [...listAt(f, "personalSavings", personId), { id, label: "", amount: "", period: "month", note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" }]), id);
  };
  const copyPersonalEntryRange = (kind, personId, id, pastKeys, futureKeys) => setData((d) => {
    const s = d.selectedMonth;
    const item = listAt(d.months[s], kind, personId).find((x) => x.id === id);
    if (!item) return d;
    const targets = new Set([...(pastKeys || []), ...(futureKeys || [])]);
    const months = { ...d.months };
    for (const k of targets) {
      if (k === s || !months[k]) continue;
      const list = listAt(months[k], kind, personId);
      const exists = list.some((x) => x.id === id);
      let nextList;
      if (item.formula) {
        nextList = exists
          ? list.map((x) => x.id === id ? { ...x, formula: clone(item.formula), period: item.period } : x)
          : [...list, clone(item)];
      } else if (exists) {
        nextList = list.map((x) => x.id === id ? { ...x, amount: item.amount, period: item.period } : x);
      } else {
        const bare = { ...clone(item), note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" };
        nextList = [...list, bare];
      }
      months[k] = withList(months[k], kind, personId, nextList);
    }
    return { ...d, months };
  });

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
    return [...goals, fn({ entryId, targetAmount: "", mainBank: "", forwarded: false, checkpoints: {}, subAccounts: [] })];
  };
  const updateGoal = (entryId, patch) => setData((d) => ({ ...d, savingsGoals: mapGoals(d, entryId, (g) => ({ ...g, ...patch })) }));
  const addSubAccount = (entryId, id = uid(), kind = "savings") => setData((d) => ({ ...d, savingsGoals: mapGoals(d, entryId, (g) => ({ ...g, forwarded: true, subAccounts: [...g.subAccounts, { id, kind, holder: "", bank: "", iban: "", planId: "", referenceId: "", sharePercent: "100", interestRate: "", transferMode: "amount", transferAmounts: {}, transferDay: "", ownerId: "", depositAmount: "", termStart: kind === "deposit" ? d.selectedMonth : "", termMonths: kind === "deposit" ? "12" : "", checkpoints: {} }] })) }));
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
        fresh.partners = fresh.partners.map((p) => ({ ...p, name: d.months[s]?.partners?.find((x) => x.id === p.id)?.name || p.name }));
      }
      return { ...d, months: { ...d.months, [s]: fresh } };
    });
  };
  const personName = (p, i) => p.name || t(LANG, "personName", { n: i + 1 });
  const personView = view.startsWith("person:") ? view.slice(7) : null;
  // The household month page and the personal pages share the "Maand" tab.
  const onMonthPage = view === "month" || Boolean(personView);
  // If the person currently being viewed gets removed, fall back to the
  // month view instead of rendering a blank/broken personal page.
  useEffect(() => {
    if (personView && !cur.partners.some((p) => p.id === personView)) setView("month");
  }, [personView, cur.partners]);
  const activePersonIndex = personView ? cur.partners.findIndex((p) => p.id === personView) : -1;
  const activePerson = activePersonIndex >= 0 ? cur.partners[activePersonIndex] : null;
  const activePersonExpenses = activePerson ? listAt(cur, "personalExpenses", activePerson.id) : [];
  const activePersonSavings = activePerson ? listAt(cur, "personalSavings", activePerson.id) : [];

  // Entries that exist in a neighbour month but not in this one, shown
  // faded under their list with one-tap fixes for the usual causes: removed
  // here but forgotten in later months, or added later and wanted here too.
  const renderGhosts = (kind, personId = null) => {
    if (filtering) return null;
    const here = new Set(listAt(cur, kind, personId).map((x) => x.id));
    const seen = new Set();
    const rows = [];
    for (const key of [prevKey, nextKey]) {
      if (!key) continue;
      for (const e of listAt(data.months[key], kind, personId)) {
        if (here.has(e.id) || seen.has(e.id)) continue;
        seen.add(e.id);
        rows.push({ key, e, value: valueOf(kind, e, data.months[key]), later: laterMonthsWith(kind, e.id, personId) });
      }
    }
    return rows.map(({ key, e, value, later }) => {
      const fromPast = key < sel;
      const text = !later.length ? t(LANG, "ghostGone", { month: monthShortWithYear(key), current: monthShortWithYear(sel) })
        : fromPast ? t(LANG, "ghostGap", { current: monthShortWithYear(sel), range: monthRange(later) })
        : t(LANG, "ghostAppears", { month: monthShortWithYear(later[0]) });
      return (
        <div key={e.id} style={St.ghostRow}>
          <div style={St.ghostHead}>
            <span style={St.ghostLabel}>{e.label || TXT.unnamed}</span>
            <span style={St.ghostAmount}>{eur(value)}</span>
          </div>
          <div style={St.ghostMeta}>
            <span style={{ flex: "1 1 160px" }}>{text}</span>
            <button type="button" onClick={() => restoreEntry(kind, e, personId)} style={St.ghostBtn}>{fromPast ? TXT.ghostRestore : TXT.ghostAddHere}</button>
            {later.length > 0 && <button type="button" onClick={() => removeEntryFrom(kind, e.id, later, personId)} style={{ ...St.ghostBtn, color: C.exp }}>{TXT.ghostRemoveLater}</button>}
          </div>
        </div>
      );
    });
  };

  // ── Entry rows and the detail panel ──
  // A row shows only what you scan for (name, category, amount and how it
  // compares to the neighbour months); everything else about an entry
  // (contract, note, link, correspondent, formula, history, copy, delete)
  // lives in one detail panel: a side panel on wide screens, a bottom sheet
  // on phones. Clicking a row (outside its inputs) opens it.
  const [detail, setDetail] = useState(null);
  const openDetail = (kind, id, personId = null) => setDetail({ kind, id, personId });
  const closeDetail = () => setDetail(null);
  const detailEntry = detail ? listAt(cur, detail.kind, detail.personId).find((x) => x.id === detail.id) : null;
  // Close once the entry is gone (deleted, or absent in the month switched to).
  useEffect(() => { if (detail && !detailEntry) setDetail(null); }, [detail, detailEntry]);
  useEffect(() => {
    if (!detail) return;
    const onKey = (e) => { if (e.key === "Escape") setDetail(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  const sectionLabel = (kind, personId) => personId
    ? `${personName(cur.partners.find((p) => p.id === personId) || {}, cur.partners.findIndex((p) => p.id === personId))}${kind === "personalSavings" ? ` · ${TXT.savingsSection}` : ""}`
    : { partners: TXT.salarySection, govIncome: TXT.government, expenses: TXT.expensesSection, savings: TXT.savingsSection }[kind];
  // Personal expenses are one level deeper (keyed by person id) and people
  // have their own mutators, so the right set is picked once per kind here.
  const entryOps = (kind, personId) => {
    const set = kind === "partners" ? (id, patch) => setPartner(id, patch)
      : personId ? (id, patch) => setPersonalItem(kind, personId, id, patch)
      : (id, patch) => setListItem(kind, id, patch);
    return {
      set,
      setName: kind === "partners" ? (id, v) => setPartnerName(id, v) : (id, v) => set(id, { label: v }),
      togglePeriod: kind === "partners" ? (id) => togglePartnerPeriod(id)
        : personId ? (id) => togglePersonalItemPeriod(kind, personId, id)
        : (id) => toggleItemPeriod(kind, id),
      copyRange: personId ? (id, pk, fk) => copyPersonalEntryRange(kind, personId, id, pk, fk) : (id, pk, fk) => copyEntryRange(kind, id, pk, fk),
    };
  };
  const hasCategory = (kind) => kind === "expenses" || kind === "personalExpenses";
  const entryName = (kind, e, index) => (kind === "partners" ? personName(e, index) : e.label || TXT.unnamed);
  const amountProps = (kind, e, personId, index) => {
    const ops = entryOps(kind, personId);
    return {
      value: kind === "partners" ? e.income : e.formula ? String(round2(entryAmount(e, cur))) : e.amount,
      period: e.period,
      onValue: (v) => setAmountHere(kind, e.id, v, personId),
      onPeriod: () => ops.togglePeriod(e.id),
      onCommit: (o, n) => commitAmount(kind, kind === "partners" ? { ...e, name: personName(e, index) } : e, personId, `${sectionLabel(kind, personId)} · ${entryName(kind, e, index)}`, o, n),
      disabled: Boolean(e.formula),
    };
  };

  const renderRow = (kind, e, { personId = null, index = -1, total = 0, manual = false } = {}) => {
    const ops = entryOps(kind, personId);
    const isPerson = kind === "partners";
    const withCat = hasCategory(kind);
    const draggable = !isPerson && manual;
    const selected = detail?.kind === kind && detail?.id === e.id && detail?.personId === personId;
    const dragging = draggable && dragItem?.kind === kind && dragItem?.personId === personId && dragItem.id === e.id;
    const dot = isPerson ? personColor(e, index).main : kind === "govIncome" ? C.gov : (kind === "savings" || kind === "personalSavings") ? categoryColor(e.label) : categoryColor(e.category);
    const monthly = valueOf(kind, e, cur);
    const onRowClick = (ev) => { if (!ev.target.closest("input, button, select, textarea, a, [draggable]")) openDetail(kind, e.id, personId); };
    return (
      <div key={e.id} style={{ ...St.itemWrap, ...(dragging ? { opacity: 0.4 } : {}) }} className={`entryWrap${selected ? " selected" : ""}`}
        onClick={onRowClick} {...(draggable ? dragRowProps(kind, e.id, personId) : {})}>
        <div className="entry">
          <span className="e-lead">
            <DragHandle active={draggable} {...dragHandleProps(kind, e.id, personId)} />
            <span style={{ ...St.dot, background: dot }} title={withCat ? (e.category || TXT.otherCategory) : undefined} />
            {withCat && <input list="cats" aria-label={TXT.category} value={e.category} placeholder={TXT.categoryPlaceholder} onChange={(ev) => ops.set(e.id, { category: ev.target.value })} style={St.catInput} />}
          </span>
          <input className="e-desc" aria-label={isPerson ? t(LANG, "personName", { n: index + 1 }) : TXT.description}
            value={isPerson ? e.name : e.label} placeholder={isPerson ? t(LANG, "personPlaceholder", { n: index + 1 }) : TXT.descriptionPlaceholder}
            onChange={(ev) => ops.setName(e.id, ev.target.value)} style={{ ...St.nameInput, ...(isPerson ? { fontWeight: 600 } : {}) }} />
          <span className="e-amount"><AmountField {...amountProps(kind, e, personId, index)} /></span>
          <button type="button" className="entryOpen" aria-label={t(LANG, "openDetails", { name: entryName(kind, e, index) })} aria-expanded={selected}
            onClick={() => (selected ? closeDetail() : openDetail(kind, e.id, personId))} style={{ ...St.iconBtn, color: selected ? C.b : C.muted }}>
            <ChevronRight size={18} />
          </button>
        </div>
        <DerivedLine monthly={monthly} period={e.period} percent={pctOf(monthly, total)} correspondent={e.correspondent} compare={neighbours(kind, e, personId)}
          dot={!withCat} category={withCat ? e.category || TXT.otherCategory : null} entry={e} />
      </div>
    );
  };

  const renderDrawer = () => {
    if (!detailEntry) return null;
    const { kind, personId } = detail;
    const e = detailEntry;
    const ops = entryOps(kind, personId);
    const isPerson = kind === "partners";
    const index = isPerson ? cur.partners.findIndex((p) => p.id === e.id) : -1;
    const monthly = valueOf(kind, e, cur);
    const other = e.period === "year" ? `= ${eur(monthly)} ${TXT.perMonth}` : `= ${eur(monthly * 12)} ${TXT.perYear}`;
    const canDelete = !isPerson || cur.partners.length > 1;
    const section = (title, body) => <section style={St.drawerSection}><div style={St.drawerLabel}>{title}</div>{body}</section>;
    return (
      <React.Fragment key={`${kind}-${personId || ""}-${e.id}`}>
        <div className="drawerBackdrop" onClick={closeDetail} />
        <aside className="drawer" role="dialog" aria-label={entryName(kind, e, index)} style={St.drawer}>
          <div style={St.drawerHead}>
            <span style={St.drawerCrumb}>{sectionLabel(kind, personId)}{hasCategory(kind) && e.category ? ` · ${e.category}` : ""} · {monthLong(sel)}</span>
            <button type="button" onClick={closeDetail} style={St.iconBtn} aria-label={TXT.close}><X size={18} /></button>
          </div>
          {historyLocked && <div style={{ ...St.historyBanner, marginTop: 4 }}><span>{TXT.historyLockedHint}</span></div>}
          <div inert={historyLocked ? "" : undefined} style={historyLocked ? { opacity: 0.6 } : undefined}>
            <input value={isPerson ? e.name : e.label} placeholder={isPerson ? t(LANG, "personPlaceholder", { n: index + 1 }) : TXT.descriptionPlaceholder}
              onChange={(ev) => ops.setName(e.id, ev.target.value)} style={St.drawerTitle} className="drawerTitle" aria-label={TXT.description} />
            {hasCategory(kind) && (
              <label style={{ ...St.drawerSub, marginBottom: 10 }}>{TXT.category}
                <input list="cats" value={e.category} placeholder={TXT.categoryPlaceholder} onChange={(ev) => ops.set(e.id, { category: ev.target.value })} style={St.drawerInput} />
              </label>
            )}
            <div style={St.drawerAmountRow}>
              <AmountField {...amountProps(kind, e, personId, index)} />
              <span style={St.drawerMuted}>{other}</span>
            </div>
            <div style={{ ...St.derived, marginTop: 6 }}><MonthRail {...neighbours(kind, e, personId)} /></div>
            {section(TXT.priceTrend, <Sparkline data={entryHistory(kind, e.id, personId)} />)}
            {section(TXT.duration, <DurationEditor entry={e} onChange={(patch) => ops.set(e.id, patch)} />)}
            {section(TXT.note, <NoteEditor value={e.note || ""} onChange={(v) => ops.set(e.id, { note: v })} />)}
            {section(TXT.link, <LinkEditor value={e.url || ""} onChange={(v) => ops.set(e.id, { url: v })} />)}
            {PAPERLESS_ENABLED && section(TXT.correspondent, <CorrespondentEditor entry={e} onChange={(patch) => ops.set(e.id, patch)} onSync={syncCorrespondent} correspondents={paperlessCorrespondents} labels={paperlessLabels} />)}
            {!isPerson && section(TXT.sourceRule, <FormulaEditor entry={e} monthData={cur} onChange={(patch) => ops.set(e.id, patch)} />)}
            {section(TXT.copyAmount, <CopyPicker pastMonths={pastMonths} futureMonths={futureMonths} onCopy={(pk, fk) => ops.copyRange(e.id, pk, fk)} emptyText={TXT.noMonthsToCopy} />)}
            {canDelete && (
              <button type="button" onClick={() => (isPerson ? removePerson(e.id) : requestDelete(kind, e, personId))} style={St.drawerDelete}>
                <Trash2 size={15} /> {isPerson ? TXT.removePerson : TXT.delete}
              </button>
            )}
          </div>
        </aside>
      </React.Fragment>
    );
  };

  // Shared by the joint "Vaste lasten" section and each partner's personal
  // page — same fields, same behavior (sorting, drag reorder, formulas,
  // correspondent/paperless, trend/sparkline, per-entry copy-forward), just
  // scoped to a different list (`kind`) and its own subtotal/category split.
  const renderExpensesList = (kind, items, total, byCat, onAdd, personId = null) => {
    const manual = listSort[kind] === "manual";
    const shown = filtering ? items.filter(matchesFilter) : items;
    return (
      <>
        {items.length > 1 && <SortToggle kind={kind} mode={listSort[kind]} onChange={(m) => setListSort(kind, m)} />}
        {shown.map((e) => renderRow(kind, e, { personId, total, manual }))}
        {renderGhosts(kind, personId)}
        {!filtering && <button type="button" onClick={onAdd} style={St.addBtn}><Plus size={16} /> {TXT.addExpense}</button>}
        {!filtering && byCat.length > 0 && (
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
        {filtering && <FilterSum count={shown.length} total={items.length} monthly={sumM(shown, cur)} />}
        <SubTotal monthly={total} />
      </>
    );
  };

  // Category chips for whichever expense list the current page shows.
  const chipCategories = [...new Set((activePerson ? activePersonExpenses : cur.expenses).map((e) => e.category || TXT.otherCategory))].sort((a, b) => a.localeCompare(b));
  const searchable = view === "month" || Boolean(activePerson);
  const noMatches = filtering && (activePerson
    ? !(activePersonExpenses.some(matchesFilter) || activePersonSavings.some(matchesFilter) || matchesFilter(activePerson))
    : !(visiblePartners.length || visibleGov.length || visibleExpenses.length || visibleSavings.length));
  const noMatchesBlock = (
    <div style={St.emptyHist}>
      <Search size={18} style={{ color: C.muted, flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{t(LANG, "noMatches", { month: monthLong(sel) })}</span>
      <button type="button" onClick={clearFilter} style={St.historyBannerBtn}>{TXT.clearFilter}</button>
    </div>
  );

  // ── Render ──
  return (
    <div style={St.page} className="page">
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

        {loadError && (
          <div style={St.errorBanner} role="alert">
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ flex: 1 }}>{TXT.loadFailed}</span>
            <button type="button" onClick={() => setLoadAttempt((n) => n + 1)} style={St.historyBannerBtn}>{TXT.retry}</button>
          </div>
        )}

        <header style={St.header} className="appHeader">
          <div style={St.headerTop}>
            <h1 style={St.h1} className="appTitle">{APP_TITLE}</h1>
            <button type="button" onClick={toggleTheme} style={St.themeBtn} aria-label={t(LANG, "themeToggle", { theme: theme === "dark" ? TXT.themeLight : TXT.themeDark })}>
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} <span className="themeLabel">{theme === "dark" ? TXT.themeLight : TXT.themeDark}</span>
            </button>
          </div>
          <div style={St.navRow}>
            <div style={St.toggle} className="viewTabs" role="group" aria-label={TXT.viewToggleAria}>
              {[["month", TXT.monthView], ["savings", TXT.savingsOverviewView], ["cashflow", TXT.cashflowView], ["history", TXT.historyView]].map(([v, label]) => {
                const on = v === "month" ? onMonthPage : view === v;
                return <button key={v} type="button" aria-pressed={on} onClick={() => { if (!on) setView(v); }} style={{ ...St.toggleBtn, ...(on ? St.toggleOn : {}) }}>{label}</button>;
              })}
            </div>
            {onMonthPage && (
              <div style={St.viewAs} className="viewAs" role="group" aria-label={TXT.viewAs}>
                <span style={St.viewAsLabel} className="viewAsLabel">{TXT.viewAs}</span>
                <button type="button" aria-pressed={view === "month"} onClick={() => setView("month")} style={{ ...St.viewAsBtn, ...(view === "month" ? St.viewAsOn : {}) }}>
                  <span style={{ ...St.avatar, background: C.ink, color: C.card }}><Users size={14} /></span>{TXT.household}
                </button>
                {cur.partners.map((p, i) => {
                  const on = personView === p.id;
                  return (
                    <button key={p.id} type="button" aria-pressed={on} title={personName(p, i)} onClick={() => setView(`person:${p.id}`)} style={{ ...St.viewAsBtn, ...(on ? St.viewAsOn : { padding: 3 }) }}>
                      <span style={{ ...St.avatar, background: personColor(p, i).main, opacity: on ? 1 : 0.6 }}>{(personName(p, i)[0] || "?").toUpperCase()}</span>
                      {on && personName(p, i)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </header>

        {/* Month — shared by every page. The native <select> is laid
            invisibly over the month label, so clicking the label opens the
            month picker. On phones (≤640px CSS) this becomes one sticky row. */}
        <div style={St.monthNav} className={`fade monthNav${isCurrentRealMonth ? " isCurrent" : ""}`}>
          <button type="button" onClick={() => goMonth(-1)} style={St.navBtn} className="navPrev" aria-label={TXT.previousMonth}><ChevronLeft size={18} /></button>
          <div style={St.monthLabelWrap} className="monthLabelWrap">
            <span style={St.monthLabel}>{monthLong(sel)}</span>
            {isCurrentRealMonth && <span style={St.nowTag}>{TXT.nowTag}</span>}
            <ChevronDown size={16} style={{ color: C.muted, flexShrink: 0 }} />
            <select value={sel} onChange={(e) => setData((d) => ({ ...d, selectedMonth: e.target.value }))} style={St.monthSelect} aria-label={TXT.chooseMonth}>
              {sortedMonths.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
          </div>
          <button type="button" onClick={() => goMonth(1)} style={St.navBtn} className="navNext" aria-label={TXT.nextMonth}><ChevronRight size={18} /></button>
          {!isCurrentRealMonth && <button type="button" onClick={goCurrent} style={St.currentBtn} className="currentBtn">{TXT.currentMonth}</button>}
          <span style={{ flex: 1 }} className="navSpacer" />
          <MonthActions pastMonths={pastMonths} futureMonths={futureMonths} printing={Boolean(printJob)} canDelete={sortedMonths.length > 1}
            onCopy={(pk, fk) => copyMonth([...pk, ...fk])} onReset={resetMonth}
            onPrintMonth={() => setPrintJob({ type: "month", key: sel })} onPrintYear={() => setPrintJob({ type: "year", year: sel.slice(0, 4) })}
            onDelete={() => deleteMonth(sel)} />
        </div>

        {isHistoryMonth && (
          <div style={St.historyBanner} className="fade">
            <span>{historyLocked ? TXT.historyLockedHint : TXT.historyUnlockedHint}</span>
            <button type="button" onClick={() => setUnlockedMonth(historyLocked ? sel : null)} style={St.historyBannerBtn}>
              {historyLocked ? TXT.historyUnlockBtn : TXT.historyLockBtn}
            </button>
          </div>
        )}

        {view === "month" && <ResultTiles partners={cur.partners} calc={calc} names={cur.partners.map((p, i) => personName(p, i))} />}

        {searchable && <MonthDiffSummary sel={sel} prev={monthDiff.prev} next={monthDiff.next} onGo={(key) => setData((d) => ({ ...d, selectedMonth: key }))} />}

        {searchable && (
          <SearchBar inputRef={searchRef} query={query} onQuery={setQuery} categories={chipCategories}
            catFilter={catFilter} onCat={setCatFilter} onClear={clearFilter} filtering={filtering} />
        )}

        {/* `inert` also blocks keyboard focus/editing, which pointer-events alone doesn't. */}
        <div style={historyLocked ? St.historyLockedContent : undefined} inert={historyLocked ? "" : undefined}>
        {view === "savings" ? (
          <SavingsOverviewPage
            savingsGoals={data.savingsGoals || []}
            months={data.months}
            partners={cur.partners}
            savingsGroups={[
              { id: "joint", title: TXT.household, color: C.ink, entries: cur.savings },
              ...cur.partners.map((p, i) => ({ id: p.id, title: personName(p, i), color: personColor(p, i).main, entries: listAt(cur, "personalSavings", p.id) })),
            ]}
            currentMonthData={cur}
            sel={sel}
            onUpdateGoal={updateGoal}
            onAddSubAccount={addSubAccount}
            onRemoveSubAccount={removeSubAccount}
            onUpdateSubAccount={updateSubAccount}
          />
        ) : view === "cashflow" ? (
          <CashflowPage cur={cur} calc={calc} />
        ) : view === "history" ? (
          <div className="fade">
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
                    {cur.partners.map((p, i) => (
                      <Bar key={p.id} dataKey={`inleg_${p.id}`} name={personName(p, i)} fill={personColor(p, i).main} radius={[4, 4, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Collapsible>
            <Collapsible id="statsPersonal" title={TXT.statsPersonal} open={open.statsPersonal} onToggle={toggleSec}>
              <ChartTitle>{TXT.personalFree}</ChartTitle>
              <div style={St.chartBox}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statsSeries} margin={{ top: 6, right: 4, left: -6, bottom: 0 }}>
                    <CartesianGrid stroke={C.line} vertical={false} />
                    <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
                    <YAxis tick={tick} axisLine={false} tickLine={false} width={58} tickFormatter={eur0} />
                    <Tooltip {...tooltipProps} /><Legend {...legendProps} />
                    {cur.partners.map((p, i) => (
                      <Bar key={p.id} dataKey={`free_${p.id}`} name={personName(p, i)} fill={personColor(p, i).main} radius={[4, 4, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ChartTitle>{TXT.kpiPersonSaves}</ChartTitle>
              <div style={St.chartBox}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statsSeries} margin={{ top: 6, right: 4, left: -6, bottom: 0 }}>
                    <CartesianGrid stroke={C.line} vertical={false} />
                    <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
                    <YAxis tick={tick} axisLine={false} tickLine={false} width={58} tickFormatter={eur0} />
                    <Tooltip {...tooltipProps} /><Legend {...legendProps} />
                    {cur.partners.map((p, i) => (
                      <Bar key={p.id} dataKey={`ownsav_${p.id}`} name={personName(p, i)} fill={personColor(p, i).main} radius={[4, 4, 0, 0]} />
                    ))}
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
          </div>
        ) : activePerson ? (() => {
          // The personal page mirrors the household one: income on the left,
          // the result ("where does my salary go") on the right, and the
          // person's own fixed costs and savings pots underneath — only
          // scoped to this one person and their own leftover.
          const pid = activePerson.id, pi = activePersonIndex;
          const color = personColor(activePerson, pi);
          const { income, transfer, leftover, expTotal, savTotal, free } = personalTotals(cur, calc, pid);
          const visibleOwnSavings = sortItems("personalSavings", activePersonSavings).filter(matchesFilter);
          const showIncome = !filtering || matchesFilter(activePerson);
          const showExp = !filtering || activePersonExpenses.some(matchesFilter);
          const showSav = !filtering || visibleOwnSavings.length > 0;
          return (
          <div className="fade">
            {!filtering && <PersonTiles color={color.main} transfer={transfer} income={income} expTotal={expTotal} savTotal={savTotal} free={free} />}
            {noMatches && noMatchesBlock}
            <div className={`monthGrid${filtering ? " single" : ""}`}>
            <div className="mg-inc">
            {showIncome && <ColTitle>{TXT.incomes}</ColTitle>}
            {showIncome && (
            <Collapsible id={`person-inc-${pid}`} title={TXT.salarySection} icon={<Wallet size={16} style={{ color: C.inc }} />} info={TXT.salary}
              total={eur(income)} open={filtering || (open[`person-inc-${pid}`] ?? true)} onToggle={toggleSec} style={St.sectionIncome}>
              {renderRow("partners", activePerson, { index: pi, total: income })}
              <SubTotal monthly={income} />
            </Collapsible>
            )}
            </div>

            {!filtering && (<div className="mg-res">
            <ColTitle>{TXT.personalResultSection}</ColTitle>
            <section style={St.hero} className="fade">
              <Bd label={TXT.salarySection} value={income} strong />
              <Bd label={t(LANG, "personalToJoint", { pct: pct(income > 0 ? transfer / income : 0) })} value={transfer} sign="− " color={color.main} />
              <div style={St.detailSubtotal}>
                <span style={St.detailSubtotalLabel}>{TXT.keepsLeft}</span>
                <span style={St.detailSubtotalValue}>{eur(leftover)}</span>
              </div>
              <Bd label={TXT.fixedCosts} value={expTotal} sign="− " color={C.exp} />
              <Bd label={TXT.savingsSection} value={savTotal} sign="− " color={C.save} />
              <div style={St.detailResult}>
                <span>{TXT.personalFree}</span>
                <span style={{ color: free < 0 ? C.exp : C.ink }}>{eur(free)}</span>
              </div>
              {income > 0 && (
                <SplitBar label={TXT.personalSplitLabel} segments={[
                  { id: "joint", name: TXT.personalSplitJoint, color: color.main, frac: transfer / income },
                  { id: "exp", name: TXT.fixedCosts, color: C.exp, frac: expTotal / income },
                  { id: "sav", name: TXT.savingsSection, color: C.save, frac: savTotal / income },
                  { id: "free", name: TXT.personalFree, color: C.line, frac: Math.max(0, free) / income },
                ]} />
              )}
              <div style={St.personalLegend}>
                {[[color.main, TXT.personalSplitJoint], [C.exp, TXT.fixedCosts], [C.save, TXT.savingsSection], [C.line, TXT.personalFree]].map(([c, l]) => (
                  <span key={l} style={St.personalLegendItem}><span style={{ ...St.catDot, background: c }} />{l}</span>
                ))}
              </div>
              {free < 0 && <div style={{ ...St.correspondentDocMuted, color: C.exp, marginTop: 8 }}>{TXT.personalOverspent}</div>}
              <div style={{ ...St.correspondentDocMuted, marginTop: 10 }}>{TXT.personalPageHint}</div>
            </section>
            </div>)}

            <div className="mg-exp">
            {(showExp || showSav) && <ColTitle>{TXT.expensesSection}</ColTitle>}
            {showExp && (
            <Collapsible id={`person-${pid}`} title={TXT.fixedCosts}
              icon={<Receipt size={16} style={{ color: C.exp }} />} info={TXT.exp}
              total={eur(expTotal)} open={filtering || (open[`person-${pid}`] ?? true)} onToggle={toggleSec} style={St.sectionExpenses}>
              {renderExpensesList("personalExpenses", sortItems("personalExpenses", activePersonExpenses), expTotal, byCategoryOf(activePersonExpenses), () => addPersonalExpense(pid), pid)}
            </Collapsible>
            )}
            {showSav && (
            <Collapsible id={`person-sav-${pid}`} title={TXT.savingsSection} icon={<PiggyBank size={16} style={{ color: C.save }} />} info={TXT.personalSav}
              total={eur(savTotal)} open={filtering || (open[`person-sav-${pid}`] ?? true)} onToggle={toggleSec} style={St.sectionExpenses}>
              {activePersonSavings.length > 1 && <SortToggle kind="personalSavings" mode={listSort.personalSavings} onChange={(m) => setListSort("personalSavings", m)} />}
              {visibleOwnSavings.map((e) => renderRow("personalSavings", e, { personId: pid, total: savTotal, manual: listSort.personalSavings === "manual" }))}
              {renderGhosts("personalSavings", pid)}
              {!filtering && <button type="button" onClick={() => addPersonalSaving(pid)} style={St.addBtn}><Plus size={16} /> {TXT.addSaving}</button>}
              {filtering && <FilterSum count={visibleOwnSavings.length} total={activePersonSavings.length} monthly={sumM(visibleOwnSavings, cur)} />}
              <SubTotal monthly={savTotal} />
            </Collapsible>
            )}
            </div>
            </div>
          </div>
          );
        })() : (
        <>
        {noMatches && noMatchesBlock}
        <div className={`monthGrid${filtering ? " single" : ""}`}>
        <div className="mg-inc">
        {(!filtering || visiblePartners.length > 0 || visibleGov.length > 0) && <ColTitle>{TXT.incomes}</ColTitle>}
        {/* Income */}
        {(!filtering || visiblePartners.length > 0) && (
        <Collapsible id="inkomen" title={TXT.salarySection} icon={<Wallet size={16} style={{ color: C.inc }} />} info={TXT.salary} total={eur(calc.total)} open={open.inkomen || filtering} onToggle={toggleSec} style={St.sectionIncome}>
          {visiblePartners.map(({ p, i }) => renderRow("partners", p, { index: i, total: calc.total }))}
          {!filtering && <button type="button" onClick={addPerson} style={St.addBtn}><Plus size={16} /> {TXT.addPerson}</button>}
          {filtering && <FilterSum count={visiblePartners.length} total={cur.partners.length} monthly={visiblePartners.reduce((sum, { p }) => sum + monthlyInc(p), 0)} />}
          <SubTotal monthly={calc.total} />
        </Collapsible>
        )}

        {/* Government */}
        {(!filtering || visibleGov.length > 0) && (
        <Collapsible id="overheid" title={TXT.government} icon={<Landmark size={16} style={{ color: C.gov }} />} info={TXT.gov} total={eur(calc.govTotal)} open={open.overheid || filtering} onToggle={toggleSec} style={St.sectionIncome}>
          {cur.govIncome.length > 1 && <SortToggle kind="govIncome" mode={listSort.govIncome} onChange={(m) => setListSort("govIncome", m)} />}
          {visibleGov.map((g) => renderRow("govIncome", g, { total: calc.govTotal, manual: listSort.govIncome === "manual" }))}
          {renderGhosts("govIncome")}
          {!filtering && <button type="button" onClick={addGov} style={St.addBtn}><Plus size={16} /> {TXT.addGovernment}</button>}
          {filtering && <FilterSum count={visibleGov.length} total={cur.govIncome.length} monthly={sumM(visibleGov, cur)} />}
          <SubTotal monthly={calc.govTotal} />
        </Collapsible>
        )}

        </div>
        {!filtering && (<div className="mg-res">
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
              {cur.partners.map((p, i) => (
                <React.Fragment key={p.id}>
                  <span style={St.customName}>{personName(p, i)}</span>
                  <div style={St.money}>
                    <input inputMode="decimal" value={cur.customPct[p.id] ?? ""}
                      onFocus={() => { customStart.current[p.id] = cur.customPct[p.id]; }}
                      onChange={(e) => setCustomPct(p.id, e.target.value.replace(/[^0-9.,]/g, ""))}
                      onBlur={() => { if (customStart.current[p.id] !== cur.customPct[p.id]) logChange(`${TXT.customPctLabel} · ${personName(p, i)}`, customStart.current[p.id], cur.customPct[p.id]); }}
                      style={{ ...St.moneyInput, width: 44 }} aria-label={t(LANG, "customPctAria", { name: personName(p, i) })} />
                    <span style={St.euro}>%</span>
                  </div>
                </React.Fragment>
              ))}
              <CustomPctRemaining pcts={cur.partners.map((p) => num(cur.customPct[p.id]))} />
            </div>
          )}

          <div style={St.contribGrid}>
            {cur.partners.map((p, i) => (
              <ContribCard key={p.id} name={personName(p, i)} color={personColor(p, i).main} soft={personColor(p, i).soft} amount={calc.transfers[p.id]} />
            ))}
          </div>

          <SplitBar label={TXT.incomeSplit} segments={cur.partners.map((p, i) => ({ id: p.id, name: personName(p, i), color: personColor(p, i).main, frac: calc.shares[p.id] }))} />
          <SplitBar label={TXT.contributionSplit} segments={cur.partners.map((p, i) => ({ id: p.id, name: personName(p, i), color: personColor(p, i).main, frac: calc.contribShares[p.id] }))} />

          <div style={St.leftLabel}>
            <span>{TXT.keepsLeft}</span>
            <span style={St.fairInline}>
              {cur.partners.map((p) => pct(calc.keeps[p.id])).join(" · ")}
              <InfoDot text={cur.method === "equal" ? TXT.fairEqual : cur.method === "custom" ? TXT.fairCustom : TXT.fair} align="right" />
            </span>
          </div>
          <div style={St.leftoverGrid}>
            {cur.partners.map((p, i) => (
              <LeftoverCard key={p.id} name={personName(p, i)} color={personColor(p, i).main} amount={calc.leftovers[p.id]} />
            ))}
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
        </div>)}

        <div className="mg-exp">
        {(!filtering || visibleExpenses.length > 0 || visibleSavings.length > 0) && <ColTitle>{TXT.expensesSection}</ColTitle>}
        {/* Expenses */}
        {(!filtering || visibleExpenses.length > 0) && (
        <Collapsible id="uitgaven" title={TXT.fixedCosts} icon={<Receipt size={16} style={{ color: C.exp }} />} info={TXT.exp} total={eur(calc.expensesTotal)} open={open.uitgaven || filtering} onToggle={toggleSec} style={St.sectionExpenses}>
          {renderExpensesList("expenses", sortedExpenses, calc.expensesTotal, byCategory, addExpense)}
        </Collapsible>
        )}

        {/* Savings goals */}
        {(!filtering || visibleSavings.length > 0) && (
        <Collapsible id="sparen" title={TXT.savingsSection} icon={<PiggyBank size={16} style={{ color: C.save }} />} info={TXT.sav} total={eur(calc.savingsTotal)} open={open.sparen || filtering} onToggle={toggleSec} style={St.sectionExpenses}>
          {cur.savings.length > 1 && <SortToggle kind="savings" mode={listSort.savings} onChange={(m) => setListSort("savings", m)} />}
          {visibleSavings.map((s) => renderRow("savings", s, { total: calc.savingsTotal, manual: listSort.savings === "manual" }))}
          {renderGhosts("savings")}
          {!filtering && <button type="button" onClick={addSaving} style={St.addBtn}><Plus size={16} /> {TXT.addSaving}</button>}
          {filtering && <FilterSum count={visibleSavings.length} total={cur.savings.length} monthly={sumM(visibleSavings, cur)} />}
          <SubTotal monthly={calc.savingsTotal} />
        </Collapsible>
        )}
        </div>
        </div>

        </>
        )}
        </div>

        <footer style={St.footer} className="appFooter">
          <span style={St.saveState}>
            {loadError ? (<><AlertTriangle size={14} style={{ color: C.exp }} /> {TXT.loadFailed.split(".")[0]}</>) : !loaded ? (<><Loader2 size={14} className="spin" /> {TXT.loading}</>) : saved ? (<><Check size={14} style={{ color: C.save }} /> {TXT.saved}</>) : (<><Loader2 size={14} className="spin" /> {TXT.saving}</>) }
          </span>
          <a href="https://github.com/x-real-ip/open-family-finance" target="_blank" rel="noopener noreferrer" style={St.githubLink} aria-label={TXT.sourceOnGitHub} title={TXT.sourceOnGitHub}>
            <Github size={16} />
          </a>
        </footer>
      </div>

      {/* Phone-only bottom tab bar (hidden ≥641px, where the header tabs show). */}
      <nav className="bottomNav" aria-label={TXT.viewToggleAria}>
        {[["month", CalendarDays, TXT.navMonth], ["savings", PiggyBank, TXT.navSavings], ["cashflow", Waypoints, TXT.navCashflow], ["history", History, TXT.navHistory]].map(([v, Icon, label]) => {
          const on = v === "month" ? onMonthPage : view === v;
          return (
            <button key={v} type="button" onClick={() => { if (!on) setView(v); window.scrollTo({ top: 0 }); }} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
              <Icon size={20} /><span>{label}</span>
            </button>
          );
        })}
      </nav>
      {pendingDelete && (
        <ScopeDialog icon={<Trash2 size={16} style={{ color: C.exp }} />} title={t(LANG, "deleteScopeTitle", { name: pendingDelete.label })}
          body={t(LANG, "deleteScopeBody", { range: monthRange(pendingDelete.later) })} month={sel} later={pendingDelete.later}
          thisLabel={TXT.deleteScopeThisMonth} forwardLabel={TXT.deleteScopeForward} danger
          onPick={confirmDelete} onCancel={() => setPendingDelete(null)} cancelLabel={TXT.cancel} />
      )}
      {pendingAmount && (
        <ScopeDialog icon={<CalendarDays size={16} style={{ color: C.b }} />} title={t(LANG, "amountScopeTitle", { name: pendingAmount.label })}
          body={t(LANG, "amountScopeBody", { amount: pendingAmount.amount, month: monthLong(sel), range: monthRange(pendingAmount.later) })} month={sel} later={pendingAmount.later}
          thisLabel={TXT.amountScopeThisMonth} forwardLabel={TXT.amountScopeForward}
          onPick={confirmAmount} onCancel={() => confirmAmount(false)} />
      )}
      {renderDrawer()}
      {printJob && <PrintDocument job={printJob} months={printMonths} appTitle={APP_TITLE} />}
    </div>
  );
}

// A plain, black-on-white "bank statement" rendering of one or twelve
// months — deliberately none of the app's own colors/charts/icons, since
// this exists purely as an offline, on-paper backup, not a nicer view of
// the data. Printed via window.print() (see the printJob effect in App),
// so this only needs to look right in print CSS; it's never shown on
// screen. A month never actually visited yet (the rest of a printed year)
// still gets its forward-filled figures via `months` (built with
// figuresFor), same numbers the app itself would show if you navigated
// there.
function PrintDocument({ job, months, appTitle }) {
  const title = job.type === "year" ? t(LANG, "printTitleYear", { year: job.year }) : TXT.printTitleMonth;
  return (
    <div className="print-root">
      <div style={pr.header}>
        <div style={pr.appTitle}>{appTitle}</div>
        <div style={pr.docTitle}>{title}</div>
        <div style={pr.meta}>{t(LANG, "printedOn", { date: dt(Date.now()) })}</div>
      </div>
      {months.map(({ key, fig, calc }, i) => (
        <PrintMonthSection key={key} monthKey={key} fig={fig} calc={calc} isLast={i === months.length - 1} />
      ))}
    </div>
  );
}

function PrintMonthSection({ monthKey: key, fig, calc, isLast }) {
  const people = fig.partners.map((p, i) => ({ ...p, income: calc.people[i]?.income ?? 0 }));
  const govRows = fig.govIncome.map((g) => ({ label: g.label || TXT.unnamed, amount: monthlyOf(g, fig) })).filter((r) => r.amount > 0);
  const expenseRows = fig.expenses.map((e) => ({ category: e.category || TXT.otherCategory, label: e.label || TXT.unnamed, amount: monthlyOf(e, fig) }));
  const savingsRows = fig.savings.map((s) => ({ label: s.label || TXT.unnamed, amount: monthlyOf(s, fig) }));
  const methodLabel = fig.method === "equal" ? TXT.equalMethod : fig.method === "custom" ? TXT.customMethod : TXT.incomeMethod;

  return (
    <section style={{ ...pr.section, ...(isLast ? {} : pr.pageBreak) }}>
      <h2 style={pr.monthTitle}>{monthLong(key)}</h2>

      <h3 style={pr.sectionTitle}>{TXT.incomes}</h3>
      <table style={pr.table}>
        <tbody>
          {people.map((p, i) => (
            <tr key={p.id}><td style={pr.td}>{p.name || t(LANG, "personName", { n: i + 1 })}</td><td style={pr.tdRight}>{eur(p.income)}</td></tr>
          ))}
          {govRows.map((r, i) => (
            <tr key={`gov-${i}`}><td style={pr.td}>{TXT.government}: {r.label}</td><td style={pr.tdRight}>{eur(r.amount)}</td></tr>
          ))}
          <tr><td style={pr.tdTotal}>{TXT.total}</td><td style={{ ...pr.tdRight, ...pr.tdTotal }}>{eur(calc.total + calc.govTotal)}</td></tr>
        </tbody>
      </table>

      <h3 style={pr.sectionTitle}>{TXT.allocationSection} — {methodLabel}</h3>
      <table style={pr.table}>
        <tbody>
          {people.map((p, i) => (
            <tr key={p.id}>
              <td style={pr.td}>{p.name || t(LANG, "personName", { n: i + 1 })}</td>
              <td style={pr.tdRight}>{eur(calc.transfers[p.id] || 0)}</td>
              <td style={pr.tdRightMuted}>{TXT.printLeftover} {eur(calc.leftovers[p.id] || 0)}</td>
            </tr>
          ))}
          <tr><td style={pr.tdTotal}>{TXT.coupleFunds}</td><td style={{ ...pr.tdRight, ...pr.tdTotal }}>{eur(calc.coupleFunds)}</td><td /></tr>
          <tr><td style={pr.td}>{t(LANG, "buffer", { pct: fig.margePct || "0" })}</td><td style={pr.tdRight}>{eur(calc.buffer)}</td><td /></tr>
        </tbody>
      </table>

      <h3 style={pr.sectionTitle}>{TXT.expensesSection}</h3>
      {expenseRows.length === 0 ? <div style={pr.empty}>{TXT.printNoEntries}</div> : (
        <table style={pr.table}>
          <tbody>
            {expenseRows.map((r, i) => (
              <tr key={i}><td style={pr.td}>{r.category}</td><td style={pr.td}>{r.label}</td><td style={pr.tdRight}>{eur(r.amount)}</td></tr>
            ))}
            <tr><td style={pr.tdTotal} colSpan={2}>{TXT.total}</td><td style={{ ...pr.tdRight, ...pr.tdTotal }}>{eur(calc.expensesTotal)}</td></tr>
          </tbody>
        </table>
      )}

      <h3 style={pr.sectionTitle}>{TXT.savingsSection}</h3>
      {savingsRows.length === 0 ? <div style={pr.empty}>{TXT.printNoEntries}</div> : (
        <table style={pr.table}>
          <tbody>
            {savingsRows.map((r, i) => (
              <tr key={i}><td style={pr.td}>{r.label}</td><td style={pr.tdRight}>{eur(r.amount)}</td></tr>
            ))}
            <tr><td style={pr.tdTotal}>{TXT.total}</td><td style={{ ...pr.tdRight, ...pr.tdTotal }}>{eur(calc.savingsTotal)}</td></tr>
          </tbody>
        </table>
      )}

      {people.map((p, i) => {
        const own = personalTotals(fig, calc, p.id);
        const exp = listAt(fig, "personalExpenses", p.id), sav = listAt(fig, "personalSavings", p.id);
        if (!exp.length && !sav.length) return null;
        return (
          <React.Fragment key={`own-${p.id}`}>
            <h3 style={pr.sectionTitle}>{t(LANG, "printOwnSection", { name: p.name || t(LANG, "personName", { n: i + 1 }) })}</h3>
            <table style={pr.table}>
              <tbody>
                <tr><td style={pr.td} colSpan={2}>{TXT.keepsLeft}</td><td style={pr.tdRight}>{eur(own.leftover)}</td></tr>
                {exp.map((e) => <tr key={e.id}><td style={pr.td}>{e.category || TXT.otherCategory}</td><td style={pr.td}>{e.label || TXT.unnamed}</td><td style={pr.tdRight}>− {eur(monthlyOf(e, fig))}</td></tr>)}
                {sav.map((e) => <tr key={e.id}><td style={pr.td}>{TXT.savingsSection}</td><td style={pr.td}>{e.label || TXT.unnamed}</td><td style={pr.tdRight}>− {eur(monthlyOf(e, fig))}</td></tr>)}
                <tr><td style={pr.tdTotal} colSpan={2}>{TXT.personalFree}</td><td style={{ ...pr.tdRight, ...pr.tdTotal }}>{eur(own.free)}</td></tr>
              </tbody>
            </table>
          </React.Fragment>
        );
      })}
    </section>
  );
}

const pr = {
  header: { textAlign: "center", marginBottom: 24, paddingBottom: 12, borderBottom: "1px solid #000" },
  appTitle: { fontSize: 13, fontWeight: 700 },
  docTitle: { fontSize: 20, fontWeight: 700, marginTop: 4 },
  meta: { fontSize: 11, color: "#333", marginTop: 4 },
  section: { marginBottom: 28 },
  pageBreak: { pageBreakAfter: "always" },
  monthTitle: { fontSize: 15, fontWeight: 700, textTransform: "capitalize", margin: "0 0 8px", borderBottom: "1px solid #000", paddingBottom: 4 },
  sectionTitle: { fontSize: 12, fontWeight: 700, margin: "14px 0 4px", textTransform: "uppercase", letterSpacing: 0.4 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  td: { padding: "3px 6px", borderBottom: "1px solid #ccc", textAlign: "left" },
  tdRight: { padding: "3px 6px", borderBottom: "1px solid #ccc", textAlign: "right", whiteSpace: "nowrap" },
  tdRightMuted: { padding: "3px 6px", borderBottom: "1px solid #ccc", textAlign: "right", whiteSpace: "nowrap", color: "#555", fontSize: 11 },
  tdTotal: { padding: "4px 6px", fontWeight: 700, borderTop: "1px solid #000" },
  empty: { fontSize: 12, color: "#555", fontStyle: "italic", margin: "4px 0" },
};

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
    <button type="button" onClick={onToggle} style={St.periodPill} className={`periodPill pill-${period}`} aria-label={TXT.periodToggle} title={TXT.periodToggle}>
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
// correspondent popover. Styled to stand out from the rest of this otherwise
// muted line, since it's easy to miss otherwise.
function DerivedLine({ monthly, period, percent, dot, correspondent, compare, category, entry }) {
  const other = period === "year" ? `${eur(monthly)} ${TXT.perMonth}` : `${eur(monthly * 12)} ${TXT.perYear}`;
  const contract = entry && (entry.startDate || entry.endDate) ? contractState(entry) : null;
  return (
    <div style={{ ...St.derived, marginLeft: dot ? 20 : 2 }} className="derived">
      {category && <span className="d-cat">{category}</span>}
      <span className="d-calc">= {other}{percent != null ? ` · ${Math.round(percent * 100)}%` : ""}</span>
      {PAPERLESS_ENABLED && correspondent && (
        <span style={St.derivedCorrespondent}><Building2 size={11} style={{ verticalAlign: "-1px" }} /> {correspondent}</span>
      )}
      {entry && (
        <span style={St.flags} aria-hidden="true">
          {entry.note?.trim() && <StickyNote size={12} />}
          {entry.url?.trim() && <Link2 size={12} />}
          {entry.formula && <Calculator size={12} />}
          {contract && <span style={{ ...St.flagChip, color: contract.color }}><CalendarClock size={12} />{(contract.expired || contract.endingSoon) && contract.status}</span>}
        </span>
      )}
      {compare && <MonthRail {...compare} />}
    </div>
  );
}

// Where an entry stands against the nearest month on either side: three
// dots (previous · this · next) — green when equal, amber when the amount
// differs, hollow red when the entry is missing there. Only differences
// get words, so an all-green rail reads as "exactly the same".
const RAIL_COLOR = { same: C.save, changed: C.warn, absent: C.exp };
const signedEur = (n) => `${n > 0 ? "+" : "−"}${eur(Math.abs(n))}`;
function MonthRail({ prev, next, cur }) {
  if (!prev && !next) return null;
  const describe = (side, isPrev) => {
    const month = monthShort(side.key);
    if (side.status === "same") return t(LANG, "railSame", { month });
    if (side.status === "absent") return t(LANG, isPrev ? "railNew" : "railStops", { month });
    return isPrev ? t(LANG, "railDiff", { diff: signedEur(cur - side.value), month }) : t(LANG, "railNext", { month, amount: eur(side.value) });
  };
  const sides = [prev && { side: prev, text: describe(prev, true) }, next && { side: next, text: describe(next, false) }].filter(Boolean);
  const dot = (side) => side
    ? <span style={{ ...St.railDot, ...(side.status === "absent" ? { border: `1.5px solid ${C.exp}` } : { background: RAIL_COLOR[side.status] }) }} />
    : <span style={{ ...St.railDot, visibility: "hidden" }} />;
  const label = sides.map((x) => x.text).join(" · ");
  return (
    <span style={St.rail} title={label} role="img" aria-label={label}>
      <span style={St.railTrack}>
        {dot(prev)}<span style={{ ...St.railLine, ...(prev ? {} : { visibility: "hidden" }) }} />
        <span style={St.railCur} />
        <span style={{ ...St.railLine, ...(next ? {} : { visibility: "hidden" }) }} />{dot(next)}
      </span>
      {sides.filter((x) => x.side.status !== "same").map((x) => (
        <span key={x.side.key} style={{ color: RAIL_COLOR[x.side.status], fontWeight: 600 }}>{x.text}</span>
      ))}
    </span>
  );
}

// The answer the month page exists for, right under the month bar: what
// each person transfers and keeps, and what the household pays together.
function ResultTiles({ partners, calc, names }) {
  const keeps = partners.map((p) => calc.keeps[p.id] || 0);
  const sameKeep = keeps.every((k) => Math.abs(k - keeps[0]) < 0.005);
  return (
    <div style={St.tiles} className="fade tiles">
      {partners.map((p, i) => (
        <div key={p.id} style={St.tile}>
          <div style={{ ...St.tileLabel, color: personColor(p, i).main }}>{t(LANG, "kpiTransfers", { name: names[i] })}</div>
          <div style={St.tileValue}>{eur0(calc.transfers[p.id] || 0)}</div>
          <div style={St.tileSub}>{t(LANG, "kpiKeeps", { amount: eur0(calc.leftovers[p.id] || 0) })}</div>
        </div>
      ))}
      <div style={St.tile}>
        <div style={St.tileLabel}>{TXT.kpiTogether}</div>
        <div style={St.tileValue}>{eur0(calc.coupleFunds)}</div>
        <div style={St.tileSub}>{TXT.kpiTogetherSub}</div>
      </div>
      <div style={St.tile}>
        <div style={St.tileLabel}>{TXT.kpiKeepPct}</div>
        <div style={St.tileValue}>{sameKeep ? pct(keeps[0] || 0) : keeps.map(pct).join(" · ")}</div>
        <div style={St.tileSub}>{TXT.kpiKeepPctSub}</div>
      </div>
    </div>
  );
}

// The personal page's counterpart of ResultTiles: what this person sends
// to the joint account, what their own costs and savings take, and what's
// left to spend freely.
function PersonTiles({ color, transfer, income, expTotal, savTotal, free }) {
  const tile = (label, value, sub, valueColor) => (
    <div style={St.tile}>
      <div style={{ ...St.tileLabel, ...(valueColor === "person" ? { color } : {}) }}>{label}</div>
      <div style={{ ...St.tileValue, ...(valueColor && valueColor !== "person" ? { color: valueColor } : {}) }}>{eur0(value)}</div>
      <div style={St.tileSub}>{sub}</div>
    </div>
  );
  return (
    <div style={St.tiles} className="fade tiles">
      {tile(TXT.kpiPersonTransfer, transfer, t(LANG, "kpiPersonTransferSub", { pct: pct(income > 0 ? transfer / income : 0) }), "person")}
      {tile(TXT.fixedCosts, expTotal, TXT.kpiPersonOwn)}
      {tile(TXT.kpiPersonSaves, savTotal, TXT.kpiPersonOwn)}
      {tile(TXT.personalFree, free, TXT.kpiPersonFreeSub, free < 0 ? C.exp : undefined)}
    </div>
  );
}

// Everything you do with a whole month, in one menu next to it instead of
// a row of buttons at the bottom of the page. Copying swaps the menu for a
// month picker in the same popover. Both drop down from the bar, also on
// phones: the bar is sticky there, so a fixed sheet would end up behind
// the bottom navigation.
function MonthActions({ pastMonths, futureMonths, printing, canDelete, onCopy, onReset, onPrintMonth, onPrintYear, onDelete }) {
  const [mode, setMode] = useState(null); // null | "menu" | "copy"
  const rootRef = useRef(null);
  useClickOutside(rootRef, Boolean(mode), () => setMode(null));
  useEffect(() => {
    if (!mode) return;
    const onKey = (e) => { if (e.key === "Escape") setMode(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);
  const run = (fn) => () => { setMode(null); fn(); };
  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }} className="navMore">
      <button type="button" aria-haspopup="menu" aria-expanded={Boolean(mode)} onClick={() => setMode((m) => (m ? null : "menu"))} style={St.monthActionsBtn} aria-label={TXT.monthActions}>
        <span className="monthActionsLabel">{TXT.monthActions}</span><MoreHorizontal size={18} />
      </button>
      {mode === "menu" && (
        <span role="menu" style={St.menuPop}>
          <button type="button" role="menuitem" onClick={() => setMode("copy")} style={St.menuItem}><Copy size={15} /> {TXT.copyMonthMenu}</button>
          <button type="button" role="menuitem" onClick={run(onReset)} style={St.menuItem}><RotateCcw size={15} /> {TXT.restoreThisMonth}</button>
          <button type="button" role="menuitem" disabled={printing} onClick={run(onPrintMonth)} style={St.menuItem}><Printer size={15} /> {TXT.printMonthBtn}</button>
          <button type="button" role="menuitem" disabled={printing} onClick={run(onPrintYear)} style={St.menuItem}><Printer size={15} /> {TXT.printYearBtn}</button>
          {canDelete && (<>
            <span style={St.menuDivider} />
            <button type="button" role="menuitem" onClick={run(onDelete)} style={{ ...St.menuItem, color: C.exp }}><Trash2 size={15} /> {TXT.deleteMonthMenu}</button>
          </>)}
        </span>
      )}
      {mode === "copy" && (
        <span style={St.copyPop}>
          <div style={St.copyTitle}>{TXT.copyMonth}</div>
          <CopyPicker pastMonths={pastMonths} futureMonths={futureMonths} onCopy={(pk, fk) => { setMode(null); onCopy(pk, fk); }} emptyText={TXT.noPrevMonths} />
        </span>
      )}
    </span>
  );
}

// Under the month bar: how this month differs from the nearest month on
// either side, in words ("2 entries gone · 1 different amount"). Tapping a
// side opens the actual list of entries, plus a jump to that month.
const plural = (key, n) => t(LANG, n === 1 ? `${key}One` : `${key}Many`, { count: n });
function MonthDiffSummary({ sel, prev, next, onGo }) {
  const [openKey, setOpenKey] = useState(null);
  useEffect(() => { setOpenKey(null); }, [sel]);
  if (!prev && !next) return null;
  const isPrev = (d) => d === prev;
  // Per side: [count key, list heading key, items]; next-side "only here" = stops after this month.
  const groupsOf = (d) => isPrev(d)
    ? [["compareNew", "compareListNewPrev", d.onlyHere], ["compareGone", "compareListGonePrev", d.onlyThere], ["compareChanged", "compareListChangedPrev", d.changed]]
    : [["compareStops", "compareListStopsNext", d.onlyHere], ["compareNew", "compareListNewNext", d.onlyThere], ["compareChanged", "compareListChangedNext", d.changed]];
  const chip = (d) => {
    if (!d) return null;
    const parts = groupsOf(d).filter(([, , items]) => items.length).map(([key, , items]) => plural(key, items.length));
    const on = openKey === d.key;
    return (
      <button type="button" onClick={() => setOpenKey(on ? null : d.key)} aria-expanded={on} style={{ ...St.diffChip, ...(on ? { borderColor: C.ink } : {}) }}>
        {parts.length ? <span style={{ ...St.railDot, background: C.warn }} /> : <Check size={13} style={{ color: C.save, flexShrink: 0 }} />}
        <span><span style={St.diffChipLabel}>{t(LANG, isPrev(d) ? "compareVsPrev" : "compareVsNext", { month: monthLong(d.key) })}: </span>{parts.length ? parts.join(" · ") : TXT.compareSame}</span>
        <ChevronDown size={14} style={{ color: C.muted, flexShrink: 0, transform: on ? "rotate(180deg)" : "none" }} />
      </button>
    );
  };
  const d = [prev, next].find((x) => x && x.key === openKey);
  const vars = d && { current: monthLong(sel), other: monthLong(d.key) };
  return (
    <div style={{ marginTop: -4, marginBottom: 12 }} className="fade">
      <div style={St.diffRow}>{chip(prev)}{chip(next)}</div>
      {d && (
        <div style={St.diffPanel}>
          {groupsOf(d).every(([, , items]) => !items.length) && <div style={St.diffItem}>{t(LANG, "compareListSame", vars)}</div>}
          {groupsOf(d).filter(([, , items]) => items.length).map(([, headKey, items]) => (
            <div key={headKey} style={{ marginBottom: 10 }}>
              <div style={St.diffHead}>{t(LANG, headKey, vars)}</div>
              {items.map((x) => (
                <div key={`${x.section}-${x.e.id}`} style={St.diffItem}>
                  <span style={{ minWidth: 0 }}>{x.label} <span style={{ color: C.muted }}>· {x.section}</span></span>
                  <span style={St.diffAmount}>{x.other == null ? eur(x.value) : isPrev(d) ? `${eur(x.other)} → ${eur(x.value)}` : `${eur(x.value)} → ${eur(x.other)}`}</span>
                </div>
              ))}
            </div>
          ))}
          <button type="button" onClick={() => onGo(d.key)} style={St.ghostBtn}>{t(LANG, "compareGoTo", { month: monthLong(d.key) })}</button>
        </div>
      )}
    </div>
  );
}

// "Only this month, or this month and later?" — asked when deleting an
// entry, or changing its amount, while it still exists in later months.
// Without a cancel button, Escape/backdrop simply mean "only this month".
function ScopeDialog({ icon, title, body, month, later, thisLabel, forwardLabel, danger, cancelLabel, onPick, onCancel }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div style={St.dialogBackdrop} onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="scope-dialog-title" style={St.dialog} onClick={(e) => e.stopPropagation()}>
        <div id="scope-dialog-title" style={St.dialogTitle}>{icon} {title}</div>
        <p style={St.dialogBody}>{body}</p>
        <button type="button" autoFocus onClick={() => onPick(false)} style={St.dialogOption}>
          {thisLabel.replace("{month}", monthLong(month))}
          <span style={St.dialogOptionSub}>{monthShortWithYear(month)}</span>
        </button>
        <button type="button" onClick={() => onPick(true)} style={{ ...St.dialogOption, ...(danger ? { color: C.exp, borderColor: C.exp } : { color: C.b, borderColor: C.b }) }}>
          {forwardLabel.replace("{month}", monthLong(month))}
          <span style={St.dialogOptionSub}>{monthRange([month, later[later.length - 1]])}</span>
        </button>
        {cancelLabel && <button type="button" onClick={onCancel} style={St.dialogCancel}>{cancelLabel}</button>}
      </div>
    </div>
  );
}

// Shown under a section while searching: how many of its entries match and what they add up to.
function FilterSum({ count, total, monthly }) {
  return (
    <div style={St.filterSum}>
      <span>{t(LANG, "filterMatches", { count, total })}</span>
      <span style={St.filterSumVal}>{eur(monthly)} <span style={St.subTotalYr}>· {eur(monthly * 12)} {TXT.perYearShort}</span></span>
    </div>
  );
}

// Free-text search over the current page's entries, plus a chip per expense
// category. Lives outside the history lock, so past months stay searchable.
function SearchBar({ inputRef, query, onQuery, categories, catFilter, onCat, onClear, filtering }) {
  return (
    <div style={St.searchWrap} className="fade">
      <div style={{ ...St.searchField, ...(filtering ? { borderColor: C.b } : {}) }}>
        <Search size={17} style={{ color: C.muted, flexShrink: 0 }} />
        <input ref={inputRef} id="entry-search" type="search" value={query} onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { onClear(); e.currentTarget.blur(); } }}
          placeholder={TXT.searchPlaceholder} aria-label={TXT.searchLabel} autoComplete="off" enterKeyHint="search" style={St.searchInput} />
        {filtering
          ? <button type="button" onClick={onClear} style={St.iconBtn} aria-label={TXT.clearFilter} title={TXT.clearFilter}><X size={16} /></button>
          : <kbd className="searchKbd" style={St.kbd} title={TXT.searchShortcut}>/</kbd>}
      </div>
      {categories.length > 1 && (
        <div style={St.chipRow} className="chipRow" role="group" aria-label={TXT.filterByCategory}>
          {categories.map((cat) => {
            const on = catFilter === cat;
            return (
              <button key={cat} type="button" aria-pressed={on} onClick={() => onCat(on ? null : cat)} style={{ ...St.chip, ...(on ? St.chipOn : {}) }}>
                <span style={{ ...St.catDot, width: 8, height: 8, background: categoryColor(cat === TXT.otherCategory ? "" : cat) }} />
                {cat}
              </button>
            );
          })}
        </div>
      )}
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

// Correspondent, shown in the entry detail panel. Free-text with
// paperless-ngx suggestions (see the #correspondents datalist); when the
// typed value matches a known paperless correspondent, also looks up (and
// links to) the most recent document paperless has for it. Renders nothing
// when the integration is off, per PAPERLESS_ENABLED.
function CorrespondentEditor({ entry, onChange, onSync, correspondents, labels }) {
  const [doc, setDoc] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docKey, setDocKey] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const value = entry.correspondent || "";
  const mode = entry.documentMode || "auto";
  const has = value.trim().length > 0;
  const match = has ? correspondents.find((c) => c.name.toLowerCase() === value.trim().toLowerCase()) : null;

  // Auto mode: (re)fetch whenever the correspondent resolves or the entry's preferred label changes.
  useEffect(() => {
    if (!PAPERLESS_ENABLED || mode !== "auto" || !match) return;
    const key = `auto:${match.id}:${entry.documentLabel?.kind || ""}:${entry.documentLabel?.id || ""}`;
    if (docKey === key) return;
    setDocLoading(true);
    paperless.latestDocument(match.id, entry.documentLabel).then((d) => { setDoc(d); setDocKey(key); setDocLoading(false); });
  }, [mode, match?.id, entry.documentLabel?.kind, entry.documentLabel?.id]);

  // Manual mode: fetch the pinned document's details whenever the pin changes.
  useEffect(() => {
    if (!PAPERLESS_ENABLED || mode !== "manual" || !entry.documentId) return;
    const key = `manual:${entry.documentId}`;
    if (docKey === key) return;
    setDocLoading(true);
    paperless.getDocument(entry.documentId).then((d) => { setDoc(d); setDocKey(key); setDocLoading(false); });
  }, [mode, entry.documentId]);

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
  if (!PAPERLESS_ENABLED) return null;

  const docBlock = docLoading ? (
    <span style={St.correspondentDocMuted}><Loader2 size={13} className="spin" /> {TXT.searchingDocument}</span>
  ) : doc ? (
    <a href={doc.url} target="_blank" rel="noopener noreferrer" style={St.correspondentDocLink}>{doc.documentType ? `${doc.documentType} · ` : ""}{doc.title} — {TXT.openInPaperless}</a>
  ) : (
    <span style={St.correspondentDocMuted}>{TXT.noDocumentFound}</span>
  );

  return (
    <>
      <input list="correspondents" value={value} placeholder={TXT.correspondentPlaceholder}
        onChange={(e) => onChange({ correspondent: e.target.value })}
        onBlur={(e) => onSync(e.target.value)}
        style={St.drawerInput} aria-label={TXT.correspondent} />
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
                style={{ ...St.drawerInput, marginBottom: 8 }}>
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
                style={St.drawerInput} aria-label={TXT.searchDocumentsPlaceholder} />
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
    </>
  );
}

// Contract/subscription state of an entry: "ending soon" once the end date
// is within its warning days (default CONTRACT_WARNING_DAYS), "expired"
// after it. Shared by the editor below and the row's indicator chip.
function contractState(entry) {
  const start = entry.startDate || "", end = entry.endDate || "";
  const warningDays = entry.warningDays ? num(entry.warningDays) : CONTRACT_WARNING_DAYS;
  const left = daysUntil(end);
  const expired = left != null && left < 0;
  const endingSoon = left != null && left >= 0 && left <= warningDays;
  const color = expired ? C.exp : endingSoon ? C.warn : (start || end) ? C.b : C.muted;
  const status = expired ? t(LANG, "contractExpired", { days: Math.abs(left) })
    : endingSoon ? t(LANG, "contractEndingSoon", { days: left })
    : end ? t(LANG, "contractActiveUntil", { date: fmtDate(end) })
    : null;
  return { start, end, expired, endingSoon, color, status, progress: durationProgress(start, end) };
}

// Contract duration: start + end date, warning days and a progress bar.
function DurationEditor({ entry, onChange }) {
  const { start, end, color, status, progress } = contractState(entry);
  // Picking a start date defaults the end date to one year later, but only
  // when there's no end date yet — an already-set end date is left alone.
  const setStart = (value) => onChange(value && !end ? { startDate: value, endDate: addOneYear(value) } : { startDate: value });
  return (
    <>
      <div style={St.drawerPair}>
        <label style={St.drawerSub}>{TXT.startDate}<input type="date" lang={LANG} value={start} onChange={(e) => setStart(e.target.value)} style={St.drawerInput} /></label>
        <label style={St.drawerSub}>{TXT.endDate}<input type="date" lang={LANG} value={end} onChange={(e) => onChange({ endDate: e.target.value })} style={St.drawerInput} /></label>
      </div>
      <label style={{ ...St.drawerSub, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
        {TXT.warningDays}
        <input inputMode="numeric" value={entry.warningDays || ""} placeholder={String(CONTRACT_WARNING_DAYS)}
          onChange={(e) => onChange({ warningDays: e.target.value.replace(/[^0-9]/g, "") })}
          style={{ ...St.drawerInput, width: 70 }} />
      </label>
      {progress != null && (
        <div style={{ ...St.progressTrack, marginTop: 10 }}><div style={{ ...St.progressFill, width: `${progress * 100}%`, background: color }} /></div>
      )}
      {status && <div style={{ ...St.correspondentDocMuted, color, marginTop: 6 }}>{status}</div>}
    </>
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

function SavingsOverviewPage({ savingsGoals, months, savingsGroups, partners, currentMonthData, sel, onUpdateGoal, onAddSubAccount, onRemoveSubAccount, onUpdateSubAccount }) {
  const [horizon, setHorizon] = useState(24);
  // Accordion: opening one goal collapses whichever other one was open, so
  // the page doesn't turn into a wall of charts once there are several.
  const [openGoalId, setOpenGoalId] = useState(null);
  // The account whose details are open in the side panel: { entryId, accountId }
  // — accountId "main" is the joint account a forwarded pot arrives on.
  const [panel, setPanel] = useState(null);
  const goalOf = (entry) => savingsGoals.find((g) => g.entryId === entry.id) || { entryId: entry.id, targetAmount: "", mainBank: "", mainInterestRate: "", bufferAmount: "", forwarded: false, checkpoints: {}, subAccounts: [] };
  // Every account of every pot, with its balance this month — shared by the
  // summary and the "update balances" form.
  const accounts = useMemo(() => savingsGroups.flatMap((group) => group.entries.flatMap((entry) => {
    const goal = goalOf(entry);
    const target = goal.targetAmount ? num(goal.targetAmount) : null;
    const groupPersonId = group.id === "joint" ? null : group.id;
    return goalAccounts(entry, goal, sel, goal.forwarded ? TXT.mainAccountLabel : TXT.unnamed).map((acc) => ({
      acc, entry, goal, groupPersonId, group,
      // Who the money belongs to: one person, or shared ("" = the household).
      ownerIds: Object.entries(accountOwnerShares(acc, groupPersonId, partners)).filter(([, share]) => share > 0).map(([id]) => id),
      name: acc.isMain ? (goal.mainBank || TXT.mainAccountLabel) : acc.isOwn ? TXT.ownAccountLabel : accountName(acc),
      balance: acc.virtual ? null : balanceAt(months, entry.id, acc, sel, target)?.balance ?? null,
      expected: balanceAt(months, entry.id, acc, sel, target, { without: true })?.balance ?? null,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [savingsGroups, savingsGoals, months, sel]);
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
      <SavingsSummary accounts={accounts} partners={partners} sel={sel} />
      <BalanceUpdatePanel accounts={accounts} partners={partners} sel={sel}
        onSet={({ acc, entry, goal }, value) => {
          const cps = { ...((acc.isMain || acc.isOwn) ? goal.checkpoints : acc.checkpoints) || {} };
          if (value) cps[sel] = value; else delete cps[sel];
          if (acc.isMain || acc.isOwn) onUpdateGoal(entry.id, { checkpoints: cps });
          else onUpdateSubAccount(entry.id, acc.id, { checkpoints: cps });
        }} />
      {savingsGroups.every((g) => g.entries.length === 0) && <div style={St.copyEmpty}>{TXT.noSavingsGoals}</div>}
      {/* Joint pots first, then each person's own — a group only shows up
          once it has at least one pot, and its heading only when there's
          more than one group to tell apart. */}
      {savingsGroups.filter((g) => g.entries.length > 0).map((group, _gi, shown) => (
      <React.Fragment key={group.id}>
      {shown.length > 1 && (
        <div style={St.savingsGroupHead}>
          <span style={{ ...St.catDot, background: group.color }} />
          {group.id === "joint" ? TXT.savingsGroupJoint : t(LANG, "savingsGroupPerson", { name: group.title })}
        </div>
      )}
      {group.entries.map((entry) => {
        const goal = goalOf(entry);
        return (
          <SavingsGoalCard key={entry.id} entry={entry} goal={goal} months={months} currentMonthData={currentMonthData} sel={sel} horizon={horizon}
            open={openGoalId === entry.id}
            onToggleOpen={() => setOpenGoalId((cur) => cur === entry.id ? null : entry.id)}
            onUpdate={(patch) => onUpdateGoal(entry.id, patch)}
            onAddSubAccount={(kind) => { const id = uid(); onAddSubAccount(entry.id, id, kind); setPanel({ entryId: entry.id, accountId: id }); }}
            selectedAccountId={panel?.entryId === entry.id ? panel.accountId : null}
            onOpenAccount={(accountId) => setPanel((cur) => (cur?.entryId === entry.id && cur.accountId === accountId ? null : { entryId: entry.id, accountId }))}
          />
        );
      })}
      </React.Fragment>
      ))}
      {panel && (() => {
        const group = savingsGroups.find((g) => g.entries.some((e) => e.id === panel.entryId));
        const entry = group?.entries.find((e) => e.id === panel.entryId);
        if (!entry) return null;
        const goal = goalOf(entry);
        const sub = panel.accountId === "main" ? null : goal.subAccounts.find((x) => x.id === panel.accountId);
        if (panel.accountId !== "main" && !sub) return null;
        return (
          <AccountPanel key={`${panel.entryId}-${panel.accountId}`} entry={entry} goal={goal} sub={sub} months={months} currentMonthData={currentMonthData} sel={sel}
            partners={group.id === "joint" ? partners : null}
            onClose={() => setPanel(null)}
            onUpdateGoal={(patch) => onUpdateGoal(entry.id, patch)}
            onUpdateSub={(patch) => onUpdateSubAccount(entry.id, sub.id, patch)}
            onRemoveSub={() => { onRemoveSubAccount(entry.id, sub.id); setPanel(null); }} />
        );
      })()}
    </div>
  );
}

// Top of the savings overview: what's saved in total, what of it belongs
// to whom (own pots + their part of the joint ones), the interest it earns
// and the tips worth acting on — so nobody has to add up cards by hand.
function SavingsSummary({ accounts, partners, sel }) {
  const known = accounts.filter((a) => a.balance != null);
  if (!known.length) return null;
  const total = known.reduce((sum, a) => sum + a.balance, 0);
  const perPerson = Object.fromEntries(partners.map((p) => [p.id, 0]));
  let interest = 0;
  for (const a of known) {
    const shares = accountOwnerShares(a.acc, a.groupPersonId, partners);
    for (const [id, share] of Object.entries(shares)) if (id in perPerson) perPerson[id] += a.balance * share;
    interest += a.balance * num(a.acc.interestRate) / 100;
  }
  // The same account (bank + holder) can hold money for several pots; list it once.
  const byAccount = new Map();
  for (const a of known) {
    const key = a.acc.isOwn ? `own-${a.entry.id}` : a.name.toLowerCase();
    const row = byAccount.get(key) || { name: a.acc.isOwn ? (a.entry.label || TXT.unnamed) : a.name, balance: 0, rates: new Set(), pots: new Set() };
    row.balance += a.balance;
    if (num(a.acc.interestRate) > 0) row.rates.add(String(a.acc.interestRate).replace(".", ","));
    if (!a.acc.isOwn) row.pots.add(a.entry.label || TXT.unnamed);
    byAccount.set(key, row);
  }
  const rows = [...byAccount.values()].sort((x, y) => y.balance - x.balance);
  return (
    <>
      <div style={St.tiles} className="fade tiles">
        <div style={St.tile}>
          <div style={St.tileLabel}>{t(LANG, "savingsTotalIn", { month: monthShortWithYear(sel) })}</div>
          <div style={St.tileValue}>{eur0(total)}</div>
          <div style={St.tileSub}>{t(LANG, "savingsOnAccounts", { count: rows.length })}</div>
        </div>
        {partners.map((p, i) => (
          <div key={p.id} style={St.tile}>
            <div style={{ ...St.tileLabel, color: personColor(p, i).main }}>{t(LANG, "savingsOfPerson", { name: p.name || t(LANG, "personName", { n: i + 1 }) })}</div>
            <div style={St.tileValue}>{eur0(perPerson[p.id])}</div>
            <div style={St.tileSub}>{TXT.savingsOfPersonSub}</div>
          </div>
        ))}
        <div style={St.tile}>
          <div style={St.tileLabel}>{TXT.savingsInterestYear}</div>
          <div style={{ ...St.tileValue, color: C.save }}>{eur0(interest)}</div>
          <div style={St.tileSub}>{TXT.savingsInterestYearSub}</div>
        </div>
      </div>
      <div style={{ ...St.section, padding: "10px 14px", marginBottom: 12 }} className="fade">
        <div style={St.catSummaryTitle}>{TXT.perAccount}</div>
        {rows.map((r) => (
          <div key={r.name + r.balance} style={St.catSummaryRow}>
            <span style={St.catName}>
              <span style={{ ...St.catDot, background: categoryColor(r.name) }} />
              <span style={{ minWidth: 0 }}>
                {r.name}
                {r.pots.size > 0 && <span style={St.accountPots}> · {[...r.pots].join(", ")}</span>}
              </span>
            </span>
            <span style={St.catYr}>{r.rates.size ? `${[...r.rates].join(" / ")}%` : ""}</span>
            <span style={St.catMonthly}>{eur(r.balance)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// One form for every account's actual balance this month, next to what
// the projection expected — instead of a popover per account. Grouped like
// the page (joint pots, then each person's own), each row says whose money
// it is and when its balance was last entered. Filling in is never
// required: without a balance for this month the projection simply carries
// on from the last one entered.
function BalanceUpdatePanel({ accounts, partners, sel, onSet }) {
  const [open, setOpen] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  if (!accounts.length) return null;
  const cpsOf = (a) => ((a.acc.isMain || a.acc.isOwn) ? a.goal.checkpoints : a.acc.checkpoints) || {};
  // For a deposit, its deposited amount counts as entered in its start month.
  const lastEntered = (a) => {
    const keys = Object.keys(cpsOf(a)).filter((k) => k < sel && cpsOf(a)[k] !== "");
    if (isDeposit(a.acc) && isMonthKey(a.acc.termStart) && a.acc.depositAmount !== "" && a.acc.termStart < sel) keys.push(a.acc.termStart);
    return keys.sort().pop() || null;
  };
  const isFilled = (a) => cpsOf(a)[sel] !== undefined && cpsOf(a)[sel] !== "";
  const filled = accounts.filter(isFilled).length;
  const personName = (id) => { const i = partners.findIndex((p) => p.id === id); return i < 0 ? "?" : (partners[i].name || t(LANG, "personName", { n: i + 1 })); };
  const ownerLabel = (a) => (a.ownerIds.length === 1 ? t(LANG, "ownerOf", { name: personName(a.ownerIds[0]) }) : TXT.ownerJoint);
  const shown = onlyMissing ? accounts.filter((a) => !isFilled(a)) : accounts;
  const groups = [];
  for (const a of shown) {
    let g = groups.find((x) => x.id === a.group.id);
    if (!g) groups.push(g = { id: a.group.id, title: a.group.id === "joint" ? TXT.savingsGroupJoint : t(LANG, "savingsGroupPerson", { name: a.group.title }), color: a.group.color, rows: [] });
    g.rows.push(a);
  }
  return (
    <section style={{ ...St.section, marginBottom: 12 }} className="fade">
      <div role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }} style={St.collapseHead}>
        <CalendarClock size={16} style={{ color: C.muted }} />
        <span style={St.savingsGoalName}>{t(LANG, "updateBalancesTitle", { month: monthLong(sel) })}</span>
        <span style={{ flex: 1 }} />
        <span style={St.updateCount}>{t(LANG, "updateBalancesCount", { done: filled, count: accounts.length })}</span>
        <span onClick={(e) => e.stopPropagation()}><InfoDot text={TXT.updateBalancesCountInfo} align="right" /></span>
        <ChevronDown size={18} style={{ color: C.muted, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s", flexShrink: 0 }} />
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={St.correspondentDocMuted}>{TXT.updateBalancesInfo}</div>
          <label style={{ ...St.goalForwardedToggle, marginTop: 8, fontWeight: 500 }}>
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
            {t(LANG, "onlyMissing", { count: accounts.length - filled })}
          </label>
          {shown.length === 0 && <div style={{ ...St.copyEmpty, marginTop: 8 }}>{TXT.allUpdated}</div>}
          {groups.map((g) => (
            <React.Fragment key={g.id}>
              <div style={{ ...St.savingsGroupHead, margin: "14px 0 2px" }}><span style={{ ...St.catDot, background: g.color }} />{g.title}</div>
              {g.rows.map((a) => {
                const value = cpsOf(a)[sel] ?? "";
                const diff = value !== "" && a.expected != null ? num(value) - a.expected : null;
                const last = lastEntered(a);
                const name = a.acc.isOwn ? (a.entry.label || TXT.unnamed) : a.name;
                return (
                  <div key={`${a.entry.id}-${a.acc.id}`} style={St.balanceRow}>
                    <span style={{ ...St.catDot, background: categoryColor(a.acc.isOwn ? a.entry.label : a.name) }} />
                    <span style={St.balanceName}>
                      <span style={{ fontWeight: 600 }}>{name}</span>
                      {!a.acc.isOwn && <span style={St.accountPots}> · {a.entry.label || TXT.unnamed}</span>}
                      <span style={St.ownerTag}>{ownerLabel(a)}</span>
                      <span style={St.balanceExpected}>
                        {isFilled(a)
                          ? <span style={{ color: C.save }}>✓ {TXT.balanceUpdated}</span>
                          : last ? t(LANG, "balanceLastEntered", { month: monthShortWithYear(last) }) : TXT.balanceNeverEntered}
                        {a.expected != null && <> · {t(LANG, "balanceExpected", { amount: eur(a.expected) })}</>}
                        {diff != null && Math.abs(diff) >= 0.5 && <span style={{ color: diff > 0 ? C.save : C.exp }}> · {diff > 0 ? "+" : "−"}{eur(Math.abs(diff))}</span>}
                      </span>
                    </span>
                    <div style={St.money}>
                      <span style={St.euro}>€</span>
                      <input inputMode="decimal" value={value} placeholder={a.expected != null ? String(round2(a.expected)).replace(".", ",") : "0,00"}
                        aria-label={t(LANG, "balanceFor", { name })}
                        onChange={(e) => onSet(a, e.target.value.replace(/[^0-9.,]/g, ""))} style={{ ...St.moneyInput, width: 90 }} />
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      )}
    </section>
  );
}

// A colored ribbon per Sankey link — recharts' default Sankey link is a
// single flat grey, so this recolors each one to match the node its money
// is leaving (same colors used for that node itself).
function SankeyLink({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload }) {
  return (
    <path
      d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={payload.color}
      strokeOpacity={0.4}
      strokeWidth={linkWidth}
    />
  );
}

// A colored rectangle + name + amount label per Sankey node — recharts'
// default Sankey node is a single flat fill, so this is needed for the
// same per-person/per-category coloring used throughout the rest of the
// app. Labels flow outward (right of every node, except terminal/sink nodes
// — those have nothing further to their right, so their label flips to the
// left instead, ending right where the node starts) so they never spill
// past the chart's right edge.
function SankeyNode({ x, y, width, height, payload }) {
  const isSink = payload.isSink;
  const labelX = isSink ? x - 6 : x + width + 6;
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={payload.color} fillOpacity={0.9} />
      <text x={labelX} y={y + height / 2 - 2} textAnchor={isSink ? "end" : "start"} dominantBaseline="middle"
        style={{ fontSize: 12, fill: C.ink, fontFamily: "Inter, sans-serif" }}>
        {payload.name}
      </text>
      <text x={labelX} y={y + height / 2 + 12} textAnchor={isSink ? "end" : "start"} dominantBaseline="middle"
        style={{ fontSize: 11, fill: C.muted, fontFamily: "Inter, sans-serif" }}>
        {eur0(payload.value)}
      </text>
    </Layer>
  );
}

// The tallest column determines how much vertical room the Sankey actually
// needs — a fixed chart height made sense for the small "totals" graph but
// left the busier levels squeezed into slivers. recharts' Sankey (like
// d3-sankey) uses "justify" alignment: every sink node (no outgoing link),
// regardless of how deep it naturally sits, gets pushed into one shared
// rightmost column — expense categories, savings entries and personal
// leftovers all land in the same column even though their longest-path
// depth differs. So sinks are counted together as a single column; only
// non-sink nodes are bucketed by their natural (longest-path) depth, found
// by relaxation since that's simplest for a small, acyclic graph.
function maxColumnSize(nodes, links) {
  const depth = new Array(nodes.length).fill(0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const l of links) {
      if (depth[l.target] < depth[l.source] + 1) {
        depth[l.target] = depth[l.source] + 1;
        changed = true;
      }
    }
  }
  const counts = {};
  let sinkCount = 0;
  nodes.forEach((n, i) => {
    if (n.isSink) { sinkCount += 1; return; }
    counts[depth[i]] = (counts[depth[i]] || 0) + 1;
  });
  return Math.max(1, sinkCount, ...Object.values(counts));
}

const CASHFLOW_DETAIL_LABELS = { 1: "cashflowDetailTotals", 2: "cashflowDetailCategories", 3: "cashflowDetailFull" };
// First-draft cashflow view: traces salary → household pot/personal leftover
// → expenses/savings/buffer or personal spending → the last known category
// or entry, for whichever month is selected. Purely derived from `cur`/
// `calc` — no new data, no mutations. Starts at the least detailed level;
// the diagram gets busy fast once categories/entries are exploded, so more
// detail is opt-in rather than the default.
function CashflowPage({ cur, calc }) {
  const [detail, setDetail] = useState(1);
  const { nodes, links } = useMemo(() => buildCashflow(cur, calc, detail), [cur, calc, detail]);
  const chartHeight = useMemo(() => Math.min(1500, Math.max(440, maxColumnSize(nodes, links) * 72 + 60)), [nodes, links]);
  return (
    <div className="fade">
      <ColTitle>{TXT.cashflowView}</ColTitle>
      <div style={St.correspondentDocMuted}>{TXT.cashflowHint}</div>
      <div style={{ ...St.sortRow, marginTop: 10 }}>
        <span style={St.sortLabel}>{TXT.cashflowDetailLabel}</span>
        <div style={St.toggle} role="group" aria-label={TXT.cashflowDetailLabel}>
          {[1, 2, 3].map((lvl) => (
            <button key={lvl} type="button" onClick={() => setDetail(lvl)} style={{ ...St.toggleBtn, ...(detail === lvl ? St.toggleOn : {}) }}>{TXT[CASHFLOW_DETAIL_LABELS[lvl]]}</button>
          ))}
        </div>
      </div>
      {links.length === 0 ? (
        <div style={St.emptyHist}>
          <TrendingUp size={18} style={{ color: C.muted }} />
          <span>{TXT.noSeries}</span>
        </div>
      ) : (
        <div className="hScroll">
        <div style={{ ...St.chartBox, height: chartHeight, marginTop: 12 }} className="sankeyBox">
          <ResponsiveContainer width="100%" height="100%">
            <Sankey data={{ nodes, links }} node={<SankeyNode />} link={<SankeyLink />}
              nodePadding={30} nodeWidth={10} margin={{ top: 20, right: 130, bottom: 20, left: 130 }}>
              <Tooltip {...tooltipProps} />
            </Sankey>
          </ResponsiveContainer>
        </div>
        </div>
      )}
    </div>
  );
}

function SavingsGoalCard({ entry, goal, months, currentMonthData, sel, horizon, open, onToggleOpen, onUpdate, onAddSubAccount, selectedAccountId, onOpenAccount }) {
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
  // The accounts this pot's money is on (see goalAccounts): one virtual
  // account when it isn't forwarded, else the joint main account — which
  // keeps whatever the sub-accounts don't take — plus each sub-account.
  const effectiveSubAccounts = useMemo(
    () => goalAccounts(entry, goal, sel, forwarded ? TXT.mainAccountLabel : TXT.unnamed),
    [entry, goal, sel, forwarded]);
  // This month's flow: what goes on to the sub-accounts and what stays behind
  // on the main account — shown so a fixed transfer that outgrows the
  // contribution is visible right away rather than only in the projection.
  const forwardedTotal = subAccounts.reduce((sum, s) => sum + subAccountContribution(s, entryMonthlyAmount, sel), 0);
  const mainRemainder = entryMonthlyAmount - forwardedTotal;
  const mainId = `self-${entry.id}`;
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
  // The first month (if any) whose projected total actually crosses the
  // target — not just "reached somewhere within the horizon". "Reached" is
  // only true once the month you're currently viewing (sel) is at or after
  // that month, so the badge doesn't show up while browsing months that are
  // still short of it, just because a later projected month gets there.
  const reachedMonth = useMemo(() => {
    if (target == null) return null;
    for (const k of keys) {
      const total = effectiveSubAccounts.reduce((sum, s) => sum + (seriesBySub[s.id][k]?.balance ?? 0), 0);
      if (total >= target) return k;
    }
    return null;
  }, [keys, seriesBySub, effectiveSubAccounts, target]);
  const reached = reachedMonth != null && sel >= reachedMonth;
  const tip = interestTip(forwarded ? (seriesBySub[mainId]?.[sel]?.balance ?? null) : null, goal);
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
        style={St.collapseHead} className="goalHead">
        <span style={St.savingsGoalName}>{entry.label || TXT.unnamed}</span>
        <span style={{ flex: 1 }} />
        {/* Read-only here on purpose — this is the same monthly entry shown
            in the monthly view, and it should only be editable there. */}
        {forwarded && <span style={St.goalForwardedTag}>{t(LANG, "goalAccountsCount", { count: subAccounts.length + 1 })}</span>}
        <span style={St.savingsGoalAmount} title={TXT.savingsGoalAmountInfo}>{eur(entryDisplayAmount)} {entryPeriodSuffix}</span>
        <ChevronDown size={18} style={{ color: C.muted, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s", flexShrink: 0 }} />
      </div>

      {open && (
      <>
      {/* Lives inside the opened card rather than in its header, so it
          can't be hit by accident when you mean to click the arrow. */}
      <div style={{ ...St.goalForwardedRow }}>
        <label style={St.goalForwardedToggle}>
          <input type="checkbox" checked={forwarded} onChange={(e) => onUpdate({ forwarded: e.target.checked })} />
          {TXT.goalForwardedLabel}
        </label>
        <InfoDot text={TXT.goalForwardedInfo} />
      </div>
      {/* The target applies to the goal as a whole either way. The recorded
          balance here is the goal's own account — once forwarded, that's
          specifically the main/shared account, tracked alongside (not
          combined into) each sub-account's own balance below. */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
        {!forwarded && (<label style={St.copyRow}>
          <span style={St.copyLbl}>{TXT.checkpointBalance} <InfoDot text={TXT.checkpointInfo} /></span>
          <input inputMode="decimal" value={goal.checkpoints?.[sel] ?? ""} placeholder="0,00"
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.,]/g, "");
              const next = { ...(goal.checkpoints || {}) };
              if (v) next[sel] = v; else delete next[sel];
              onUpdate({ checkpoints: next });
            }} style={{ ...St.copySel, width: 90 }} />
        </label>)}
        <label style={St.copyRow}>
          <span style={St.copyLbl}>{TXT.targetAmount} <InfoDot text={TXT.infoTargetAmount} /></span>
          <input inputMode="decimal" value={goal.targetAmount} placeholder={TXT.targetAmountPlaceholder}
            onChange={(e) => onUpdate({ targetAmount: e.target.value.replace(/[^0-9.,]/g, "") })} style={{ ...St.copySel, width: 100 }} />
        </label>
      </div>

      {forwarded && (
        <>
          {/* The joint account and each sub-account are read-only rows here;
              clicking one opens all its fields in the side panel. */}
          <AccountRow name={goal.mainBank || TXT.mainAccountLabel} selected={selectedAccountId === "main"} onOpen={() => onOpenAccount("main")}
            lines={[
              t(LANG, "mainAccountFlow", { incoming: eur(entryMonthlyAmount), forwarded: eur(forwardedTotal), remainder: eur(mainRemainder) }),
              [seriesBySub[mainId]?.[sel] ? t(LANG, "subBalanceNow", { amount: eur(seriesBySub[mainId][sel].balance) }) : null,
                num(goal.mainInterestRate) > 0 ? t(LANG, "subInterest", { rate: String(goal.mainInterestRate).replace(".", ",") }) : null,
                num(goal.bufferAmount) > 0 ? t(LANG, "bufferShort", { amount: eur0(num(goal.bufferAmount)) }) : null].filter(Boolean).join(" · "),
            ]}
            warning={mainRemainder < -0.005 ? t(LANG, "mainAccountShrinks", { amount: eur(-mainRemainder) }) : null}>
            {tip && <InterestTip tip={tip} mainName={goal.mainBank || TXT.mainAccountLabel} buffer={num(goal.bufferAmount)} />}
          </AccountRow>
          {subAccounts.map((sub) => (
            <AccountRow key={sub.id} name={accountName(sub)} dotKey={sub.holder || sub.id}
              selected={selectedAccountId === sub.id} onOpen={() => onOpenAccount(sub.id)}
              lines={[subAccountSummary(sub, entryMonthlyAmount, sel, seriesBySub[sub.id]?.[sel]?.balance)]} />
          ))}
          {subAccounts.length === 0 && <div style={St.copyEmpty}>{TXT.noSubAccounts}</div>}
          <div style={St.addRow}>
            <button type="button" onClick={() => onAddSubAccount("savings")} style={St.addBtn} title={TXT.addSavingsAccountInfo}><Plus size={16} /> {TXT.addSavingsAccount}</button>
            <button type="button" onClick={() => onAddSubAccount("deposit")} style={St.addBtn} title={TXT.addDepositInfo}><Plus size={16} /> {TXT.addDeposit}</button>
          </div>
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
                    const isReachedMonth = k === reachedMonth;
                    return (
                      <tr key={k} style={isReachedMonth ? St.savingsTrReached : undefined}>
                        <td style={{ ...St.savingsTd, textAlign: "left" }}>
                          {monthLong(k)}
                          {isReachedMonth && <Check size={14} style={{ color: C.save, verticalAlign: "-2px", marginLeft: 6 }} title={TXT.targetReached} />}
                        </td>
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

// "Move more to the better rate" — see interestTip in finance.js.
function InterestTip({ tip, mainName, buffer }) {
  const target = [tip.account.bank, tip.account.holder].filter(Boolean).join(" ") || TXT.unnamed;
  return (
    <div style={St.tipBox}>
      <TrendingUp size={16} style={{ color: C.save, flexShrink: 0, marginTop: 2 }} />
      <span>{t(LANG, buffer > 0 ? "interestTipBuffer" : "interestTip", {
        excess: eur0(tip.excess), main: mainName, buffer: eur0(buffer), target, rate: String(tip.rate).replace(".", ","),
        mainRate: String(tip.mainRate).replace(".", ","), gain: eur0(tip.gainPerYear),
      })}</span>
    </div>
  );
}

const accountName = (sub) => `${[sub.bank, sub.holder].filter(Boolean).join(" · ") || TXT.unnamed}${isDeposit(sub) ? ` (${TXT.depositLabel.toLowerCase()})` : ""}`;

// One line with an account's transfer, balance and interest.
function subAccountSummary(sub, entryMonthlyAmount, sel, balance) {
  if (isDeposit(sub)) {
    const end = depositEnd(sub);
    return [
      TXT.depositLabel,
      sub.depositAmount ? eur(num(sub.depositAmount)) : null,
      num(sub.interestRate) > 0 ? t(LANG, "depositRate", { rate: String(sub.interestRate).replace(".", ",") }) : null,
      end ? (sel > end ? t(LANG, "depositEnded", { month: monthShortWithYear(end) }) : t(LANG, "depositRuns", { from: monthShortWithYear(sub.termStart), to: monthShortWithYear(end), months: Math.round(num(sub.termMonths)) })) : null,
      balance != null && isMonthKey(sub.termStart) && sel >= sub.termStart ? t(LANG, "subBalanceNow", { amount: eur(balance) }) : null,
    ].filter(Boolean).join(" · ");
  }
  const amount = subAccountContribution(sub, entryMonthlyAmount, sel);
  return [
    sub.transferMode === "amount"
      ? (sub.transferDay ? t(LANG, "subTransferOnDay", { amount: eur(amount), day: sub.transferDay }) : t(LANG, "subTransferMonthly", { amount: eur(amount) }))
      : t(LANG, "subTransferShare", { pct: `${num(sub.sharePercent ?? 100)}%`, amount: eur(amount) }),
    balance != null ? t(LANG, "subBalanceNow", { amount: eur(balance) }) : null,
    num(sub.interestRate) > 0 ? t(LANG, "subInterest", { rate: String(sub.interestRate).replace(".", ",") }) : null,
  ].filter(Boolean).join(" · ");
}

// A read-only account row in a savings pot; the whole row opens the side panel.
function AccountRow({ name, dotKey, lines, warning, selected, onOpen, children }) {
  return (
    <div style={{ ...St.subRow, ...(selected ? { borderColor: C.b, boxShadow: `0 0 0 1px ${C.b}` } : {}) }} className="subWrap accountRow">
      <div role="button" tabIndex={0} aria-expanded={selected} onClick={onOpen}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }} style={St.accountRowHead}>
        <span style={{ ...St.catDot, background: categoryColor(dotKey || name) }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 700 }}>{name}</span>
          {lines.filter(Boolean).map((l, i) => <span key={i} style={{ ...St.subSummary, display: "block" }}>{l}</span>)}
          {warning && <span style={{ ...St.subSummary, display: "block", color: C.exp }}>{warning}</span>}
        </span>
        <ChevronRight size={18} style={{ color: selected ? C.b : C.muted, flexShrink: 0 }} />
      </div>
      {children}
    </div>
  );
}

// A month input that only passes on complete months ("YYYY-MM"). Browsers
// without a native month picker (Firefox) show it as a plain text field, and
// a half-typed value like "2025-" used to crash the page. What you type is
// kept locally until it's a valid month; leaving the field with an invalid
// value puts the last valid one back.
function MonthField({ value, onChange, style }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <input type="month" value={draft} placeholder="JJJJ-MM" style={style}
      onChange={(e) => { const v = e.target.value; setDraft(v); if (isMonthKey(v)) onChange(v); }}
      onBlur={() => { if (!isMonthKey(draft)) setDraft(value); }} />
  );
}

// A labelled field in the side panel, with an (i) that explains what it's for.
// `align="right"` for a field in the right-hand column, so its explanation
// opens toward the panel instead of past its edge.
function PanelField({ label, info, children, wide = true, align = "left" }) {
  return (
    <div style={{ ...St.drawerSub, marginTop: 10, ...(wide ? {} : { flex: 1 }) }}>
      <span style={St.panelFieldLabel}>{label}{info && <InfoDot text={info} align={align} />}</span>
      {children}
    </div>
  );
}

// Copy a value (IBAN, transfer description) for pasting into your bank's app.
function CopyButton({ value }) {
  const [done, setDone] = useState(false);
  if (!value) return null;
  return (
    <button type="button" aria-label={TXT.copyValue} title={TXT.copyValue} style={St.iconBtn}
      onClick={() => { navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
      {done ? <Check size={16} style={{ color: C.save }} /> : <Copy size={16} />}
    </button>
  );
}

// Side panel with every field of one account of a savings pot — the joint
// account a forwarded pot arrives on ("main", sub == null) or one of its
// sub-accounts. Same panel/bottom-sheet as the month page's entry details.
function AccountPanel({ entry, goal, sub, months, currentMonthData, sel, partners, onClose, onUpdateGoal, onUpdateSub, onRemoveSub }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const isMain = !sub;
  const entryMonthly = monthlyOf(entry, currentMonthData);
  const accounts = goalAccounts(entry, goal, sel, TXT.mainAccountLabel);
  const account = isMain ? accounts[0] : accounts.find((a) => a.id === sub.id);
  const target = goal.targetAmount ? num(goal.targetAmount) : null;
  const expected = balanceAt(months, entry.id, account, sel, target, { without: true })?.balance ?? null;
  const checkpoints = (isMain ? goal.checkpoints : sub.checkpoints) || {};
  const setCheckpoint = (v) => {
    const next = { ...checkpoints };
    if (v) next[sel] = v; else delete next[sel];
    if (isMain) onUpdateGoal({ checkpoints: next }); else onUpdateSub({ checkpoints: next });
  };
  const decimal = (v) => v.replace(/[^0-9.,]/g, "");
  const byAmount = sub?.transferMode === "amount";
  const amountKey = useRef(null);
  const amountHistory = Object.entries(sub?.transferAmounts || {}).sort(([a], [b]) => a.localeCompare(b));
  const title = isMain ? (goal.mainBank || TXT.mainAccountLabel) : accountName(sub);
  const dep = !isMain && isDeposit(sub);
  const end = dep ? depositEnd(sub) : null;
  const atEnd = end ? balanceAt(months, entry.id, account, end, null) : null;
  const section = (label, body) => <section style={St.drawerSection}><div style={St.drawerLabel}>{label}</div>{body}</section>;
  const remainder = entryMonthly - (goal.subAccounts || []).reduce((sum, s) => sum + subAccountContribution(s, entryMonthly, sel), 0);

  return (
    <>
      <div className="drawerBackdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={title} style={St.drawer}>
        <div style={St.drawerHead}>
          <span style={St.drawerCrumb}>{entry.label || TXT.unnamed} · {isMain ? TXT.panelMainCrumb : TXT.panelSubCrumb} · {monthLong(sel)}</span>
          <button type="button" onClick={onClose} style={St.iconBtn} aria-label={TXT.close}><X size={18} /></button>
        </div>
        <div style={{ ...St.drawerTitle, borderBottom: "none" }}>{title}</div>

        {section(TXT.panelAccount, isMain ? (
          <PanelField label={TXT.subAccountBank} info={TXT.infoMainBank}>
            <input list="banks" value={goal.mainBank || ""} placeholder={TXT.mainAccountBankPlaceholder} onChange={(e) => onUpdateGoal({ mainBank: e.target.value })} style={St.drawerInput} />
          </PanelField>
        ) : (
          <>
            <PanelField label={TXT.accountKind} info={TXT.infoAccountKind}>
              <div style={{ ...St.toggle, alignSelf: "flex-start" }} role="group" aria-label={TXT.accountKind}>
                <button type="button" onClick={() => onUpdateSub({ kind: "savings" })} style={{ ...St.toggleBtn, ...(!dep ? St.toggleOn : {}) }}>{TXT.kindSavings}</button>
                <button type="button" onClick={() => onUpdateSub({ kind: "deposit", termStart: sub.termStart || sel, termMonths: sub.termMonths || "12" })} style={{ ...St.toggleBtn, ...(dep ? St.toggleOn : {}) }}>{TXT.depositLabel}</button>
              </div>
            </PanelField>
            <div style={St.drawerPair}>
              <PanelField label={TXT.subAccountBank} info={TXT.infoSubBank}>
                <input list="banks" value={sub.bank} placeholder={TXT.subAccountBankPlaceholder} onChange={(e) => onUpdateSub({ bank: e.target.value })} style={St.drawerInput} />
              </PanelField>
              <PanelField label={TXT.subAccountHolder} info={TXT.infoHolder} align="right">
                <input value={sub.holder} placeholder={TXT.subAccountHolderPlaceholder} onChange={(e) => onUpdateSub({ holder: e.target.value })} style={St.drawerInput} />
              </PanelField>
            </div>
            {partners && (
              <PanelField label={TXT.subAccountOwner} info={TXT.subAccountOwnerInfo}>
                <select value={sub.ownerId || ""} onChange={(e) => onUpdateSub({ ownerId: e.target.value })} style={St.drawerInput}>
                  <option value="">{TXT.subAccountOwnerAuto}</option>
                  {partners.map((p, i) => <option key={p.id} value={p.id}>{p.name || t(LANG, "personName", { n: i + 1 })}</option>)}
                </select>
              </PanelField>
            )}
          </>
        ))}

        {dep && section(TXT.depositLabel, (
          <>
            <div style={St.drawerPair}>
              <PanelField label={TXT.depositAmount} info={TXT.infoDepositAmount}>
                <input inputMode="decimal" placeholder="0,00" value={sub.depositAmount || ""} onChange={(e) => onUpdateSub({ depositAmount: decimal(e.target.value) })} style={St.drawerInput} />
              </PanelField>
              <PanelField label={TXT.depositRateLabel} info={TXT.infoDepositRate} align="right">
                <input inputMode="decimal" placeholder="0" value={sub.interestRate || ""} onChange={(e) => onUpdateSub({ interestRate: decimal(e.target.value) })} style={St.drawerInput} />
              </PanelField>
            </div>
            <div style={St.drawerPair}>
              <PanelField label={TXT.depositStart} info={TXT.infoDepositStart}>
                <MonthField value={sub.termStart || ""} onChange={(v) => onUpdateSub({ termStart: v })} style={St.drawerInput} />
              </PanelField>
              <PanelField label={TXT.depositTerm} info={TXT.infoDepositTerm} align="right">
                <input inputMode="numeric" list="depositTerms" placeholder="12" value={sub.termMonths || ""} onChange={(e) => onUpdateSub({ termMonths: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) })} style={St.drawerInput} />
                <datalist id="depositTerms">{[3, 6, 9, 12, 18, 24, 36, 48, 60, 84, 120].map((n) => <option key={n} value={n}>{horizonLabel(n)}</option>)}</datalist>
              </PanelField>
            </div>
            {end ? (
              <div style={{ ...St.drawerMuted, marginTop: 8 }}>
                {t(LANG, sel > end ? "depositEndedOn" : "depositEndsOn", { month: monthLong(end) })}
                {atEnd && <> · {t(LANG, "depositAtEnd", { amount: eur(atEnd.balance), interest: eur(atEnd.interest) })}</>}
              </div>
            ) : <div style={{ ...St.drawerMuted, marginTop: 8 }}>{TXT.depositIncomplete}</div>}
          </>
        ))}

        {!dep && section(TXT.panelMoney, isMain ? (
          <>
            <div style={St.drawerMuted}>{t(LANG, "mainAccountFlow", { incoming: eur(entryMonthly), forwarded: eur(entryMonthly - remainder), remainder: eur(remainder) })}</div>
            {remainder < -0.005 && <div style={{ ...St.drawerMuted, color: C.exp, marginTop: 4 }}>{t(LANG, "mainAccountShrinks", { amount: eur(-remainder) })}</div>}
          </>
        ) : (
          <>
            <PanelField label={TXT.subAccountTransfer} info={TXT.infoTransferMode}>
              <div style={{ ...St.toggle, alignSelf: "flex-start" }} role="group" aria-label={TXT.subAccountTransfer}>
                <button type="button" onClick={() => onUpdateSub({ transferMode: "amount" })} style={{ ...St.toggleBtn, ...(byAmount ? St.toggleOn : {}) }}>{TXT.subTransferModeAmount}</button>
                <button type="button" onClick={() => onUpdateSub({ transferMode: "percent" })} style={{ ...St.toggleBtn, ...(!byAmount ? St.toggleOn : {}) }}>{TXT.subTransferModePercent}</button>
              </div>
            </PanelField>
            {byAmount ? (
              <>
                <div style={St.drawerPair}>
                  <PanelField label={TXT.subTransferAmount} info={TXT.infoTransferAmount}>
                    <input inputMode="decimal" placeholder="0,00" style={St.drawerInput}
                      value={(amountKey.current ? sub.transferAmounts?.[amountKey.current] : valueAt(sub.transferAmounts, sel)) ?? ""}
                      onFocus={() => { amountKey.current = transferTargetKey(sub.transferAmounts, sel); }}
                      onBlur={() => { amountKey.current = null; }}
                      onChange={(e) => {
                        const key = amountKey.current || transferTargetKey(sub.transferAmounts, sel);
                        amountKey.current = key;
                        onUpdateSub({ transferAmounts: setTransferAmountAt(sub.transferAmounts, key, decimal(e.target.value)) });
                      }} />
                  </PanelField>
                  <PanelField label={TXT.subTransferDay} info={TXT.infoTransferDay} align="right">
                    <input inputMode="numeric" placeholder="25" value={sub.transferDay ?? ""} style={St.drawerInput}
                      onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 2); onUpdateSub({ transferDay: v && Number(v) > 31 ? "31" : v }); }} />
                  </PanelField>
                </div>
                <div style={{ ...St.drawerMuted, marginTop: 6 }}>
                  {amountHistory.length ? amountHistory.map(([k, v]) => t(LANG, k === FROM_START ? "transferFromStart" : "transferFromMonth", { amount: eur(num(v)), month: monthShortWithYear(k) })).join(" · ") : TXT.transferNoneYet}
                  {amountHistory.length > 0 && <> · {t(LANG, "transferEditHint", { month: monthShortWithYear(sel) })}</>}
                </div>
              </>
            ) : (
              <PanelField label={TXT.subAccountShare} info={TXT.subAccountShareInfo}>
                <input inputMode="decimal" placeholder="100" value={sub.sharePercent ?? "100"} onChange={(e) => onUpdateSub({ sharePercent: decimal(e.target.value) })} style={St.drawerInput} />
                <span style={St.drawerMuted}>= {eur(subAccountContribution(sub, entryMonthly, sel))} {TXT.perMonth}</span>
              </PanelField>
            )}
          </>
        ))}

        {!dep && section(TXT.panelBalance, (
          <>
            <div style={St.drawerPair}>
              <PanelField label={t(LANG, "checkpointBalanceIn", { month: monthShortWithYear(sel) })} info={TXT.checkpointInfo}>
                <input inputMode="decimal" value={checkpoints[sel] ?? ""} placeholder={expected != null ? String(round2(expected)).replace(".", ",") : "0,00"}
                  onChange={(e) => setCheckpoint(decimal(e.target.value))} style={St.drawerInput} />
              </PanelField>
              <PanelField label={TXT.subAccountInterestRate} info={TXT.subAccountInterestRateInfo} align="right">
                <input inputMode="decimal" placeholder="0" value={(isMain ? goal.mainInterestRate : sub.interestRate) || ""} style={St.drawerInput}
                  onChange={(e) => (isMain ? onUpdateGoal({ mainInterestRate: decimal(e.target.value) }) : onUpdateSub({ interestRate: decimal(e.target.value) }))} />
              </PanelField>
            </div>
            <div style={{ ...St.drawerMuted, marginTop: 6 }}>{expected != null ? t(LANG, "balanceExpected", { amount: eur(expected) }) : TXT.balanceNoExpectation}</div>
            {isMain && (
              <PanelField label={TXT.bufferAmount} info={TXT.bufferAmountInfo}>
                <input inputMode="decimal" placeholder="0" value={goal.bufferAmount || ""} onChange={(e) => onUpdateGoal({ bufferAmount: decimal(e.target.value) })} style={St.drawerInput} />
              </PanelField>
            )}
          </>
        ))}

        {!isMain && section(TXT.subAccountBankDetails, (
          <>
            <PanelField label={TXT.subAccountIban} info={TXT.infoIban}>
              <span style={St.panelInputRow}>
                <input value={sub.iban} placeholder={TXT.subAccountIbanPlaceholder} onChange={(e) => onUpdateSub({ iban: e.target.value })} style={St.drawerInput} />
                <CopyButton value={sub.iban} />
              </span>
            </PanelField>
            <PanelField label={TXT.subAccountReference} info={TXT.infoReference}>
              <span style={St.panelInputRow}>
                <input value={sub.referenceId} placeholder={TXT.subAccountReferencePlaceholder} onChange={(e) => onUpdateSub({ referenceId: e.target.value })} style={St.drawerInput} />
                <CopyButton value={sub.referenceId} />
              </span>
            </PanelField>
            <PanelField label={TXT.subAccountPlanId} info={TXT.infoPlanId}>
              <span style={St.panelInputRow}>
                <input value={sub.planId} placeholder={TXT.subAccountPlanIdPlaceholder} onChange={(e) => onUpdateSub({ planId: e.target.value })} style={St.drawerInput} />
                <CopyButton value={sub.planId} />
              </span>
            </PanelField>
          </>
        ))}

        {!isMain && (
          <button type="button" onClick={() => { if (window.confirm(t(LANG, "confirmRemoveAccount", { name: title }))) onRemoveSub(); }} style={St.drawerDelete}>
            <Trash2 size={15} /> {TXT.removeAccount}
          </button>
        )}
      </aside>
    </>
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
      <div style={{ ...St.leftoverAmount, color: amount < 0 ? C.exp : C.ink }}>{eur(amount)}</div>
      <div style={St.leftoverYr}>{eur0(amount * 12)} {TXT.perYearShort}</div>
    </div>
  );
}

// segments: [{ id, name, color, frac }] — need not sum to 1 (the "custom"
// method can be over/under-allocated); only the rendered widths are clamped,
// not the underlying values, so the percentages shown stay honest.
function SplitBar({ label, segments }) {
  const clamped = segments.map((s) => ({ ...s, frac: Math.max(0, s.frac) }));
  const sum = clamped.reduce((s, x) => s + x.frac, 0) || 1;
  return (
    <div style={St.splitWrap}>
      <div style={St.splitHead}>
        <span style={St.splitLabel}>{label}</span>
        <span style={St.splitPcts}>{segments.map((s) => pct(s.frac)).join(" · ")}</span>
      </div>
      <div style={St.splitTrack}>
        {clamped.map((s, i) => (
          <div key={s.id} style={{
            width: `${(s.frac / sum) * 100}%`, background: s.color,
            borderTopLeftRadius: i === 0 ? 999 : 0, borderBottomLeftRadius: i === 0 ? 999 : 0,
            borderTopRightRadius: i === clamped.length - 1 ? 999 : 0, borderBottomRightRadius: i === clamped.length - 1 ? 999 : 0,
          }} title={s.name} />
        ))}
      </div>
    </div>
  );
}

// Live remaining-% indicator for the "custom" split method — no
// normalization happens automatically; this just tells the user where they
// stand so they can self-correct.
function CustomPctRemaining({ pcts }) {
  const sum = pcts.reduce((s, v) => s + v, 0);
  const remaining = round2(100 - sum);
  const over = remaining < 0;
  return (
    <span style={{ fontSize: 12.5, fontWeight: 600, color: over ? C.exp : (remaining === 0 ? C.save : C.muted) }}>
      {over ? t(LANG, "customPctOver", { pct: pct(Math.abs(remaining) / 100) }) : t(LANG, "customPctLeft", { pct: pct(remaining / 100) })}
    </span>
  );
}

function MoneyInput({ value, onChange, onCommit, disabled }) {
  const startRef = useRef(null);
  return (
    <div style={St.money} className="money">
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

// Shared by the entry and month CopyPicker: a checkbox list of months with
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

// Pick individual past and/or future months, used both to copy one entry's
// amount (detail panel) and to copy a whole month (month actions).
function CopyPicker({ pastMonths, futureMonths, onCopy, emptyText }) {
  const [pastSel, setPastSel] = useState([]);
  const [futureSel, setFutureSel] = useState([]);
  if (!pastMonths.length && !futureMonths.length) return <div style={St.copyEmpty}>{emptyText}</div>;
  const none = !pastSel.length && !futureSel.length;
  const apply = () => { if (!none) { onCopy(pastSel, futureSel); setPastSel([]); setFutureSel([]); } };
  return (
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
      <button type="button" onClick={apply} disabled={none} style={{ ...St.copyApply, opacity: none ? 0.5 : 1 }}>{TXT.copy}</button>
    </>
  );
}

function LinkEditor({ value, onChange }) {
  const has = value && value.trim().length > 0;
  const href = has ? (/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`) : null;
  return (
    <>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…" style={St.drawerInput} aria-label={TXT.link} />
      {href && <a href={href} target="_blank" rel="noopener noreferrer" style={{ ...St.noteLink, borderTop: "none", paddingTop: 0 }}>{TXT.openLink}</a>}
    </>
  );
}

function FormulaEditor({ entry, monthData, onChange }) {
  const [sourceId, setSourceId] = useState(entry.formula?.sourceId || "");
  // ops: sequential operations [{op: 'minus'|'times'|'divide'|'plus', factor: '12'}]
  const [ops, setOps] = useState(() => {
    if (entry.formula?.ops) return entry.formula.ops.map((s) => ({ op: s.op, factor: String(s.factor ?? "0") }));
    if (entry.formula?.op) return [{ op: entry.formula.op, factor: String(entry.formula.factor ?? "0") }];
    return [];
  });
  const has = Boolean(entry.formula);
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
  const preview = computeFormulaAmount({ ...entry, formula: { sourceId, ops } }, monthData);
  const onRemove = () => {
    setSourceId(""); setOps([]); onChange({ formula: undefined });
  };
  const updateSource = (value) => { setSourceId(value); onChange({ formula: { sourceId: value, ops } }); };
  const updateOpAt = (idx, newOp) => { const n = ops.slice(); n[idx] = { ...n[idx], op: newOp }; setOps(n); onChange({ formula: { sourceId, ops: n } }); };
  const updateFactorAt = (idx, newFactor) => { const n = ops.slice(); n[idx] = { ...n[idx], factor: newFactor }; setOps(n); onChange({ formula: { sourceId, ops: n } }); };
  const addOp = () => { const n = [...ops, { op: "minus", factor: "0" }]; setOps(n); onChange({ formula: { sourceId, ops: n } }); };
  const removeOpAt = (idx) => { const n = ops.slice(); n.splice(idx, 1); setOps(n); onChange({ formula: { sourceId, ops: n } }); };
  return (
    <>
      <select value={sourceId} onChange={(e) => updateSource(e.target.value)} style={{ ...St.drawerInput, marginBottom: 8 }} aria-label={TXT.sourceRule}>
        <option value="">— {TXT.selectSource} —</option>
        {entries.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      {sourceId && (
        <>
          {ops.map((step, idx) => (
            <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <select value={step.op} onChange={(e) => updateOpAt(idx, e.target.value)} style={{ ...St.drawerInput, width: "auto" }}>
                <option value="minus">{TXT.minus || "min"}</option>
                <option value="plus">{TXT.plus || "plus"}</option>
                <option value="times">{TXT.times || "keer"}</option>
                <option value="divide">{TXT.divide || "gedeeld door"}</option>
              </select>
              <input value={step.factor} onChange={(e) => updateFactorAt(idx, e.target.value.replace(/[^0-9.,-]/g, ""))} style={{ ...St.drawerInput, width: 100 }} inputMode="decimal" />
              <button type="button" onClick={() => removeOpAt(idx)} style={St.iconBtn} aria-label={TXT.delete}><X size={16} /></button>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
            <button type="button" onClick={addOp} style={St.ghostBtn}><Plus size={13} style={{ verticalAlign: "-2px" }} /> {TXT.addOperation}</button>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{TXT.preview}: {preview != null ? eur(preview) : "—"}</span>
          </div>
          {has && <button type="button" onClick={onRemove} style={{ ...St.ghostBtn, color: C.exp, marginTop: 10 }}>{TXT.delete}</button>}
        </>
      )}
    </>
  );
}

// Savings sub-accounts keep their few settings as inline icons; on phones
// (see the ≤640px CSS) they're tucked behind a "⋯" button instead.
function EntryActions({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="entryMore" aria-expanded={open} aria-label={TXT.moreActions}
        onClick={() => setOpen((o) => !o)} style={{ ...St.iconBtn, color: open ? C.ink : C.muted }}>
        <MoreHorizontal size={18} />
      </button>
      <span className={`entryActions${open ? " open" : ""}`}>{children}</span>
    </>
  );
}

function NoteEditor({ value, onChange }) {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={TXT.notePlaceholder} style={{ ...St.drawerInput, resize: "vertical", lineHeight: 1.45 }} aria-label={TXT.note} />;
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

  errorBanner: { display: "flex", gap: 10, alignItems: "center", background: `color-mix(in srgb, ${C.exp} 10%, ${C.card})`, border: `1px solid ${C.exp}`, color: C.ink, borderRadius: 14, padding: "12px 14px", marginTop: 12, marginBottom: 4, fontSize: 13.5, flexWrap: "wrap" },
  historyBanner: { display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", background: C.canvas, border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 14px", marginTop: 12, marginBottom: 4, fontSize: 13.5, color: C.muted, flexWrap: "wrap" },
  historyBannerBtn: { border: "none", background: C.card, color: C.ink, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: "7px 14px", borderRadius: 999, boxShadow: "0 1px 3px rgba(0,0,0,0.10)", flexShrink: 0 },
  historyLockedContent: { opacity: 0.75, filter: "grayscale(0.35)", pointerEvents: "none", userSelect: "none" },

  header: { padding: "8px 4px 16px" },
  headerTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" },
  eyebrow: { fontSize: 12, letterSpacing: "0.14em", color: C.muted, fontWeight: 600 },
  titleRow: { display: "flex", alignItems: "center", gap: 10, marginTop: 6 },
  h1: { fontFamily: "'Inter', system-ui, sans-serif", fontSize: 32, lineHeight: 1.05, margin: 0, fontWeight: 800, letterSpacing: "-0.02em" },
  colTitle: { fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", color: C.ink, margin: "4px 2px 14px" },

  monthNav: { display: "flex", alignItems: "center", gap: 8, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "10px 14px", marginBottom: 14, flexWrap: "wrap" },
  navBtn: { border: "none", background: C.canvas, color: C.ink, cursor: "pointer", width: 38, height: 38, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center" },
  monthLabelWrap: { position: "relative", display: "flex", alignItems: "center", gap: 8, minWidth: 0, padding: "0 6px", cursor: "pointer" },
  monthLabel: { fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 19, fontWeight: 700, textTransform: "capitalize" },
  nowTag: { fontSize: 11, fontWeight: 700, color: C.save, background: `color-mix(in srgb, ${C.save} 14%, transparent)`, padding: "2px 7px", borderRadius: 999 },
  monthSelect: { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", fontSize: 16 },
  currentBtn: { minWidth: 0, border: "none", background: C.canvas, color: C.ink, cursor: "pointer", borderRadius: 10, padding: "10px 12px", fontSize: 13, fontWeight: 700, boxShadow: "0 1px 2px rgba(0,0,0,0.08)", whiteSpace: "nowrap" },

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

  contribGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 18 },
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
  leftoverGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 },
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

  itemWrap: { padding: "6px 8px", margin: "0 -8px 4px", borderRadius: 12 },
  subRow: { marginBottom: 12 },
  subSummary: { fontSize: 12.5, color: C.muted, marginTop: 4, paddingLeft: 2, fontVariantNumeric: "tabular-nums" },
  mainAccountHead: { display: "flex", alignItems: "center", gap: 10 },
  accountRowHead: { display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" },
  panelFieldLabel: { display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: C.muted },
  panelInputRow: { display: "flex", alignItems: "center", gap: 4 },
  mainAccountFields: { display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 },
  accountPots: { color: C.muted, fontSize: 12 },
  ownerTag: { fontSize: 11.5, fontWeight: 600, color: C.muted, background: C.canvas, borderRadius: 999, padding: "1px 8px", marginLeft: 4 },
  updateCount: { fontSize: 13, color: C.muted, fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  balanceRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.line}` },
  balanceName: { flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 4, fontSize: 14 },
  balanceExpected: { flexBasis: "100%", fontSize: 12, color: C.muted, fontVariantNumeric: "tabular-nums" },
  tipBox: { display: "flex", gap: 10, alignItems: "flex-start", marginTop: 10, padding: "10px 12px", borderRadius: 12, background: "rgba(46, 125, 82, 0.08)", border: "1px solid rgba(46, 125, 82, 0.2)", fontSize: 13, color: C.ink, lineHeight: 1.45 },
  flags: { display: "inline-flex", alignItems: "center", gap: 6, color: C.muted, verticalAlign: "middle" },
  flagChip: { display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600 },
  drawer: { background: C.card, color: C.ink, fontFamily: "'Inter', system-ui, sans-serif" },
  drawerHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 4 },
  drawerCrumb: { fontSize: 12.5, color: C.muted, minWidth: 0 },
  drawerTitle: { width: "100%", border: "none", borderBottom: `1px solid transparent`, background: "transparent", color: C.ink, fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 24, fontWeight: 700, padding: "4px 0 6px", outline: "none", marginBottom: 6 },
  drawerAmountRow: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px 12px" },
  drawerMuted: { fontSize: 12.5, color: C.muted, fontVariantNumeric: "tabular-nums" },
  drawerSection: { borderTop: `1px solid ${C.line}`, paddingTop: 12, marginTop: 14 },
  drawerLabel: { fontSize: 11.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: C.muted, marginBottom: 8 },
  drawerSub: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: C.muted, minWidth: 0 },
  drawerPair: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8 },
  drawerInput: { width: "100%", border: `1px solid ${C.line}`, borderRadius: 10, background: C.canvas, color: C.ink, fontFamily: "inherit", fontSize: 14, padding: "8px 10px", outline: "none", boxSizing: "border-box" },
  drawerDelete: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", marginTop: 18, border: `1px solid ${C.exp}`, background: "transparent", color: C.exp, fontFamily: "inherit", fontSize: 14, fontWeight: 600, padding: "10px 12px", borderRadius: 12, cursor: "pointer" },
  navRow: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginTop: 10 },
  viewAs: { display: "inline-flex", alignItems: "center", gap: 6 },
  viewAsLabel: { fontSize: 12.5, color: C.muted, marginRight: 2 },
  viewAsBtn: { display: "inline-flex", alignItems: "center", gap: 7, borderWidth: 1, borderStyle: "solid", borderColor: "transparent", background: "transparent", color: C.ink, fontFamily: "inherit", fontSize: 13, fontWeight: 600, padding: "3px 12px 3px 3px", borderRadius: 999, cursor: "pointer" },
  viewAsOn: { background: C.card, borderColor: C.line, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" },
  avatar: { width: 28, height: 28, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700, flexShrink: 0 },
  tiles: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 12 },
  tile: { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", minWidth: 0 },
  tileLabel: { fontSize: 12.5, fontWeight: 600, color: C.muted },
  tileValue: { fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 23, fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" },
  tileSub: { fontSize: 12, color: C.muted },
  personalLegend: { display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 8, fontSize: 12, color: C.muted },
  personalLegendItem: { display: "inline-flex", alignItems: "center", gap: 6 },
  monthActionsBtn: { display: "inline-flex", alignItems: "center", gap: 8, border: "none", background: C.canvas, color: C.ink, fontFamily: "inherit", fontSize: 13, fontWeight: 600, height: 38, padding: "0 12px", borderRadius: 10, cursor: "pointer" },
  menuPop: { position: "absolute", top: "calc(100% + 8px)", right: 0, width: 260, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.16)", padding: 6, zIndex: 50, display: "flex", flexDirection: "column" },
  menuItem: { display: "flex", alignItems: "center", gap: 10, border: "none", background: "transparent", color: C.ink, fontFamily: "inherit", fontSize: 13.5, textAlign: "left", padding: "9px 10px", borderRadius: 8, cursor: "pointer" },
  menuDivider: { height: 1, background: C.line, margin: "4px 6px" },
  row: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  rowActions: { display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 },
  expRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  dot: { width: 10, height: 10, borderRadius: 999, flexShrink: 0 },
  nameInput: { flex: 1, minWidth: 90, border: "none", borderBottom: `1px solid ${C.line}`, background: "transparent", padding: "8px 2px", fontSize: 15, color: C.ink, fontFamily: "inherit", outline: "none" },
  catInput: { width: 128, flexShrink: 0, border: "none", borderBottom: `1px solid ${C.line}`, background: C.canvas, borderRadius: "6px 6px 0 0", padding: "8px 8px", fontSize: 12.5, color: C.muted, fontFamily: "inherit", outline: "none" },
  derived: { fontSize: 12, color: C.muted, marginTop: 4, fontVariantNumeric: "tabular-nums" },
  derivedCorrespondent: { color: C.b, fontWeight: 600 },
  rail: { display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: "2px 8px", verticalAlign: "middle" },
  railTrack: { display: "inline-flex", alignItems: "center" },
  railDot: { width: 8, height: 8, borderRadius: 999, boxSizing: "border-box", flexShrink: 0, display: "inline-block" },
  railLine: { width: 7, height: 1.5, background: C.line },
  railCur: { width: 5, height: 5, borderRadius: 999, background: C.ink, flexShrink: 0 },
  ghostRow: { border: `1px dashed ${C.line}`, borderRadius: 12, padding: "8px 12px", marginBottom: 12, opacity: 0.85 },
  ghostHead: { display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14, color: C.muted, textDecoration: "line-through", textDecorationColor: C.line },
  ghostLabel: { fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ghostAmount: { fontVariantNumeric: "tabular-nums", flexShrink: 0 },
  ghostMeta: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px 10px", marginTop: 6, fontSize: 12.5, color: C.muted },
  ghostBtn: { border: `1px solid ${C.line}`, background: C.card, color: C.ink, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: "5px 10px", borderRadius: 999 },
  diffRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  diffPanel: { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", marginTop: 8 },
  diffHead: { fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 },
  diffItem: { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13.5, padding: "3px 0" },
  diffAmount: { fontVariantNumeric: "tabular-nums", flexShrink: 0, color: C.ink },
  diffChip: { display: "inline-flex", alignItems: "center", gap: 7, border: `1px solid ${C.line}`, background: C.card, color: C.ink, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", padding: "6px 12px", borderRadius: 999, textAlign: "left" },
  diffChipLabel: { color: C.muted },
  dialogBackdrop: { position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  dialog: { width: "min(420px, 100%)", background: C.card, color: C.ink, borderRadius: 16, padding: 18, boxShadow: "0 12px 40px rgba(0,0,0,0.25)" },
  dialogTitle: { display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700 },
  dialogBody: { fontSize: 13.5, lineHeight: 1.5, color: C.muted, margin: "8px 0 12px" },
  dialogOption: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, width: "100%", border: `1px solid ${C.line}`, background: C.canvas, color: C.ink, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: "11px 14px", borderRadius: 12, marginTop: 8, textAlign: "left" },
  dialogOptionSub: { fontSize: 12, fontWeight: 400, color: C.muted },
  dialogCancel: { width: "100%", border: "none", background: "transparent", color: C.muted, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit", padding: "10px", marginTop: 6 },

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

  filterSum: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 12, padding: "8px 12px", borderRadius: 10, background: `color-mix(in srgb, ${C.b} 10%, transparent)`, fontSize: 13, color: C.b, fontWeight: 600 },
  filterSumVal: { fontVariantNumeric: "tabular-nums", color: C.ink, fontSize: 14 },
  searchWrap: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 14, minWidth: 0 },
  searchField: { display: "flex", alignItems: "center", gap: 8, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "2px 6px 2px 12px" },
  searchInput: { flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: C.ink, fontSize: 14.5, fontFamily: "inherit", padding: "10px 0" },
  kbd: { fontFamily: "ui-monospace, monospace", fontSize: 11.5, color: C.muted, border: `1px solid ${C.line}`, borderBottomWidth: 2, borderRadius: 6, padding: "1px 7px", marginRight: 4 },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, border: `1px solid ${C.line}`, background: C.card, color: C.muted, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", padding: "6px 11px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap" },
  chipOn: { background: C.ink, color: C.card, borderColor: C.ink },
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

  savingsGroupHead: { display: "flex", alignItems: "center", gap: 8, margin: "18px 2px 8px", fontSize: 13, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  savingsPageHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 },
  savingsHorizon: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.muted, fontWeight: 600 },
  savingsGoalName: { fontWeight: 700, fontSize: 15, padding: "8px 2px" },
  savingsGoalAmount: { fontSize: 15, fontWeight: 600, color: C.ink, fontVariantNumeric: "tabular-nums", padding: "8px 4px", cursor: "default" },
  goalForwardedToggle: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: C.ink, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  goalForwardedRow: { display: "flex", alignItems: "center", gap: 6, marginTop: 10 },
  goalForwardedTag: { fontSize: 12, color: C.muted, fontWeight: 600, marginRight: 14, whiteSpace: "nowrap" },
  addRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  savingsTableWrap: { overflowX: "auto", marginTop: 14 },
  savingsTable: { width: "100%", borderCollapse: "collapse", fontSize: 13, whiteSpace: "nowrap" },
  savingsTh: { textAlign: "right", padding: "6px 10px", color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, background: C.card },
  savingsTd: { textAlign: "right", padding: "5px 10px", color: C.ink, fontVariantNumeric: "tabular-nums", borderBottom: `1px solid ${C.line}` },
  savingsTdSub: { fontSize: 10.5, fontWeight: 500, color: C.muted },
  savingsTrReached: { background: `color-mix(in srgb, ${C.save} 10%, transparent)` },
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
input[type="search"]::-webkit-search-cancel-button, input[type="search"]::-webkit-search-decoration { -webkit-appearance: none; appearance: none; }
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
.entryMore, .bottomNav, .mobileOnly { display: none !important; }
.entryWrap { cursor: pointer; transition: background .12s; }
.entryWrap:hover { background: color-mix(in srgb, ${C.card} 55%, transparent); }
.entryWrap.selected { background: ${C.card}; box-shadow: 0 0 0 1.5px ${C.b}; }
.derived { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; }
.derived .d-cat { display: none; }
/* Month page: one column; on wide screens incomes + expenses on the left
   and the split sticky on the right, so an edit shows its effect at once. */
.monthGrid { display: grid; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 1100px) {
  .shell { max-width: 1360px !important; }
  .monthGrid:not(.single) { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); grid-template-areas: "inc res" "exp res"; column-gap: 22px; align-items: start; }
  .monthGrid:not(.single) .mg-inc { grid-area: inc; }
  .monthGrid:not(.single) .mg-exp { grid-area: exp; }
  .monthGrid:not(.single) .mg-res { grid-area: res; position: sticky; top: 12px; }
}
/* Entry detail panel: side panel on wide screens, bottom sheet on phones. */
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw); z-index: 80; overflow-y: auto; border-left: 1px solid ${C.line}; box-shadow: -12px 0 40px rgba(0,0,0,.14); padding: 16px 20px 32px; }
.drawerBackdrop { display: none; }
.hScroll { width: 100%; }
/* ── Phones ─────────────────────────────────────────────────────────
   Everything below is layout only; the same components render on every
   screen size. Inputs go to 16px so iOS Safari doesn't zoom on focus. */
@media (max-width: 640px) {
  html { -webkit-text-size-adjust: 100%; }
  body { overflow-x: hidden; }
  .page { padding: 8px 12px calc(84px + env(safe-area-inset-bottom)) !important; }
  .appHeader { padding: 6px 2px 10px !important; }
  .appTitle { font-size: 22px !important; }
  .themeLabel, .viewTabs, .searchKbd { display: none !important; }
  /* One swipeable row of chips; the faded right edge hints there are more. */
  .chipRow { flex-wrap: nowrap !important; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; padding-right: 28px; margin-right: -12px; -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent); mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent); }
  .chipRow::-webkit-scrollbar { display: none; }
  input, select, textarea { font-size: 16px !important; }

  /* Sticky month bar: ‹ month › ⋯, with "current month" on a second row when needed */
  .monthNav { position: sticky; top: 0; z-index: 20; display: grid !important; grid-template-columns: 44px minmax(0, 1fr) 44px 44px; grid-template-areas: "prev label next more" "cur cur cur cur"; gap: 8px !important; padding: 8px !important; margin: 0 -4px 12px; box-shadow: 0 4px 14px rgba(0,0,0,0.06); }
  .monthNav.isCurrent { grid-template-areas: "prev label next more"; }
  .navPrev { grid-area: prev; width: 44px !important; height: 44px !important; }
  .navNext { grid-area: next; width: 44px !important; height: 44px !important; }
  .navMore { grid-area: more; }
  .navMore > button { width: 44px; height: 44px !important; padding: 0 !important; justify-content: center; }
  .monthActionsLabel, .navSpacer, .viewAsLabel { display: none; }
  .monthLabelWrap { grid-area: label; justify-content: center; }
  .currentBtn { grid-area: cur; padding: 8px !important; }
  .appHeader .viewAs { width: 100%; }
  .tiles { grid-template-columns: 1fr 1fr !important; }

  /* Entries: a compact list, one line per entry (name, amount, ›) with the
     category and month rail underneath; everything else is in the sheet. */
  .entryWrap { margin: 0 !important; padding: 11px 2px !important; border-radius: 0 !important; border-bottom: 1px solid ${C.line}; }
  .entryWrap:hover, .entryWrap.selected { background: transparent; box-shadow: none; }
  .entry:not(.sub) { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto 28px; grid-template-areas: "lead desc amount open"; gap: 0 10px; align-items: center; }
  .entry:not(.sub) .e-lead { grid-area: lead; display: flex; }
  .entry:not(.sub) .e-lead input, .entry:not(.sub) .e-lead [draggable] { display: none !important; }
  .entry:not(.sub) .e-desc { grid-area: desc; min-width: 0; width: 100%; font-weight: 700; border-bottom: none !important; padding: 2px 0 !important; }
  .entry:not(.sub) .e-amount { grid-area: amount; }
  .entry:not(.sub) .pill-month { display: none; }
  .entry:not(.sub) .money { background: transparent !important; padding: 0 !important; }
  .entry:not(.sub) input[aria-label="${TXT.amount}"] { width: 76px !important; font-weight: 700; }
  .entryOpen { grid-area: open; padding: 4px !important; }
  .derived { margin: 0 0 0 22px !important; }
  .derived .d-cat { display: inline; }
  .derived .d-calc { display: none; }
  .drawer { top: auto; left: 0; width: 100%; max-height: 88vh; border-left: none; border-radius: 20px 20px 0 0; padding: 14px 18px calc(28px + env(safe-area-inset-bottom)); box-shadow: 0 -12px 40px rgba(0,0,0,.18); }
  .drawer .drawerTitle { font-size: 22px !important; }
  .drawerBackdrop { display: block; position: fixed; inset: 0; z-index: 79; background: rgba(0,0,0,.35); }

  /* Savings sub-accounts keep the card layout with a ⋯ for their settings */
  .subWrap { background: ${C.card}; border: 1px solid ${C.line}; border-radius: 14px; padding: 10px 12px; }
  .entry.sub { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; grid-template-areas: "desc amount amount" "lead lead more" "actions actions actions"; gap: 6px 8px; align-items: center; }
  .entry.sub .e-desc { grid-area: desc; min-width: 0; width: 100%; font-weight: 700; }
  .entry.sub .e-lead { grid-area: lead; display: flex; align-items: center; gap: 8px; min-width: 0; }
  .entry.sub .e-lead input { flex: 1; min-width: 0; width: auto !important; background: transparent !important; border-bottom-style: dashed !important; padding: 6px 2px !important; }
  .entryMore { grid-area: more; display: inline-flex !important; justify-self: end; padding: 10px !important; }
  .entry .entryActions { grid-area: actions; display: none; justify-content: space-between; margin: 2px -4px 0; padding-top: 6px; border-top: 1px solid ${C.line}; }
  .entry .entryActions.open { display: flex; }
  .entryActions button { padding: 10px !important; }

  .appFooter { justify-content: center !important; }

  /* Wide charts scroll sideways instead of squashing */
  .hScroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .sankeyBox { min-width: 680px; }
  .goalHead { flex-wrap: wrap; }

  /* Bottom tab bar */
  .bottomNav { display: flex !important; position: fixed; left: 0; right: 0; bottom: 0; z-index: 60; background: color-mix(in srgb, ${C.card} 92%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-top: 1px solid ${C.line}; padding: 6px 4px calc(6px + env(safe-area-inset-bottom)); overflow-x: auto; }
  .bottomNav button { flex: 1 0 64px; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; border: none; background: transparent; color: ${C.muted}; font: 600 10.5px/1.1 Inter, system-ui, sans-serif; padding: 6px 2px; border-radius: 12px; cursor: pointer; }
  .bottomNav button span:last-child { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bottomNav button.on { color: ${C.ink}; background: ${C.canvas}; }
  .navAvatar { width: 22px; height: 22px; border-radius: 999px; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; opacity: .75; }
  .bottomNav button.on .navAvatar { opacity: 1; box-shadow: 0 0 0 2px ${C.card}, 0 0 0 3.5px currentColor; }
}
@media (prefers-reduced-motion: reduce) { .fade, .spin { animation: none !important; } }
.print-root { display: none; }
@media print {
  body { background: #fff; }
  .shell, .bottomNav { display: none !important; }
  .print-root { display: block; color: #000; background: #fff; font-family: Arial, Helvetica, sans-serif; }
}
`;
