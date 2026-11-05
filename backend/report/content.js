/**
 * What goes into the monthly report, as plain data (no PDF yet): the same
 * numbers the frontend shows, computed with the frontend's own finance.js,
 * for the new month and the month before it, plus what changed in between.
 * pdf.js turns this into pages; keeping the two apart keeps both testable.
 */
import {
  normalize, figuresFor, computeTotals, monthlyOf, monthlyInc, listAt, personalTotals, allSavingsOf,
  shiftMonth, goalAccounts, balanceAt, accountOwnerShares, isDeposit, transferChanges, lastRecorded, num,
} from "../../frontend/src/finance.js";
import nl from "../../frontend/src/locales/nl.js";
import en from "../../frontend/src/locales/en.js";

const LOCALES = { nl, en };

export function localeFor(lang) {
  const loc = LOCALES[lang] || LOCALES.nl;
  const text = loc.text;
  const t = (key, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v),
    text[key] ?? LOCALES.nl.text[key] ?? key);
  const money = new Intl.NumberFormat(loc.currencyLocale, { style: "currency", currency: "EUR" });
  const eur = (v) => money.format(Number.isFinite(v) ? v : 0);
  const pct = (v) => new Intl.NumberFormat(loc.currencyLocale, { style: "percent", maximumFractionDigits: 1 }).format(v || 0);
  const monthLong = (k) => { const [y, m] = k.split("-").map(Number); return new Intl.DateTimeFormat(loc.dateLocale, { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1)); };
  const dateTime = (d) => new Intl.DateTimeFormat(loc.dateLocale, { dateStyle: "medium", timeStyle: "short", timeZone: process.env.TZ || "Europe/Amsterdam" }).format(d);
  return { text, t, eur, pct, monthLong, dateTime };
}

// Every entry of a month as one flat list, so two months can be compared.
function entriesOf(fig, L) {
  const nameOf = (p, i) => p.name || L.t("personName", { n: i + 1 });
  const out = fig.partners.map((p, i) => ({ id: `income:${p.id}`, label: L.t("sheetIncome", { name: nameOf(p, i) }), group: L.text.incomes, monthly: monthlyInc(p) }));
  const add = (list, group) => { for (const e of list || []) out.push({ id: e.id, label: e.label || L.text.unnamed, group, monthly: monthlyOf(e, fig) }); };
  add(fig.govIncome, L.text.government);
  add(fig.expenses, L.text.expensesSection);
  add(fig.savings, L.text.savingsSection);
  fig.partners.forEach((p, i) => {
    add(listAt(fig, "personalExpenses", p.id), L.t("printOwnSection", { name: nameOf(p, i) }));
    add(listAt(fig, "personalSavings", p.id), L.t("printOwnSection", { name: nameOf(p, i) }));
  });
  return out;
}

// Entries added, removed or with a different monthly amount.
export function entryChanges(prevFig, fig, L) {
  const before = new Map(entriesOf(prevFig, L).map((e) => [e.id, e]));
  const after = entriesOf(fig, L);
  const changes = [];
  for (const e of after) {
    const b = before.get(e.id);
    if (!b) { if (e.monthly > 0.005) changes.push({ kind: "added", ...e, previous: 0 }); continue; }
    if (Math.abs(b.monthly - e.monthly) > 0.005) changes.push({ kind: "changed", ...e, previous: b.monthly });
    before.delete(e.id);
  }
  for (const b of before.values()) if (b.monthly > 0.005) changes.push({ kind: "removed", ...b, previous: b.monthly, monthly: 0 });
  return changes;
}

const accountName = (sub, L) => `${[sub.bank, sub.holder].filter(Boolean).join(" · ") || L.text.unnamed}${isDeposit(sub) ? ` (${L.text.depositLabel.toLowerCase()})` : ""}`;

