/**
 * Transfer-change notifications.
 *
 * On (and after) a day of the month the household picks, compare this
 * month's planned transfers with next month's — using the very same
 * calculations as the app (a copy in ./shared, see scripts/sync-shared.sh) — and report what
 * has to change in the standing orders: new, removed or different transfers.
 *
 * Two ways out:
 *   - GET /api/notifications/transfers: JSON for Home Assistant (REST sensor).
 *   - E-mail, sent by an hourly check once the day has come, when SMTP is
 *     configured and e-mail is switched on in the app. The same set of
 *     changes is never mailed twice; if the changes differ later that
 *     month, a new mail goes out.
 *
 * Env:
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURITY (starttls | ssl | none),
 *   SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM — e-mail is off without host/from.
 *   APP_URL   — link to the app in the mail (optional).
 *   TIMEZONE  — whose "today" counts (default Europe/Amsterdam).
 *   LANGUAGE  — nl | en (default nl).
 */
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { pool } from "./db.js";
import {
  normalize, transferChanges, transferAccountName, shiftMonth,
} from "./shared/finance.js";
import nl from "./shared/locales/nl.js";
import en from "./shared/locales/en.js";

const STATE_KEY = "open-family-finance:v1";
const LOG_KEY = "open-family-finance:notify-log";
const LOCALES = { nl, en };
const locale = LOCALES[String(process.env.LANGUAGE || "nl").toLowerCase()] || nl;
const T = locale.text;
const TIMEZONE = process.env.TIMEZONE || "Europe/Amsterdam";
const APP_URL = process.env.APP_URL || "";

const fill = (template, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), template);
const eur = (n) => new Intl.NumberFormat(locale.currencyLocale, { style: "currency", currency: "EUR" }).format(n);
const monthLong = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(locale.dateLocale, { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, 1));
};

// Today in the household's time zone, not the server's (containers run in UTC).
export function today() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { month: `${parts.year}-${parts.month}`, day: Number(parts.day) };
}

async function loadState() {
  const r = await pool.query("SELECT value FROM app_state WHERE key = $1", [STATE_KEY]);
  return r.rowCount ? normalize(r.rows[0].value) : null;
}

// Everything a notification needs, as plain data: which months, whether the
// notify day has come, and each change described in words.
export async function transferReport() {
  const data = await loadState();
  const { month, day } = today();
  const nextMonth = shiftMonth(month, 1);
  const settings = data?.notifications || { day: "20", emailEnabled: false, email: "" };
  const notifyDay = Number(settings.day) || 20;
  const due = day >= notifyDay;
  if (!data) return { month, nextMonth, notifyDay, due, count: 0, changes: [], title: "", summary: "" };

  const ctx = { partners: (data.months[month] || data.months[Object.keys(data.months).sort().pop()]).partners, jointAccountName: data.jointAccountName };
  const name = (acc) => transferAccountName(acc, ctx, T);
  const changes = transferChanges(data.months, month, nextMonth, data.savingsGoals, data.transferAccounts).map((c) => {
    const tr = c.after || c.before;
    const route = `${name(tr.from)} → ${name(tr.to)}`;
    const text = c.kind === "added" ? fill(T.notifyAdded, { route, amount: eur(tr.amount) })
      : c.kind === "removed" ? fill(T.notifyRemoved, { route, amount: eur(tr.amount) })
      : fill(T.notifyChanged, { route, what: c.fields.map((f) => describeField(f, c.before, c.after)).join(", ") });
    return {
      kind: c.kind, from: name(tr.from), to: name(tr.to), amount: Math.round(tr.amount * 100) / 100,
      before: c.before ? Math.round(c.before.amount * 100) / 100 : null,
      day: tr.day || "", iban: tr.iban || "", reference: tr.reference || "", text,
    };
  });
  const title = changes.length ? fill(T.notifyTitle, { count: changes.length, month: monthLong(nextMonth) }) : fill(T.notifyNone, { month: monthLong(nextMonth) });
  return { month, nextMonth, notifyDay, due, count: changes.length, changes, title, summary: changes.map((c) => `• ${c.text}`).join("\n") };
}

function describeField(field, before, after) {
  if (field === "amount") return fill(T.notifyFieldAmount, { from: eur(before.amount), to: eur(after.amount) });
  if (field === "day") return fill(T.notifyFieldDay, { from: before.day || "–", to: after.day || "–" });
  if (field === "iban") return fill(T.notifyFieldIban, { to: after.iban || "–" });
  return fill(T.notifyFieldReference, { to: after.reference || "–" });
}

// ── E-mail ──
const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
let transporter = null;
function mailer() {
  if (!transporter) {
    const security = String(process.env.SMTP_SECURITY || "starttls").toLowerCase();
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || (security === "ssl" ? 465 : 587)),
      secure: security === "ssl",
      requireTLS: security === "starttls",
      auth: process.env.SMTP_USERNAME ? { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

function mailBody(report) {
  const lines = [report.title, ""];
  for (const c of report.changes) {
    lines.push(`• ${c.text}`);
    const details = [c.day && fill(T.notifyDetailDay, { day: c.day }), c.iban && `IBAN ${c.iban}`, c.reference && `${T.subAccountReference} ${c.reference}`].filter(Boolean);
    if (c.kind !== "removed" && details.length) lines.push(`  ${details.join(" · ")}`);
  }
  if (APP_URL) lines.push("", fill(T.notifyOpenApp, { url: APP_URL }));
  return lines.join("\n");
}

export async function sendTransferMail(report, to) {
  if (!smtpConfigured()) throw new Error("smtp-not-configured");
  await mailer().sendMail({ from: process.env.SMTP_FROM, to, subject: report.title, text: mailBody(report) });
}

// What has been mailed already: { "YYYY-MM": hash-of-changes } for next months.
const signature = (report) => crypto.createHash("sha256").update(JSON.stringify(report.changes.map((c) => c.text))).digest("hex").slice(0, 16);
async function loadLog() {
  const r = await pool.query("SELECT value FROM app_state WHERE key = $1", [LOG_KEY]);
  return r.rowCount ? r.rows[0].value : {};
}
async function saveLog(log) {
  await pool.query(
    `INSERT INTO app_state (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
    [LOG_KEY, JSON.stringify(log)]);
}

export async function checkAndMail() {
  if (!smtpConfigured()) return;
  const data = await loadState();
  const settings = data?.notifications;
  if (!settings?.emailEnabled || !settings.email) return;
  const report = await transferReport();
  if (!report.due || !report.count) return;
  const log = await loadLog();
  const sig = signature(report);
  if (log[report.nextMonth] === sig) return;
  await sendTransferMail(report, settings.email);
  await saveLog({ ...log, [report.nextMonth]: sig });
  console.log(`notifications: mailed ${report.count} transfer change(s) for ${report.nextMonth}`);
}

export function startScheduler() {
  const run = () => checkAndMail().catch((e) => console.error("notifications: check failed", e.message));
  setTimeout(run, 60 * 1000);
  setInterval(run, 60 * 60 * 1000);
}

export { smtpConfigured };
