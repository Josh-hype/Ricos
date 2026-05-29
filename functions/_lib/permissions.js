/* Role → permission model for the staff EPOS. Shared across every shop (golden
   rule #3); *which* operators exist — and therefore whether these roles are
   enforced at all — is per-shop data in KV (see operators.js).

   Legacy mode: a shop with zero operators configured bypasses enforcement and
   keeps the original single-staff-PIN behaviour. Adding the first operator
   switches the shop into per-operator mode and these permissions start to bite. */

import { readSession, readAuthToken } from './auth.js';
import { operatorsEnabled } from './operators.js';

// Granular capabilities a role may hold.
export const ALL_PERMISSIONS = [
  'sell',             // ring a counter sale
  'orders.manage',    // accept / ready / out-for-delivery / complete
  'refund',           // issue refunds
  'discount',         // apply manual discounts / comps
  'void',             // void / cancel orders
  'drawer.open',      // no-sale / open the cash drawer
  'cash.manage',      // float, cash in/out, cash-up
  'reports.view',     // Today's summary + Z report
  'operators.manage', // add / edit / remove staff
];

const ROLE_PERMS = {
  owner:   ['*'],
  manager: ['sell', 'orders.manage', 'refund', 'discount', 'void', 'drawer.open', 'cash.manage', 'reports.view', 'operators.manage'],
  staff:   ['sell', 'orders.manage'],
};

export const ROLES = Object.keys(ROLE_PERMS);

export function roleHasPermission(role, perm) {
  const set = ROLE_PERMS[role];
  if (!set) return false;
  return set.includes('*') || set.includes(perm);
}

export function permissionsForRole(role) {
  const set = ROLE_PERMS[role];
  if (!set) return [];
  return set.includes('*') ? ALL_PERMISSIONS.slice() : set.slice();
}

/* Gate a Function on a permission. Returns null when allowed, or a Response
   (401/403) when not. Allowed when:
     - the shop has no operators configured (legacy mode), OR
     - the session operator's role holds the permission, OR
     - a valid short-lived manager-override token for this permission is
       supplied via the 'X-Authorize-Token' header.
   Populates `out` with { operator, approver? } so the caller can attribute /
   audit the action. */
export async function requirePermission(request, env, perm, out = {}) {
  const session = await readSession(request.headers.get('Cookie'), env);
  if (!session) return resp({ error: 'unauthorized' }, 401);
  out.operator = session.op ? { id: session.op, name: session.name, role: session.role } : null;

  // Legacy mode: any valid staff session can do anything (unchanged behaviour).
  if (!(await operatorsEnabled(env))) return null;

  // A session minted before operators existed (no embedded identity) keeps full
  // access until it expires — it authenticated with the shared staff PIN, the
  // pre-existing trust level. New logins must use an operator PIN, so no fresh
  // legacy sessions can be created once operators exist.
  if (!session.op) return null;

  const role = session.role || 'staff';
  if (roleHasPermission(role, perm)) return null;

  // Manager override: a permitted colleague authorised this one action.
  const token = request.headers.get('X-Authorize-Token');
  if (token) {
    const auth = await readAuthToken(token, env);
    if (auth && (auth.perm === perm || auth.perm === '*')) {
      out.approver = { id: auth.op, name: auth.name };
      return null;
    }
  }
  return resp({ error: 'forbidden', need: perm }, 403);
}

function resp(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
