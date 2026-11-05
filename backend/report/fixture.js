// Sample household for the report tests (and for trying out the PDF).
const month = (over = {}) => ({
  partners: [{ id: "a", name: "Coen", income: "3000" }, { id: "b", name: "Sam", income: "2000" }],
  expenses: [{ id: "e1", label: "Huur", category: "Wonen", amount: "1000" }],
  savings: [{ id: "s1", label: "Buffer", amount: "200" }],
  margePct: "0",
  ...over,
});
export const sample = () => ({
  selectedMonth: "2026-11",
  months: {
    "2026-10": month({ expenses: [{ id: "e1", label: "Huur", category: "Wonen", amount: "950" }, { id: "e2", label: "Sportschool", amount: "40" }] }),
    "2026-11": month({ expenses: [{ id: "e1", label: "Huur", category: "Wonen", amount: "1000" }, { id: "e3", label: "Energie", amount: "120" }],
      personalExpenses: { a: [{ id: "p1", label: "Telefoon", amount: "25" }] } }),
  },
  savingsGoals: [{ entryId: "s1", forwarded: true, mainBank: "KNAB", checkpoints: { "2026-10": "1500" },
    subAccounts: [{ id: "r1", bank: "Raisin", holder: "Coen", iban: "NL00RAIS0123456789", referenceId: "PLAN123", transferMode: "amount", transferAmounts: { "0000-01": "150" }, transferDay: "", interestRate: "2.5", checkpoints: { "2026-11": "800" } }] }],
  transferChecks: { "2026-11": {} },
  log: [{ id: "x", ts: Date.UTC(2026, 10, 2, 9), month: "2026-11", label: "Huur", old: "950", next: "1000" }],
});