// The month as the "Table" page shows it: sections of rows with totals.
function sheetOf(fig, calc, L) {
  const nameOf = (p, i) => p.name || L.t("personName", { n: i + 1 });
  const methodLabel = fig.method === "equal" ? L.text.equalMethod : fig.method === "custom" ? L.text.customMethod : L.text.incomeMethod;
  const row = (label, monthly, extra = {}) => ({ label, monthly, category: "", ...extra });
  const sections = [];
  sections.push({ title: L.text.incomes, rows: [
    ...fig.partners.map((p, i) => row(L.t("sheetIncome", { name: nameOf(p, i) }), calc.people[i]?.income ?? 0)),
    ...fig.govIncome.map((g) => row(g.label || L.text.unnamed, monthlyOf(g, fig), { category: L.text.government })),
    row(L.text.sheetIncomeTotal, calc.total + calc.govTotal, { strong: true }),
  ] });
  sections.push({ title: L.text.expensesSection, rows: [
    ...fig.expenses.map((e) => row(e.label || L.text.unnamed, monthlyOf(e, fig), { category: e.category || L.text.otherCategory })),
    row(L.text.sheetExpensesTotal, calc.expensesTotal, { strong: true }),
  ] });
  sections.push({ title: L.text.savingsSection, rows: [
    ...fig.savings.map((e) => row(e.label || L.text.unnamed, monthlyOf(e, fig))),
    row(L.text.sheetSavingsTotal, calc.savingsTotal, { strong: true }),
  ] });
  sections.push({ title: `${L.text.sheetSummary} · ${L.t("sheetMethod", { method: methodLabel })}`, rows: [
    row(L.text.sheetPot, calc.potTotal),
    ...(calc.govTotal > 0 ? [row(L.text.sheetGovLess, calc.govTotal)] : []),
    row(L.text.coupleFunds, calc.coupleFunds, { strong: true }),
    ...(calc.buffer > 0.005 ? [row(L.t("buffer", { pct: fig.margePct || "0" }), calc.buffer)] : []),
    ...fig.partners.map((p, i) => row(L.t("sheetToJoint", { name: nameOf(p, i) }), calc.transfers[p.id] || 0, { category: L.pct(calc.contribShares[p.id] || 0) })),
    ...fig.partners.map((p, i) => row(L.t("sheetKeeps", { name: nameOf(p, i) }), calc.leftovers[p.id] || 0, { category: L.pct(calc.keeps[p.id] || 0) })),
  ] });
  fig.partners.forEach((p, i) => {
    const exp = listAt(fig, "personalExpenses", p.id), sav = listAt(fig, "personalSavings", p.id);
    if (!exp.length && !sav.length) return;
    const own = personalTotals(fig, calc, p.id);
    sections.push({ title: L.t("printOwnSection", { name: nameOf(p, i) }), rows: [
      row(L.text.keepsLeft, own.leftover),
      ...exp.map((e) => row(e.label || L.text.unnamed, -monthlyOf(e, fig), { category: e.category || L.text.sheetOwnExpense, indent: true })),
      ...sav.map((e) => row(e.label || L.text.unnamed, -monthlyOf(e, fig), { category: L.text.sheetOwnSaving, indent: true })),
      row(L.text.personalFree, own.free, { strong: true }),
    ] });
  });
  return sections;
}

// The key figures side by side, for the comparison at the top.
function keyFigures(fig, calc, L) {
  const nameOf = (p, i) => p.name || L.t("personName", { n: i + 1 });
  const rows = [
    { id: "income", label: L.text.sheetIncomeTotal, value: calc.total + calc.govTotal },
    { id: "expenses", label: L.text.sheetExpensesTotal, value: calc.expensesTotal },
    { id: "savings", label: L.text.sheetSavingsTotal, value: calc.savingsTotal },
    { id: "joint", label: L.text.coupleFunds.replace(/^=\s*/, ""), value: calc.coupleFunds },
  ];
  fig.partners.forEach((p, i) => {
    const own = personalTotals(fig, calc, p.id);
    rows.push({ id: `to:${p.id}`, label: L.t("sheetToJoint", { name: nameOf(p, i) }), value: calc.transfers[p.id] || 0 });
    rows.push({ id: `free:${p.id}`, label: `${L.text.personalFree} · ${nameOf(p, i)}`, value: own.free });
  });
  return rows;
}

// Every savings account with its balance in month `sel`.
function savingsOf(data, fig, sel, L) {
  const goals = data.savingsGoals || [];
  const nameOf = (id) => { const i = fig.partners.findIndex((p) => p.id === id); return i < 0 ? "?" : (fig.partners[i].name || L.t("personName", { n: i + 1 })); };
  const pots = [];
  for (const { e, personId } of allSavingsOf(fig)) {
    const goal = goals.find((g) => g.entryId === e.id) || { entryId: e.id, targetAmount: "", mainBank: "", mainInterestRate: "", bufferAmount: "", forwarded: false, checkpoints: {}, subAccounts: [] };
    const target = goal.targetAmount ? num(goal.targetAmount) : null;
    const accounts = goalAccounts(e, goal, sel, goal.forwarded ? L.text.mainAccountLabel : L.text.unnamed).map((acc) => {
      const b = acc.virtual ? null : balanceAt(data.months, e.id, acc, sel, target);
      const recorded = acc.virtual ? null : lastRecorded(acc, sel);
      const owners = Object.entries(accountOwnerShares(acc, personId, fig.partners)).filter(([, s]) => s > 0);
      return {
        name: acc.isMain ? (goal.mainBank || L.text.mainAccountLabel) : acc.isOwn ? L.text.ownAccountLabel : accountName(acc, L),
        rate: acc.interestRate ? num(acc.interestRate) : null,
        balance: b?.balance ?? null,
        entered: recorded === sel,
        lastRecorded: recorded,
        owners: owners.length === fig.partners.length && fig.partners.length > 1 ? "" : owners.map(([id]) => nameOf(id)).join(", "),
      };
    });
    pots.push({ label: e.label || L.text.unnamed, owner: personId ? nameOf(personId) : "", monthly: monthlyOf(e, fig), target, accounts,
      total: accounts.reduce((s, a) => s + (a.balance ?? 0), 0) });
  }
  return pots;
}

