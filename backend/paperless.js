/**
 * Thin proxy client for the paperless-ngx REST API.
 *
 * Correspondents: list them, and look up-or-create one by name.
 * Documents: find the most recent one for a given correspondent, so the app
 * can link to it (PAPERLESS_PUBLIC_URL, not PAPERLESS_URL, since the latter
 * is often only reachable from inside the cluster, not from a browser).
 *
 * The frontend never talks to paperless directly — this keeps the paperless
 * API token server-side only.
 */
const ENABLED = String(process.env.PAPERLESS_ENABLED || "").toLowerCase() === "true";
const URL_BASE = (process.env.PAPERLESS_URL || "").replace(/\/+$/, "");
const PUBLIC_URL_BASE = (process.env.PAPERLESS_PUBLIC_URL || process.env.PAPERLESS_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.PAPERLESS_API_TOKEN;

export const paperlessEnabled = ENABLED && Boolean(URL_BASE) && Boolean(TOKEN);

async function paperlessFetch(path, options) {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Token ${TOKEN}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(`paperless ${options?.method || "GET"} ${path} -> ${res.status}`);
  return res.json();
}

// Follows pagination — correspondent lists are small (dozens, not thousands).
// `next` is a full URL; only its path + query are reused, so a mismatch
// between PAPERLESS_URL and the host paperless reports internally can't break it.
export async function listCorrespondents() {
  const out = [];
  let path = "/api/correspondents/?page_size=100";
  while (path) {
    const page = await paperlessFetch(path);
    for (const c of page.results || []) out.push({ id: c.id, name: c.name });
    path = page.next ? new URL(page.next).pathname + new URL(page.next).search : null;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Case-insensitive lookup-or-create, so retyping an existing name never
// creates a duplicate correspondent in paperless.
export async function ensureCorrespondent(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("name is required");
  const existing = await listCorrespondents();
  const match = existing.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (match) return match;
  const created = await paperlessFetch("/api/correspondents/", { method: "POST", body: JSON.stringify({ name: trimmed }) });
  return { id: created.id, name: created.name };
}

// Most recent document (invoice, contract, ...) tied to a correspondent, if any.
export async function latestDocumentForCorrespondent(correspondentId) {
  const page = await paperlessFetch(`/api/documents/?correspondent__id=${encodeURIComponent(correspondentId)}&ordering=-created&page_size=1`);
  const doc = (page.results || [])[0];
  if (!doc) return null;
  return { id: doc.id, title: doc.title, created: doc.created, url: `${PUBLIC_URL_BASE}/documents/${doc.id}` };
}
