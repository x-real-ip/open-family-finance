/**
 * API client. Keeps the same interface as the previous storage (get/set/delete),
 * but talks to the backend at /api. nginx (production) or the Vite proxy (local)
 * forwards /api to the backend service. No hosts are hardcoded.
 *
 * Optional: set VITE_API_TOKEN if the backend expects a bearer token.
 */
const TOKEN = import.meta.env.VITE_API_TOKEN;

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
