/**
 * Thin proxy client for the paperless-ngx REST API.
 *
 * Correspondents: list them, and look up-or-create one by name.
 * Documents: find the most relevant one for a given correspondent, so the
 * app can link to it (PAPERLESS_PUBLIC_URL, not PAPERLESS_URL, since the
 * latter is often only reachable from inside the cluster, not from a
 * browser). PAPERLESS_DOCUMENT_TYPE_PRIORITY lets "relevant" mean "the most
 * recent document of the highest-priority type that exists" rather than
 * just "the most recent document overall".
 *
 * The frontend never talks to paperless directly — this keeps the paperless
 * API token server-side only.
 */
const ENABLED = String(process.env.PAPERLESS_ENABLED || "").toLowerCase() === "true";
const URL_BASE = (process.env.PAPERLESS_URL || "").replace(/\/+$/, "");
const PUBLIC_URL_BASE = (process.env.PAPERLESS_PUBLIC_URL || process.env.PAPERLESS_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.PAPERLESS_API_TOKEN;
// Ordered, comma-separated document type names, e.g. "Jaaropgave,Jaarafrekening,Factuur,Contract".
// Earlier entries win; unknown/misspelled names are simply skipped.
const DOCUMENT_TYPE_PRIORITY = String(process.env.PAPERLESS_DOCUMENT_TYPE_PRIORITY || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

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
  if (!res.ok) {
    const err = new Error(`paperless ${options?.method || "GET"} ${path} -> ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Follows pagination — these lists are small (dozens, not thousands). `next`
// is a full URL; only its path + query are reused, so a mismatch between
// PAPERLESS_URL and the host paperless reports internally can't break it.
async function listSimple(path) {
  const out = [];
  let next = path;
  while (next) {
    const page = await paperlessFetch(next);
    for (const t of page.results || []) out.push({ id: t.id, name: t.name });
    next = page.next ? new URL(page.next).pathname + new URL(page.next).search : null;
  }
  return out;
}
export const listCorrespondents = async () => (await listSimple("/api/correspondents/?page_size=100")).sort((a, b) => a.name.localeCompare(b.name));
export const listDocumentTypes = () => listSimple("/api/document_types/?page_size=100");
export const listTags = () => listSimple("/api/tags/?page_size=100");

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

async function mostRecentDocument(query) {
  const page = await paperlessFetch(`/api/documents/?${query}&ordering=-created&page_size=1`);
  return (page.results || [])[0] || null;
}

// The most relevant document for a correspondent:
//   1. `label` (a { kind: "type" | "tag", id } chosen for this specific entry
//      in the frontend) if given — falls back to the most recent document of
//      any type/tag when the correspondent has none matching that label.
//   2. Otherwise, the first type in PAPERLESS_DOCUMENT_TYPE_PRIORITY that the
//      correspondent actually has a document for (a site-wide default).
//   3. Otherwise, the most recent document of any type.
export async function latestDocumentForCorrespondent(correspondentId, label) {
  const base = `correspondent__id=${encodeURIComponent(correspondentId)}`;
  if (label?.kind && label?.id) {
    const list = label.kind === "tag" ? await listTags() : await listDocumentTypes();
    const found = list.find((l) => String(l.id) === String(label.id));
    if (found) {
      const filterKey = label.kind === "tag" ? "tags__id" : "document_type__id";
      const doc = await mostRecentDocument(`${base}&${filterKey}=${encodeURIComponent(found.id)}`);
      if (doc) return toDocumentResult(doc, found.name);
    }
    const fallback = await mostRecentDocument(base);
    return fallback ? toDocumentResult(fallback, null) : null;
  }
  if (DOCUMENT_TYPE_PRIORITY.length) {
    const types = await listDocumentTypes();
    for (const wanted of DOCUMENT_TYPE_PRIORITY) {
      const type = types.find((t) => t.name.toLowerCase() === wanted.toLowerCase());
      if (!type) continue;
      const doc = await mostRecentDocument(`${base}&document_type__id=${type.id}`);
      if (doc) return toDocumentResult(doc, type.name);
    }
  }
  const doc = await mostRecentDocument(base);
  return doc ? toDocumentResult(doc, null) : null;
}

// Free-text search (paperless's own full-text search) scoped to one correspondent,
// for manually picking a specific document instead of relying on the automatic pick.
export async function searchDocuments(correspondentId, query, limit = 10) {
  const base = `correspondent__id=${encodeURIComponent(correspondentId)}&query=${encodeURIComponent(query)}&page_size=${limit}`;
  const [page, types] = await Promise.all([paperlessFetch(`/api/documents/?${base}`), listDocumentTypes()]);
  return (page.results || []).map((doc) => toDocumentResult(doc, types.find((t) => t.id === doc.document_type)?.name || null));
}

// A single document by id, for displaying one that was manually pinned to an
// entry. Returns null (rather than throwing) if it was since deleted in paperless.
export async function getDocument(id) {
  let doc;
  try {
    doc = await paperlessFetch(`/api/documents/${encodeURIComponent(id)}/`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
  const types = await listDocumentTypes();
  return toDocumentResult(doc, types.find((t) => t.id === doc.document_type)?.name || null);
}

function toDocumentResult(doc, documentType) {
  return { id: doc.id, title: doc.title, created: doc.created, documentType, url: `${PUBLIC_URL_BASE}/documents/${doc.id}` };
}