// The transfers page for one month, with names filled in.
function transfersOf(data, fig, sel, L) {
  const { hasPrevious, current, status, stopped } = transferChanges(data.months, sel, data.savingsGoals || [], data.transferAccounts || []);
  const checks = (data.transferChecks || {})[sel] || {};
  const personName = (id) => { const i = fig.partners.findIndex((p) => p.id === id); return i < 0 ? "?" : (fig.partners[i].name || L.t("personName", { n: i + 1 })); };
  const nameOf = (acc) => acc.type === "person" ? L.t("transferOwnAccount", { name: personName(acc.personId) })
    : acc.type === "joint" ? (data.jointAccountName || L.text.transferJointAccount)
    : acc.type === "account" ? (acc.account.name || L.text.unnamed)
    : acc.type === "pot" ? (acc.bank || L.t("transferPotAccount", { label: acc.label || L.text.unnamed }))
    : accountName(acc.sub, L);
  const pot = (tr) => tr.potLabel || L.text.unnamed;
  const purpose = (tr) => tr.type === "contribution" ? L.text.transferPurposeContribution
    : tr.type === "fixedCosts" ? L.t("transferPurposeFixedCosts", { items: tr.items.map((i) => `${i.label || L.text.unnamed} ${L.eur(i.amount)}`).join(", ") })
    : tr.type === "savings" ? (tr.to.bank ? L.t("transferPurposePot", { pot: pot(tr) }) : "")
    : tr.type === "forward" ? L.t("transferPurposePot", { pot: pot(tr) })
    : tr.type === "depositStart" ? L.t("transferDepositStart", { pot: pot(tr) })
    : L.t("transferDepositEnd", { pot: pot(tr) });
  const once = (tr) => tr.type === "depositStart" || tr.type === "depositEnd";
  const shape = (tr, stop = false) => {
    const tick = checks[stop ? `stop|${tr.key}` : tr.key];
    const st = status[tr.key];
    return {
      from: nameOf(tr.from), to: nameOf(tr.to), amount: tr.amount, once: once(tr), purpose: purpose(tr),
      ticked: stop ? tick != null : tick != null && Math.abs(num(tick) - tr.amount) < 0.005,
      status: !hasPrevious || stop ? null : st?.kind === "changed" ? L.t("transferStatusChanged", { amount: L.eur(st.previous) }) : st?.kind === "new" ? L.text.transferStatusNew : L.text.transferStatusSame,
      changed: hasPrevious && !stop && st?.kind !== "same",
      iban: tr.iban || "", reference: tr.reference || "",
      day: (tr.type === "fixedCosts" || (tr.type === "forward" && tr.fixed)) ? (tr.day || "") : null,
    };
  };
  return { rows: current.map((tr) => shape(tr)), stopped: stopped.map((tr) => shape(tr, true)) };
}

// Everything for one month.
function monthOf(data, key, L) {
  const fig = figuresFor(data.months, key);
  const calc = computeTotals(fig);
  return { key, title: L.monthLong(key), exists: Boolean(data.months[key]), fig, calc,
    keyFigures: keyFigures(fig, calc, L), sheet: sheetOf(fig, calc, L), savings: savingsOf(data, fig, key, L), transfers: transfersOf(data, fig, key, L),
    log: (data.log || []).filter((x) => x.month === key).sort((a, b) => a.ts - b.ts) };
}

// The report for `month`, looking back at the month before it.
export function buildReportContent(raw, month, lang = "nl") {
  const data = normalize(raw);
  const L = localeFor(lang);
  const current = monthOf(data, month, L);
  const previous = monthOf(data, shiftMonth(month, -1), L);
  const hasPrevious = Object.keys(data.months).some((k) => k < month);
  const prevFigures = new Map(previous.keyFigures.map((r) => [r.id, r.value]));
  return {
    L, month, current, previous: hasPrevious ? previous : null,
    comparison: current.keyFigures.map((r) => ({ ...r, previous: hasPrevious ? (prevFigures.get(r.id) ?? 0) : null })),
    changes: hasPrevious ? entryChanges(previous.fig, current.fig, L) : [],
  };
}
