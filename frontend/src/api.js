/**
 * API client. Keeps the same interface as the previous storage (get/set/delete),
 * but talks to the backend at /api. nginx (production) or the Vite proxy (local)
 * forwards /api to the backend service. No hosts are hardcoded.
 *
 * Optional bearer token: read at runtime from window.__ENV__ (see env.js),
 * which is rendered from the API_TOKEN env var. Must match the backend's
 * API_TOKEN.
 *
 * PAPERLESS_ENABLED gates the paperless-ngx correspondent integration on the
 * frontend. The backend has its own PAPERLESS_ENABLED (plus the paperless
 * URL and token, which never reach the browser) — both must be turned on for
 * the integration to actually work; the frontend flag alone only controls
 * whether the UI for it renders at all.
 */
const TOKEN = window.__ENV__?.API_TOKEN;
export const PAPERLESS_ENABLED = String(window.__ENV__?.PAPERLESS_ENABLED || "").toLowerCase() === "true";

async function req(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`API ${method} ${path} -> ${res.status}`);
  return res.json();
}

export const storage = {
  async get(key) {
    const data = await req("GET", `/api/state/${encodeURIComponent(key)}`);
    if (!data) return null;
    // App expects { value } as a JSON string
    return { key, value: JSON.stringify(data.value) };
  },
  async set(key, value) {
    const obj = typeof value === "string" ? JSON.parse(value) : value;
    await req("PUT", `/api/state/${encodeURIComponent(key)}`, obj);
    return { key, value };
  },
  async delete(key) {
    await req("DELETE", `/api/state/${encodeURIComponent(key)}`);
    return { key, deleted: true };
  },
};

export const paperless = {
  // Resolves to [] if the integration is disabled or unreachable — callers
  // never need to branch on that, typing your own value keeps working either way.
  async listCorrespondents() {
    try {
      return (await req("GET", "/api/paperless/correspondents")) || [];
    } catch (e) {
      console.warn("paperless: could not load correspondents", e);
      return [];
    }
  },
  // Best-effort: failures are swallowed so a paperless hiccup never blocks
  // saving the entry itself (the typed value is already stored locally).
  async ensureCorrespondent(name) {
    try {
      return await req("POST", "/api/paperless/correspondents", { name });
    } catch (e) {
      console.warn("paperless: could not sync correspondent", e);
      return null;
    }
  },
  // Resolves to null if there's no document, the integration is disabled, or
  // paperless is unreachable — callers treat all three the same way.
  // `label`, if given, is { kind: "type" | "tag", id } chosen for this entry.
  async latestDocument(correspondentId, label) {
    try {
      const q = label?.kind && label?.id ? `?labelKind=${encodeURIComponent(label.kind)}&labelId=${encodeURIComponent(label.id)}` : "";
      return await req("GET", `/api/paperless/correspondents/${encodeURIComponent(correspondentId)}/latest-document${q}`);
    } catch (e) {
      console.warn("paperless: could not load latest document", e);
      return null;
    }
  },
  // Resolves to { types: [], tags: [] } if disabled/unreachable.
  async listLabels() {
    try {
      return (await req("GET", "/api/paperless/labels")) || { types: [], tags: [] };
    } catch (e) {
      console.warn("paperless: could not load labels", e);
      return { types: [], tags: [] };
    }
  },
  async searchDocuments(correspondentId, query) {
    try {
      return (await req("GET", `/api/paperless/documents?correspondentId=${encodeURIComponent(correspondentId)}&query=${encodeURIComponent(query)}`)) || [];
    } catch (e) {
      console.warn("paperless: could not search documents", e);
      return [];
    }
  },
  async getDocument(id) {
    try {
      return await req("GET", `/api/paperless/documents/${encodeURIComponent(id)}`);
    } catch (e) {
      console.warn("paperless: could not load document", e);
      return null;
    }
  },
};
