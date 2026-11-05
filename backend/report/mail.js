/**
 * Sending the monthly report, and the schedule that does it by itself.
 *
 * SMTP comes from env vars (SMTP_HOST is the on/off switch); who gets it
 * and on which day is set in the app and stored in the state blob as
 * `report: { enabled, recipients, day }`. What was last sent is kept under
 * its own key, so the frontend saving its blob never overwrites it.
 *
 * Which month: the one that starts — on (or after) the chosen day of a
 * month, that month's report goes out once, with a look back at the month
 * before. Missed days (server down) are caught up on the next check.
 */
import nodemailer from "nodemailer";
import { pool } from "../db.js";
import { renderReportPdf } from "./pdf.js";
import { localeFor } from "./content.js";

export const STATE_KEY = "open-family-finance:v1";
export const STATUS_KEY = "open-family-finance:report-status";
const LANG = String(process.env.LANGUAGE || "nl").toLowerCase();
const APP_TITLE = process.env.APP_TITLE?.trim() || "";
const TZ = process.env.TZ || "Europe/Amsterdam";

export const smtpConfigured = Boolean(process.env.SMTP_HOST);
const transport = smtpConfigured ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  // "true": TLS from the start (port 465); otherwise STARTTLS when offered.
  secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined,
  // Self-signed certificates, e.g. Proton Mail Bridge inside the cluster.
  tls: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || "true").toLowerCase() === "false" ? { rejectUnauthorized: false } : undefined,
}) : null;

export const parseRecipients = (s) => String(s || "").split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
export const reportSettings = (data) => ({
  enabled: Boolean(data?.report?.enabled),
  recipients: parseRecipients(data?.report?.recipients),
  day: Math.min(28, Math.max(1, Math.round(Number(data?.report?.day) || 1))),
});

async function readKey(key) {
  const r = await pool.query("SELECT value FROM app_state WHERE key = $1", [key]);
  return r.rowCount ? r.rows[0].value : null;
}
async function writeStatus(patch) {
  const current = (await readKey(STATUS_KEY)) || {};
  const next = { ...current, ...patch };
  await pool.query(`INSERT INTO app_state (key, value) VALUES ($1, $2::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`, [STATUS_KEY, JSON.stringify(next)]);
  return next;
}
export const readStatus = async () => (await readKey(STATUS_KEY)) || {};
export const loadState = () => readKey(STATE_KEY);

export const reportPdf = (data, month) => renderReportPdf(data, month, { lang: LANG, appTitle: APP_TITLE });
export const reportFileName = (month) => `${(APP_TITLE || "open-family-finance").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${month}.pdf`;

export async function sendReport(data, month, recipients) {
  if (!transport) throw new Error("SMTP is not configured (SMTP_HOST)");
  if (!recipients.length) throw new Error("no recipients");
  const L = localeFor(LANG);
  const pdf = await reportPdf(data, month);
  const title = APP_TITLE || L.text.appTitle;
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipients.join(", "),
    subject: L.t("reportMailSubject", { title, month: L.monthLong(month) }),
    text: L.t("reportMailBody", { month: L.monthLong(month) }),
    attachments: [{ filename: reportFileName(month), content: pdf, contentType: "application/pdf" }],
  });
}

// Today in the household's time zone, as { month: "YYYY-MM", day }.
export function today(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).map((p) => [p.type, p.value]));
  return { month: `${parts.year}-${parts.month}`, day: Number(parts.day) };
}

// Whether this month's report is due: enabled, someone to send it to, the
// day has come and it hasn't gone out yet (failed attempts retry hourly).
export function isDue(settings, status, now = new Date()) {
  const { month, day } = today(now);
  if (!settings.enabled || !settings.recipients.length || day < settings.day) return null;
  if (status.lastSentMonth === month) return null;
  if (status.lastAttemptMonth === month && status.lastAttemptAt && now - new Date(status.lastAttemptAt) < 60 * 60 * 1000) return null;
  return month;
}

let running = false;
export async function checkSchedule(now = new Date()) {
  if (!transport || running) return;
  running = true;
  try {
    const data = await loadState();
    if (!data) return;
    const settings = reportSettings(data);
    const month = isDue(settings, await readStatus(), now);
    if (!month) return;
    await writeStatus({ lastAttemptMonth: month, lastAttemptAt: now.toISOString() });
    try {
      await sendReport(data, month, settings.recipients);
      await writeStatus({ lastSentMonth: month, lastSentAt: new Date().toISOString(), lastRecipients: settings.recipients, lastError: null });
      console.log(`Monthly report for ${month} sent to ${settings.recipients.length} recipient(s)`);
    } catch (e) {
      await writeStatus({ lastError: e.message, lastErrorAt: new Date().toISOString() });
      console.error(`Monthly report for ${month} failed:`, e.message);
    }
  } catch (e) {
    console.error("Report schedule check failed:", e.message);
  } finally {
    running = false;
  }
}

export function startSchedule() {
  if (!transport) { console.log("Monthly report: SMTP_HOST not set, e-mailing disabled"); return; }
  setTimeout(checkSchedule, 30 * 1000);
  setInterval(checkSchedule, 10 * 60 * 1000);
}

// Manual "send now" from the app (e.g. to try it out). It doesn't count as
// the scheduled send, so that one still goes out with the latest numbers.
export async function sendNow(month) {
  const data = await loadState();
  if (!data) throw new Error("no data saved yet");
  const settings = reportSettings(data);
  await sendReport(data, month, settings.recipients);
  return writeStatus({ lastManualAt: new Date().toISOString(), lastManualMonth: month, lastManualRecipients: settings.recipients });
}
