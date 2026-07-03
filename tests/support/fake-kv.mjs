/* Minimal in-memory stand-in for a Cloudflare KV namespace — enough for the
   handful of KV shapes the unit tests exercise (get/put/delete/list with
   metadata + prefix). Test-only. */
export function makeKV(initial = {}) {
  const store = new Map();          // key -> { value, metadata }
  for (const [k, v] of Object.entries(initial)) {
    store.set(k, { value: typeof v === 'string' ? v : JSON.stringify(v), metadata: null });
  }
  return {
    async get(key, type) {
      const rec = store.get(key);
      if (!rec) return null;
      if (type === 'json') { try { return JSON.parse(rec.value); } catch { return null; } }
      return rec.value;
    },
    async put(key, value, opts = {}) {
      store.set(key, { value: String(value), metadata: opts.metadata ?? null });
    },
    async delete(key) { store.delete(key); },
    async list({ prefix = '', limit = 1000, cursor } = {}) {
      const keys = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([name, rec]) => ({ name, metadata: rec.metadata }));
      return { keys, list_complete: true, cursor: undefined };
    },
    _store: store,
  };
}
