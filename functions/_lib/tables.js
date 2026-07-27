/* Dine-in tables — the floor list for hospitality shops (coffee shops, restaurants).

   Takeaways don't have tables and never see any of this: the whole feature is
   gated on config.pos.serviceStyle === 'hospitality'. Shops list their tables in
   config.pos.tables, either as plain labels or as objects with an area:

     "tables": ["1", "2", "3"]
     "tables": [{ "id": "w1", "label": "1", "area": "Window" }, …]

   normalizeTables() accepts both and always returns {id,label,area} triples, so
   the till and the order endpoint agree on what a table is. The id is what gets
   stored on the order; the label is what staff and the kitchen see. */

const MAX_TABLES = 200;

function slug(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Config → [{id,label,area}]. Silently drops malformed entries rather than
// throwing: a typo in one table must not take the whole till down.
export function normalizeTables(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw.slice(0, MAX_TABLES)) {
    let label, area, id;
    if (typeof entry === 'string' || typeof entry === 'number') {
      label = String(entry).trim();
    } else if (entry && typeof entry === 'object') {
      label = String(entry.label ?? entry.name ?? entry.id ?? '').trim();
      area = String(entry.area ?? '').trim();
      id = String(entry.id ?? '').trim();
    }
    if (!label) continue;
    label = label.slice(0, 24);
    area = (area || '').slice(0, 32);
    id = (id || slug(area ? `${area}-${label}` : label)).slice(0, 48);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, area });
  }
  return out;
}

export function tablesFor(config) {
  return normalizeTables(config?.pos?.tables);
}

// Look a table up by id (what the till sends). Returns the normalized table or
// null — the caller decides whether that's an error, so an unknown id can never
// be written onto an order.
export function findTable(config, id) {
  const wanted = String(id || '').trim();
  if (!wanted) return null;
  return tablesFor(config).find(t => t.id === wanted) || null;
}
