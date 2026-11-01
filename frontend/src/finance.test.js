// Unit tests for the calculations in finance.js. Run with `npm test`
// (Node's built-in test runner — no extra dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTotals, normalize, migrateFig, monthlyContributionAt, projectSubAccountSeries,
  subAccountContribution, valueAt, transferTargetKey, setTransferAmountAt, FROM_START,
  goalAccounts, balanceAt, accountOwnerShares, interestTip, personalTotals, migrateGoal, depositEnd, isMonthKey,
} from "./finance.js";

const fig = (over = {}) => migrateFig({
  partners: [{ id: "a", name: "Coen", income: "3000" }, { id: "b", name: "Sam", income: "2000" }],
  expenses: [{ id: "e1", amount: "1000" }],
  savings: [{ id: "s1", label: "Sparen", amount: "600" }],
  margePct: "0",
  ...over,
});
const close = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 0.005, `${msg ?? ""} expected ${expected}, got ${actual}`);

test("income-based split divides the joint costs by income", () => {
  const calc = computeTotals(fig());
  close(calc.coupleFunds, 1600);
  close(calc.transfers.a, 960);
  close(calc.transfers.b, 640);
  close(calc.leftovers.a, 2040);
});

test("personal savings are not part of the joint split, but reduce what's free", () => {
  const f = fig({ personalExpenses: { a: [{ id: "x", amount: "40" }] }, personalSavings: { a: [{ id: "ps", amount: "100" }] } });
  const calc = computeTotals(f);
  close(calc.coupleFunds, 1600);
  const own = personalTotals(f, calc, "a");
  close(own.savTotal, 100);
  close(own.free, 2040 - 40 - 100);
});

test("normalize gives every person a personal savings list", () => {
  const data = normalize({ selectedMonth: "2026-11", months: { "2026-11": { partners: [{ id: "a" }, { id: "b" }] } } });
  assert.deepEqual(data.months["2026-11"].personalSavings, { a: [], b: [] });
});

test("monthlyContributionAt also finds personal savings pots", () => {
  const months = { "2026-11": fig({ personalSavings: { b: [{ id: "ps", amount: "75" }] } }) };
  close(monthlyContributionAt(months, "ps", "2026-11"), 75);
  close(monthlyContributionAt(months, "ps", "2027-03"), 75, "future months inherit the latest figures");
});

test("month-scoped values apply from their month on", () => {
  const map = { [FROM_START]: "200", "2027-03": "250" };
  assert.equal(valueAt(map, "2026-11"), "200");
  assert.equal(valueAt(map, "2027-03"), "250");
  assert.equal(valueAt(map, "2028-01"), "250");
  assert.equal(valueAt({ "2027-03": "250" }, "2026-11"), null);
});

test("the first transfer amount applies from the start, later ones from the viewed month", () => {
  assert.equal(transferTargetKey({}, "2026-11"), FROM_START);
  const first = setTransferAmountAt({}, FROM_START, "200");
  assert.equal(transferTargetKey(first, "2027-03"), "2027-03");
  const changed = setTransferAmountAt(first, "2027-03", "250");
  assert.deepEqual(changed, { [FROM_START]: "200", "2027-03": "250" });
  assert.deepEqual(setTransferAmountAt(changed, "2027-03", ""), { [FROM_START]: "200" });
});

test("an old single transferAmount migrates to 'from the start'", () => {
  const g = migrateGoal({ entryId: "s1", subAccounts: [{ id: "r", transferMode: "amount", transferAmount: "150", checkpoints: {} }] });
  assert.deepEqual(g.subAccounts[0].transferAmounts, { [FROM_START]: "150" });
});

const raisin = (id, holder, amounts, extra = {}) => ({ id, holder, bank: "Raisin", transferMode: "amount", transferAmounts: amounts, interestRate: "", checkpoints: { "2026-11": "1000" }, ...extra });

test("fixed transfers go to the sub-accounts, the joint account keeps the rest", () => {
  const months = { "2026-11": fig() };
  const subs = [raisin("r1", "Coen", { [FROM_START]: "200" }), raisin("r2", "Sam", { [FROM_START]: "200" })];
  const goal = { entryId: "s1", forwarded: true, mainBank: "KNAB", checkpoints: { "2026-11": "4000" }, subAccounts: subs };
  const [main, r1] = goalAccounts({ id: "s1" }, goal, "2026-11", "Main");
  close(subAccountContribution(main, 600, "2026-12"), 200);
  close(balanceAt(months, "s1", main, "2027-02").balance, 4000 + 3 * 200);
  close(balanceAt(months, "s1", r1, "2027-02").balance, 1000 + 3 * 200);
});

test("raising the transfer later doesn't change earlier months", () => {
  const months = { "2026-11": fig() };
  const sub = raisin("r1", "Coen", { [FROM_START]: "200", "2027-01": "300" });
  const series = projectSubAccountSeries(months, "s1", sub, ["2026-12", "2027-01", "2027-02"], null);
  close(series["2026-12"].balance, 1200);
  close(series["2027-01"].balance, 1500);
  close(series["2027-02"].balance, 1800);
});

