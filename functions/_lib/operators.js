/* Per-operator identity for the staff EPOS, stored in STAFF_LOGIN_KV:
     op:<id>          full operator record (incl. pinHash)
     oppin:<pinHash>  reverse index pinHash -> operator id (login lookup)
     ops:index        array of {id,name,role,colour,active} for listing

   PINs are hashed with HMAC-SHA256 keyed by env.SESSION_SECRET (per shop), so
   the same PIN maps deterministically to one operator within a shop and we can
   resolve "who is this PIN?" in a single KV read.

   A shop with zero active operators is in legacy mode: login falls back to the
   single STAFF_PIN_HASH and permission checks are bypassed. Adding the first
   operator switches the shop into per-operator mode. No new KV namespace
   needed — we reuse the staff-login namespace that's already bound. */

const INDEX_KEY = 'ops:index';
const opKey = (id) => `op:${id}`;
const pinKey = (hash) => `oppin:${hash}`;
const VALID_ROLES = new Set(['owner', 'manager', 'staff']);
const COLOURS = ['#0070F0', '#0E9F6E', '#B7791F', '#E0464B', '#7C5CFC', '#0EA5E9', '#DB2777', '#0F766E'];

const enc = new TextEncoder();

function kv(env) { return env.STAFF_LOGIN_KV; }

async function pinHash(pin, env) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(env.SESSION_SECRET || ''),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(pin)));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function readIndex(env) {
  if (!kv(env)) return [];
  const raw = await kv(env).get(INDEX_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
async function writeIndex(env, arr) {
  await kv(env).put(INDEX_KEY, JSON.stringify(arr));
}

// Public-safe operator summary (never leaks pinHash).
function publicOp(o) {
  return { id: o.id, name: o.name, role: o.role, colour: o.colour || null, active: o.active !== false };
}

function genId() {
  const a = '0123456789abcdefghijklmnopqrstuvwxyz';
  const b = crypto.getRandomValues(new Uint8Array(8));
  return [...b].map(x => a[x % a.length]).join('');
}

export async function operatorsEnabled(env) {
  const idx = await readIndex(env);
  return idx.some(o => o.active !== false);
}

export async function listOperators(env) {
  return (await readIndex(env)).map(publicOp);
}

export async function getOperator(env, id) {
  if (!kv(env) || !id) return null;
  const raw = await kv(env).get(opKey(id));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Resolve the operator that owns a PIN (login). Only returns active operators.
export async function findOperatorByPin(env, pin) {
  if (!kv(env)) return null;
  const id = await kv(env).get(pinKey(await pinHash(pin, env)));
  if (!id) return null;
  const op = await getOperator(env, id);
  return op && op.active !== false ? op : null;
}

export async function createOperator(env, { name, role, pin, colour }) {
  if (!kv(env)) throw new Error('Staff storage is not configured.');
  name = String(name || '').trim().slice(0, 40);
  role = VALID_ROLES.has(role) ? role : 'staff';
  if (name.length < 2) throw new Error('Enter a name.');
  if (!/^\d{4,8}$/.test(String(pin || ''))) throw new Error('PIN must be 4–8 digits.');

  const h = await pinHash(pin, env);
  if (await kv(env).get(pinKey(h))) throw new Error('That PIN is already in use.');

  const idx = await readIndex(env);
  const op = {
    id: genId(), name, role,
    colour: colour || COLOURS[idx.length % COLOURS.length],
    pinHash: h, active: true, createdAt: new Date().toISOString(),
  };
  await kv(env).put(opKey(op.id), JSON.stringify(op));
  await kv(env).put(pinKey(h), op.id);
  idx.push(publicOp(op));
  await writeIndex(env, idx);
  return publicOp(op);
}

export async function updateOperator(env, id, patch) {
  const op = await getOperator(env, id);
  if (!op) throw new Error('Operator not found.');

  if (patch.name != null) {
    const n = String(patch.name).trim().slice(0, 40);
    if (n.length < 2) throw new Error('Enter a name.');
    op.name = n;
  }
  if (patch.role != null && VALID_ROLES.has(patch.role)) op.role = patch.role;
  if (patch.colour != null) op.colour = String(patch.colour).slice(0, 9);
  if (patch.active != null) op.active = !!patch.active;

  if (patch.pin != null && patch.pin !== '') {
    if (!/^\d{4,8}$/.test(String(patch.pin))) throw new Error('PIN must be 4–8 digits.');
    const newH = await pinHash(patch.pin, env);
    const clash = await kv(env).get(pinKey(newH));
    if (clash && clash !== id) throw new Error('That PIN is already in use.');
    if (op.pinHash && op.pinHash !== newH) await kv(env).delete(pinKey(op.pinHash));
    op.pinHash = newH;
  }

  // Keep the PIN reverse-index in step with active state: a deactivated
  // operator can't log in; an active one with a PIN can.
  if (op.pinHash) {
    if (op.active === false) await kv(env).delete(pinKey(op.pinHash));
    else await kv(env).put(pinKey(op.pinHash), id);
  }

  await kv(env).put(opKey(id), JSON.stringify(op));
  await writeIndex(env, (await readIndex(env)).map(o => (o.id === id ? publicOp(op) : o)));
  return publicOp(op);
}

export async function deactivateOperator(env, id) {
  return updateOperator(env, id, { active: false });
}
