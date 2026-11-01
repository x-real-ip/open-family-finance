/**
 * Open Family Finance — calculations and the data model, kept free of any
 * React/UI/i18n code so they can be unit tested on their own (see
 * finance.test.js, run with `npm test`).
 *
 *   Defaults & helpers .. empty figures, number parsing, month keys
 *   computeTotals ....... the fair split between people
 *   Data model .......... migrate/normalize older saved blobs
 *   Savings ............. contributions, transfers and balance projections
 */
/* Empty defaults. Real amounts are stored in the database, not in the
   code, so this repository can be public. */
// A household can have any number of people (not just 2) — `partners` is an
// id-addressed list, not a fixed pair. Seeding a brand-new install with 2
// blank people is just a UX nicety matching the common case, not a hard
// requirement (addPerson/removePerson work for any length ≥ 1).
export const DEFAULT_PERSON = { id: "p1", name: "", income: "", period: "month", note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" };
export const DEFAULT_FIGURES = {
  method: "income",
  margePct: "0.5",
  // Per-person share for the "custom" split method, keyed by person id (was
  // a single scalar back when there were always exactly 2 people).
  customPct: {},
  partners: [{ ...DEFAULT_PERSON }, { ...DEFAULT_PERSON, id: "p2" }],
  govIncome: [],
  expenses: [],
  savings: [],
  // Each person's own personal fixed costs, keyed by their id — kept separate
  // from the shared `expenses` list so one person filling theirs in doesn't
  // affect anyone else's or the joint total.
  personalExpenses: {},
  // Each person's own savings pots, keyed by person id — same shape and
  // reasoning as personalExpenses: paid from their own leftover, never part
  // of the joint pot or the split.
  personalSavings: {},
  overrides: {},
};

/* ----------------------------------------------------------------
   Helpers
------------------------------------------------------------------- */
// — numbers & amounts —
export const num = (x) => { const v = parseFloat(String(x).replace(",", ".")); return isFinite(v) ? v : 0; };
export const round2 = (n) => Math.round(n * 100) / 100;
export const clamp01 = (n) => Math.min(1, Math.max(0, n));
export const toMonthly = (amountStr, period) => num(amountStr) / (period === "year" ? 12 : 1);
export const monthlyOf = (x, monthData, visited = new Set()) => {
  if (x?.formula && monthData) {
    if (visited.has(x.id)) return 0;
    const amount = computeFormulaAmount(x, monthData);
    return toMonthly(amount, x.period);
  }
  return toMonthly(x.amount, x.period);
};
export const monthlyInc = (p) => toMonthly(p.income, p.period);
export const entryKinds = ["govIncome", "expenses", "savings"];
export const findEntryById = (monthData, id) => {
  if (!monthData || !id) return null;
  for (const kind of entryKinds) {
    const item = (monthData[kind] || []).find((x) => x.id === id);
    if (item) return item;
  }
  for (const kind of PERSONAL_KINDS) {
    for (const list of Object.values(monthData[kind] || {})) {
      const item = list.find((x) => x.id === id);
      if (item) return item;
    }
  }
  return null;
};
export const computeFormulaAmount = (entry, monthData) => {
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
export const entryAmount = (entry, monthData) => {
  const formulaAmount = computeFormulaAmount(entry, monthData);
  return formulaAmount != null ? formulaAmount : num(entry.amount);
};
export const sumM = (arr, monthData) => arr.reduce((s, x) => s + monthlyOf(x, monthData), 0);
// The per-person lists (keyed by person id, one level deeper than the flat
// joint lists). Anything addressing an entry by (kind, personId) goes
// through listAt/withList so both behave the same everywhere.
export const PERSONAL_KINDS = ["personalExpenses", "personalSavings"];
export const listAt = (fig, kind, personId) => (personId ? (fig?.[kind]?.[personId] || []) : ((fig && fig[kind]) || []));
export const withList = (fig, kind, personId, list) => (personId
  ? { ...fig, [kind]: { ...(fig[kind] || {}), [personId]: list } }
  : { ...fig, [kind]: list });
// Every savings entry of a month, joint and personal, with who it belongs to
// (personId null = joint). The savings overview and its projections work
// from this, so a personal pot behaves exactly like a joint one there.
export const allSavingsOf = (fig) => [
  ...(fig?.savings || []).map((e) => ({ e, personId: null })),
  ...Object.entries(fig?.personalSavings || {}).flatMap(([personId, list]) => list.map((e) => ({ e, personId }))),
];
export const flip = (amountStr, fromPeriod) => String(round2(fromPeriod === "year" ? num(amountStr) / 12 : num(amountStr) * 12));
export const pctOf = (part, whole) => (whole > 0 ? part / whole : null);

export const uid = () => Math.random().toString(36).slice(2, 9);
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const keyToDate = (k) => { const [y, m] = k.split("-").map(Number); return new Date(y, m - 1, 1); };
export const shiftMonth = (k, delta) => { const d = keyToDate(k); d.setMonth(d.getMonth() + delta); return monthKey(d); };
// Read-only figures for any month key, including ones never actually visited
// (e.g. the rest of a year being printed) — same forward-fill rule goMonth
// uses to seed a new month, just without writing it back to `data.months`.
export const figuresFor = (months, key) => {
  if (months[key]) return months[key];
  const earlier = Object.keys(months).filter((k) => k < key).sort();
  return earlier.length ? months[earlier[earlier.length - 1]] : DEFAULT_FIGURES;
};
/* ----------------------------------------------------------------
   Core calculation — the fair split

   coupleFunds = expenses + savings − government benefits
   Each partner contributes a share of coupleFunds — proportional to
   net income ("verhouding") or 50/50 ("equal") — plus a small safety
   margin (margePct). leftover = own salary − own contribution.
------------------------------------------------------------------- */
// All per-person results are keyed by person id (not a fixed a/b pair), so
// this works for any number of people ≥ 1.
export function computeTotals(fig) {
  const people = fig.partners.map((p) => ({ id: p.id, income: monthlyInc(p) }));
  const total = people.reduce((s, p) => s + p.income, 0);
  const n = people.length;
  const shares = {};
  for (const p of people) shares[p.id] = total > 0 ? p.income / total : (n ? 1 / n : 0);

  const expensesTotal = sumM(fig.expenses, fig), savingsTotal = sumM(fig.savings, fig);
  const potTotal = expensesTotal + savingsTotal, govTotal = sumM(fig.govIncome, fig);
  const coupleFunds = Math.max(0, potTotal - govTotal);
  const marge = num(fig.margePct) / 100;

  const bases = {};
  if (fig.method === "equal") {
    for (const p of people) bases[p.id] = n ? coupleFunds / n : 0;
  } else if (fig.method === "custom") {
    // Each person's raw share of coupleFunds, taken at face value — the sum
    // is deliberately never clamped/rescaled to 100%. If it doesn't add up,
    // that's surfaced to the user as a "remaining %" indicator in the UI,
    // not silently corrected here.
    const customPct = fig.customPct || {};
    for (const p of people) bases[p.id] = coupleFunds * clamp01(num(customPct[p.id]) / 100);
  } else {
    for (const p of people) bases[p.id] = coupleFunds * shares[p.id];
  }

  const transfers = {}, leftovers = {}, keeps = {};
  let transferSum = 0;
  for (const p of people) {
    const t = bases[p.id] * (1 + marge);
    transfers[p.id] = t;
    transferSum += t;
    leftovers[p.id] = p.income - t;
    keeps[p.id] = p.income > 0 ? leftovers[p.id] / p.income : 0;
  }
  const buffer = transferSum - coupleFunds;
  const contribShares = {};
  for (const p of people) contribShares[p.id] = transferSum > 0 ? transfers[p.id] / transferSum : (n ? 1 / n : 0);

  return {
    total, expensesTotal, savingsTotal, potTotal, govTotal, coupleFunds, buffer,
    people, shares, transfers, leftovers, keeps, contribShares,
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
export function migrateFig(f) {
  if (!f) return clone(DEFAULT_FIGURES);
  const per = (p) => (p === "year" ? "year" : "month");
  // Unlike every other entry kind, partners never used to get an `id`
  // fallback here — now that personal expenses are keyed by person id, every
  // person needs a stable one.
  const partners = (f.partners && f.partners.length ? f.partners : clone(DEFAULT_FIGURES.partners)).map((p) => ({
    id: p.id || uid(), name: p.name || "", income: p.income ?? "", period: per(p.period),
    note: p.note || "", url: p.url || "", correspondent: p.correspondent || "",
    documentMode: p.documentMode || "auto", documentLabel: p.documentLabel || null, documentId: p.documentId ?? null,
    startDate: p.startDate || "", endDate: p.endDate || "", warningDays: p.warningDays || "",
  }));

  // customPct used to be a single scalar (0-100, "first person's share,
  // second gets the rest"). Migrate that into a per-person map, preserving
  // the exact old 2-person math; a 3rd+ person already present in a
  // hand-edited blob gets no opinion ("") rather than silently grabbing a
  // share. Also drop stale keys for people no longer present.
  let customPct;
  if (f.customPct && typeof f.customPct === "object") {
    customPct = { ...f.customPct };
  } else {
    const oldScalar = f.customPct ?? "50";
    customPct = {};
    partners.forEach((p, i) => {
      if (i === 0) customPct[p.id] = String(oldScalar);
      else if (i === 1) customPct[p.id] = String(round2(100 - num(oldScalar)));
    });
  }
  const cleanedCustomPct = {};
  for (const p of partners) cleanedCustomPct[p.id] = customPct[p.id] ?? "";
  customPct = cleanedCustomPct;

  const migrateEntry = (e) => ({ id: e.id || uid(), category: e.category || "", label: e.label || "", amount: e.amount ?? "", period: per(e.period), note: e.note || "", url: e.url || "", correspondent: e.correspondent || "", documentMode: e.documentMode || "auto", documentLabel: e.documentLabel || null, documentId: e.documentId ?? null, startDate: e.startDate || "", endDate: e.endDate || "", warningDays: e.warningDays || "", formula: e.formula || undefined });

  // personalExpenses used to be two fixed sibling arrays (personalExpensesA/B).
  // Migrate those onto the first two people's ids; a blob that's already in
  // the new shape (an object keyed by person id) passes through as-is.
  let personalExpenses;
  if (f.personalExpenses && typeof f.personalExpenses === "object" && !Array.isArray(f.personalExpenses)) {
    personalExpenses = {};
    for (const p of partners) personalExpenses[p.id] = (f.personalExpenses[p.id] || []).map(migrateEntry);
  } else {
    personalExpenses = {};
    partners.forEach((p, i) => {
      const legacyKey = i === 0 ? "personalExpensesA" : i === 1 ? "personalExpensesB" : null;
      personalExpenses[p.id] = legacyKey ? (f[legacyKey] || []).map(migrateEntry) : [];
    });
  }

  const personalSavings = {};
  for (const p of partners) personalSavings[p.id] = ((f.personalSavings && f.personalSavings[p.id]) || []).map(migrateEntry);

  return {
    method: f.method || "income", margePct: f.margePct ?? "0.5",
    customPct, partners,
    govIncome: (f.govIncome || []).map((g) => ({ id: g.id || uid(), label: g.label || "", amount: g.amount ?? "", period: per(g.period), note: g.note || "", url: g.url || "", correspondent: g.correspondent || "", documentMode: g.documentMode || "auto", documentLabel: g.documentLabel || null, documentId: g.documentId ?? null, startDate: g.startDate || "", endDate: g.endDate || "", warningDays: g.warningDays || "", formula: g.formula || undefined })),
    expenses: (f.expenses || []).map(migrateEntry),
    savings: f.savings ? f.savings.map((s) => ({ id: s.id || uid(), label: s.label || "", amount: s.amount ?? "", period: per(s.period), note: s.note || "", url: s.url || "", correspondent: s.correspondent || "", documentMode: s.documentMode || "auto", documentLabel: s.documentLabel || null, documentId: s.documentId ?? null, startDate: s.startDate || "", endDate: s.endDate || "", warningDays: s.warningDays || "", formula: s.formula || undefined }))
      : (f.jointSavings != null ? [{ id: uid(), label: "Sparen", amount: f.jointSavings, period: "month", note: "", url: "", correspondent: "", documentMode: "auto", documentLabel: null, documentId: null, startDate: "", endDate: "", warningDays: "" }] : []),
    personalExpenses,
    personalSavings,
    overrides: (f.overrides && typeof f.overrides === "object") ? { ...f.overrides } : {},
  };
}
// "manual" = the stored entry order (drag handles reorder it); the other modes derive an order on the fly.
// Everyone's personal expenses share one sort-mode preference (personalExpenses),
// rather than one per person — a deliberate simplification.
export const SORT_MODES = { govIncome: ["manual", "name"], expenses: ["manual", "category", "name"], savings: ["manual", "name"], personalExpenses: ["manual", "category", "name"], personalSavings: ["manual", "name"] };
export const DEFAULT_LIST_SORT = { govIncome: "manual", expenses: "manual", savings: "manual", personalExpenses: "manual", personalSavings: "manual" };
export function listSortOf(raw) {
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
export function migrateCheckpoints(o) {
  if (o.checkpoints && typeof o.checkpoints === "object") return { ...o.checkpoints };
  if (o.checkpointMonth) return { [o.checkpointMonth]: o.checkpointBalance ?? "" };
  return {};
}
// Key used for a value that applies from the very first month.
export const FROM_START = "0000-01";
function migrateTransferAmounts(s) {
  if (s.transferAmounts && typeof s.transferAmounts === "object") return { ...s.transferAmounts };
  return s.transferAmount !== undefined && s.transferAmount !== "" ? { [FROM_START]: String(s.transferAmount) } : {};
}
// The value of a month-scoped map ({ "YYYY-MM": value }) in month `key`:
// the latest entry at or before it, or null when nothing applies yet.
export function valueAt(map, key) {
  let best = null;
  for (const k of Object.keys(map || {})) if (k <= key && (best == null || k > best)) best = k;
  return best == null ? null : map[best];
}
export const transferAmountAt = (sub, key) => num(valueAt(sub.transferAmounts, key));
// Which month an edit made while viewing `sel` is stored under: the very
// first amount ever entered applies from the start (you're describing an
// existing standing order); after that a change applies from `sel` on, and
// earlier months keep their amount. Decided once per edit (on focus), so
// typing "250" doesn't store "2" from the start and "250" from `sel`.
export const transferTargetKey = (map, sel) => (Object.keys(map || {}).length ? sel : FROM_START);
export function setTransferAmountAt(map, key, value) {
  const next = { ...(map || {}) };
  if (value === "") delete next[key];
  else next[key] = value;
  return next;
}
export function migrateSubAccount(s) {
  return {
    id: s.id || uid(), holder: s.holder || "", bank: s.bank || "", iban: s.iban || "",
    planId: s.planId || "", referenceId: s.referenceId || "",
    sharePercent: s.sharePercent ?? "100", interestRate: s.interestRate ?? "",
    // How this account is fed from the goal's monthly contribution: a share
    // of it ("percent", the original behaviour) or a fixed standing transfer
    // ("amount", e.g. €150 on the 25th from the joint account to Raisin).
    // transferDay is informational only — projections work per month.
    transferMode: s.transferMode === "amount" ? "amount" : "percent",
    // The fixed amount is month-scoped like everything else that changes
    // over time: { "YYYY-MM": amount }, each value applying from that month
    // on (see transferAmountAt). A plain transferAmount from the first
    // version of this field applies from the very start.
    transferAmounts: migrateTransferAmounts(s), transferDay: s.transferDay ?? "",
    // Who the money on this account belongs to: a person id, or "" for
    // "shared/unknown" — then the holder name is matched against the
    // people, and failing that it counts as shared (see accountOwnerShares).
    ownerId: s.ownerId ?? "",
    // Each sub-account's own recorded balance, independent of the others and
    // of the goal's main-account balance — the combined total is the sum of
    // all of them, not a proportional split of one shared number.
    checkpoints: migrateCheckpoints(s),
  };
}
// A goal is derived 1:1 from a monthly savings entry (see
// SavingsOverviewPage) rather than freely created. Older blobs let each
// sub-account link its own entry and gave the goal a free-typed name —
// fold that into a single entryId per goal (best-effort, from whichever
// sub-account had one); goals that never had one don't correspond to
// anything in the current model and are dropped in normalize() below.
export function migrateGoal(g) {
  const entryId = g.entryId || (g.subAccounts || []).find((s) => s.entryId)?.entryId || null;
  // The recorded balance briefly lived per sub-account instead of once per
  // goal — recover it from whichever sub-account had one so a balance
  // entered there isn't silently lost.
  const ownCheckpoints = migrateCheckpoints(g);
  const fallbackSub = (g.subAccounts || []).find((s) => s.checkpointMonth || (s.checkpoints && Object.keys(s.checkpoints).length));
  const checkpoints = Object.keys(ownCheckpoints).length ? ownCheckpoints : (fallbackSub ? migrateCheckpoints(fallbackSub) : {});

  // For a while, a sub-account's balance wasn't recorded at all — it was
  // derived as a % split of the goal's one recorded total. Any sub-account
  // from that period (recognized by having neither `checkpoints` nor the
  // even older `checkpointMonth` field at all, as opposed to having one that
  // was legitimately since cleared) gets seeded with what its share of that
  // total already was, so the combined total shown doesn't silently change
  // the moment this loads. Whatever wasn't already covered by sub-account
  // shares stays on the goal's own main-account balance. From here on,
  // every account's balance is entered and corrected independently.
  const rawSubAccounts = g.subAccounts || [];
  const fromSplitEra = (s) => !("checkpoints" in s) && !("checkpointMonth" in s);
  const needsBackfill = Object.keys(checkpoints).length > 0 && rawSubAccounts.some(fromSplitEra);
  const shareOf = (s) => { const p = s.sharePercent === "" || s.sharePercent == null ? 1 : num(s.sharePercent) / 100; return Math.max(0, p); };
  const subAccounts = rawSubAccounts.map((s) => {
    const migrated = migrateSubAccount(s);
    if (!needsBackfill || !fromSplitEra(s)) return migrated;
    const share = shareOf(s);
    const backfilled = Object.fromEntries(Object.entries(checkpoints).map(([k, v]) => [k, String(round2(num(v) * share))]));
    return { ...migrated, checkpoints: backfilled };
  });
  let mainCheckpoints = checkpoints;
  if (needsBackfill) {
    const totalShare = rawSubAccounts.filter(fromSplitEra).reduce((sum, s) => sum + shareOf(s), 0);
    const remainder = Math.max(0, 1 - totalShare);
    mainCheckpoints = Object.fromEntries(Object.entries(checkpoints).map(([k, v]) => [k, String(round2(num(v) * remainder))]));
  }

  return {
    entryId, targetAmount: g.targetAmount ?? "", mainBank: g.mainBank ?? "",
    // The joint account's own interest rate and the buffer you want to keep
    // on it — together they drive the "move more to the better rate" tip.
    mainInterestRate: g.mainInterestRate ?? "", bufferAmount: g.bufferAmount ?? "",
    forwarded: g.forwarded ?? Boolean(rawSubAccounts.length),
    // The goal's own account — once forwarded, this is specifically the
    // main/shared account, tracked alongside (not combined into) each
    // sub-account's own balance.
    checkpoints: mainCheckpoints,
    subAccounts,
  };
}
export function freshData() { const mk = monthKey(new Date()); return { selectedMonth: mk, months: { [mk]: clone(DEFAULT_FIGURES) }, log: [], listSort: { ...DEFAULT_LIST_SORT }, savingsGoals: [] }; }
export function normalize(raw) {
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
export function monthlyContributionAt(months, entryId, key) {
  if (!entryId) return 0;
  const findIn = (fig) => fig && allSavingsOf(fig).find((x) => x.e.id === entryId)?.e;
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
// What one account receives per month out of the goal's monthly
// contribution. Sub-accounts take either a % share or a fixed standing
// transfer; the goal's main account (the joint account the money arrives
// on first) keeps whatever the sub-accounts don't take — negative when more
// is transferred on than comes in, so its projected balance shrinks.
export function subAccountContribution(sub, monthly, key) {
  if (sub.isMain) return monthly - (sub.siblings || []).reduce((sum, s) => sum + subAccountContribution(s, monthly, key), 0);
  if (sub.transferMode === "amount") return transferAmountAt(sub, key);
  const share = sub.sharePercent === "" || sub.sharePercent == null ? 1 : num(sub.sharePercent) / 100;
  return monthly * share;
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
export function projectSubAccountSeries(months, entryId, subAccount, keys, target) {
  const out = {};
  const checkpoints = subAccount.checkpoints || {};
  const checkpointKeys = Object.keys(checkpoints).filter((k) => checkpoints[k] !== "" && checkpoints[k] != null).sort();
  if (!checkpointKeys.length) return out;
  // A goal's monthly contribution can be split across several sub-accounts
  // (e.g. different banks) by percentage, rather than each needing its own
  // dedicated savings entry — all sub-accounts under one goal share the same
  // (goal-level) entryId.
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
        principal = Math.max(0, principal + subAccountContribution(subAccount, monthlyContributionAt(months, entryId, k), k));
        if (target != null && principal + interest >= target) capped = true;
      }
    }
    out[key] = { balance: principal + interest, interest };
  }
  return out;
}


// ── Savings overview helpers ──
// Every account a goal's money is on, in the shape projectSubAccountSeries
// expects. Not forwarded: one virtual account for the pot itself (starting
// at €0 in `sel` when no balance was ever recorded, flagged `virtual` so
// summaries can leave it out). Forwarded: the joint "main" account first —
// it keeps whatever the sub-accounts don't take — then each sub-account.
export function goalAccounts(entry, goal, sel, mainLabel) {
  if (!goal.forwarded) {
    const has = Object.keys(goal.checkpoints || {}).length > 0;
    return [{ id: `self-${entry.id}`, holder: entry.label || mainLabel, sharePercent: "100", interestRate: goal.mainInterestRate || "",
      checkpoints: has ? goal.checkpoints : { [sel]: "0" }, isOwn: true, virtual: !has }];
  }
  const subs = goal.subAccounts || [];
  return [
    { id: `self-${entry.id}`, holder: goal.mainBank || mainLabel, bank: goal.mainBank || "", isMain: true, siblings: subs,
      interestRate: goal.mainInterestRate || "", checkpoints: goal.checkpoints || {} },
    ...subs,
  ];
}
// Balance of one account in month `key` (null before its first recorded
// balance). `without` leaves that month's own recorded balance out, giving
// what the projection expected — to compare against what you enter.
export function balanceAt(months, entryId, account, key, target = null, { without = false } = {}) {
  let acc = account;
  if (without && account.checkpoints?.[key] !== undefined) {
    const { [key]: _drop, ...rest } = account.checkpoints;
    acc = { ...account, checkpoints: rest };
  }
  return projectSubAccountSeries(months, entryId, acc, [key], target)[key] || null;
}
// How an account's balance divides over the people: { [personId]: share }.
// Personal pots belong to their person; on a joint pot an explicit owner
// wins, then a holder name equal to someone's name, else it's shared equally.
export function accountOwnerShares(account, groupPersonId, partners) {
  if (groupPersonId) return { [groupPersonId]: 1 };
  if (!account.isMain && account.ownerId && partners.some((p) => p.id === account.ownerId)) return { [account.ownerId]: 1 };
  if (!account.isMain && account.holder) {
    const match = partners.find((p) => p.name && p.name.trim().toLowerCase() === account.holder.trim().toLowerCase());
    if (match) return { [match.id]: 1 };
  }
  const n = partners.length || 1;
  return Object.fromEntries(partners.map((p) => [p.id, 1 / n]));
}
// The "move more to the better rate" tip for a forwarded goal: how much
// sits on the joint account above the buffer, and what moving it to the
// best-paying sub-account would add per year. null when there's nothing
// worth saying (no better rate, nothing above the buffer).
export function interestTip(mainBalance, goal) {
  if (!goal.forwarded || mainBalance == null) return null;
  const mainRate = num(goal.mainInterestRate);
  const best = (goal.subAccounts || []).reduce((b, s) => (num(s.interestRate) > (b ? num(b.interestRate) : 0) ? s : b), null);
  if (!best || num(best.interestRate) <= mainRate) return null;
  const excess = mainBalance - num(goal.bufferAmount);
  if (excess < 1) return null;
  return { excess, account: best, rate: num(best.interestRate), mainRate, gainPerYear: excess * (num(best.interestRate) - mainRate) / 100 };
}

// One person's own month: what they keep after the joint contribution, and
// what's left after their own fixed costs and savings pots. `calc` is the
// month's computeTotals result (passed in, since callers already have it).
export function personalTotals(fig, calc, personId) {
  const person = fig.partners.find((p) => p.id === personId);
  const income = person ? monthlyInc(person) : 0;
  const transfer = calc.transfers[personId] || 0;
  const leftover = calc.leftovers[personId] ?? income - transfer;
  const expTotal = sumM(listAt(fig, "personalExpenses", personId), fig);
  const savTotal = sumM(listAt(fig, "personalSavings", personId), fig);
  return { income, transfer, leftover, expTotal, savTotal, free: leftover - expTotal - savTotal };
}