test("transferring more than comes in makes the joint account shrink, never below zero", () => {
  const months = { "2026-11": fig() };
  const subs = [raisin("r1", "Coen", { [FROM_START]: "500" }), raisin("r2", "Sam", { [FROM_START]: "500" })];
  const goal = { forwarded: true, checkpoints: { "2026-11": "1000" }, subAccounts: subs };
  const [main] = goalAccounts({ id: "s1" }, goal, "2026-11", "Main");
  close(balanceAt(months, "s1", main, "2026-12").balance, 600);
  close(balanceAt(months, "s1", main, "2027-06").balance, 0);
});

test("interest compounds monthly on the running balance", () => {
  const months = { "2026-11": fig({ savings: [{ id: "s1", amount: "0" }] }) };
  const sub = { id: "r", sharePercent: "100", interestRate: "12", checkpoints: { "2026-11": "1000" } };
  const series = projectSubAccountSeries(months, "s1", sub, ["2027-01"], null);
  close(series["2027-01"].balance, 1000 * 1.01 * 1.01);
});

test("balanceAt can leave out the month's own recorded balance (the expectation)", () => {
  const months = { "2026-11": fig() };
  const acc = { id: "own", sharePercent: "100", checkpoints: { "2026-11": "1000", "2026-12": "2000" } };
  close(balanceAt(months, "s1", acc, "2026-12").balance, 2000);
  close(balanceAt(months, "s1", acc, "2026-12", null, { without: true }).balance, 1600);
});

test("ownership: personal pots, explicit owner, holder name, else shared", () => {
  const partners = [{ id: "a", name: "Coen" }, { id: "b", name: "Sam" }];
  assert.deepEqual(accountOwnerShares({ holder: "x" }, "b", partners), { b: 1 });
  assert.deepEqual(accountOwnerShares({ holder: "x", ownerId: "a" }, null, partners), { a: 1 });
  assert.deepEqual(accountOwnerShares({ holder: " sam " }, null, partners), { b: 1 });
  assert.deepEqual(accountOwnerShares({ isMain: true, holder: "Coen" }, null, partners), { a: 0.5, b: 0.5 });
});

test("interest tip: only above the buffer and when a better rate exists", () => {
  const goal = { forwarded: true, mainInterestRate: "1.5", bufferAmount: "3000", subAccounts: [{ bank: "Raisin", holder: "Coen", interestRate: "2.5" }] };
  const tip = interestTip(8000, goal);
  close(tip.excess, 5000);
  close(tip.gainPerYear, 50);
  assert.equal(interestTip(2500, goal), null);
  assert.equal(interestTip(8000, { ...goal, mainInterestRate: "3" }), null);
});

test("a deposit: one-off amount from its start month, simple interest only during the term, no transfers", () => {
  const months = { "2026-11": fig() };
  const dep = { id: "d", kind: "deposit", depositAmount: "10000", termStart: "2026-11", termMonths: "12", interestRate: "3", checkpoints: {} };
  assert.equal(depositEnd(dep), "2027-11");
  assert.equal(subAccountContribution(dep, 600, "2026-12"), 0);
  close(balanceAt(months, "s1", dep, "2026-11").balance, 10000);
  close(balanceAt(months, "s1", dep, "2027-05").balance, 10150);
  close(balanceAt(months, "s1", dep, "2027-11").balance, 10300);
  close(balanceAt(months, "s1", dep, "2028-06").balance, 10300, "no more interest after the term");
  assert.equal(balanceAt(months, "s1", dep, "2026-10"), null, "nothing before the start");
});

test("a deposit next to a savings account leaves the joint remainder untouched", () => {
  const subs = [{ id: "d", kind: "deposit", depositAmount: "5000", termStart: "2026-11", termMonths: "6" }, raisin("r1", "Coen", { [FROM_START]: "200" })];
  const [main] = goalAccounts({ id: "s1" }, { forwarded: true, checkpoints: {}, subAccounts: subs }, "2026-11", "Main");
  close(subAccountContribution(main, 600, "2026-12"), 400);
});

test("a goal without its own balance keeps it empty — sub-account balances are not copied onto it", () => {
  const g = migrateGoal({ entryId: "s1", forwarded: true, checkpoints: {}, subAccounts: [{ id: "r", checkpoints: { "2026-11": "6000" } }] });
  assert.deepEqual(g.checkpoints, {});
  assert.deepEqual(g.subAccounts[0].checkpoints, { "2026-11": "6000" });
});

test("half-typed months never reach date math", () => {
  for (const bad of ["2025-", "2025", "2025-1", "2025-13", "", undefined]) assert.equal(isMonthKey(bad), false, String(bad));
  assert.equal(isMonthKey("2025-10"), true);
  const dep = { id: "d", kind: "deposit", depositAmount: "1000", termStart: "2025-", termMonths: "12", interestRate: "3", checkpoints: {} };
  assert.equal(depositEnd(dep), null);
  assert.deepEqual(balanceAt({ "2026-11": fig() }, "s1", dep, "2026-11"), null);
  const g = migrateGoal({ entryId: "s1", subAccounts: [{ id: "d", kind: "deposit", termStart: "2025-", checkpoints: {} }] });
  assert.equal(g.subAccounts[0].termStart, "");
});
