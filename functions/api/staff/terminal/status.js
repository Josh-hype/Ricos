/* POST /api/staff/terminal/status — poll the reader while it collects a card.
   The till calls this every ~1.5s after /terminal/charge:
     { status:'in_progress' }        → keep waiting (customer hasn't tapped yet)
     { status:'succeeded' }          → authorised → finalise via /counter-order
     { status:'failed', failure }    → declined / cancelled → show the message
   Read-only; no capture happens here. */

import { requirePermission } from '../../../_lib/permissions.js';
import { getConfig } from '../../../_lib/config.js';
import { retrieveTerminalReader } from '../../../_lib/stripe.js';

export const onRequestPost = async ({ request, env }) => {
  const denied = await requirePermission(request, env, 'sell');
  if (denied) return denied;

  let body;
  try { body = await request.json(); }
  catch { return err('Invalid JSON', 400); }

  const readerId = String(body.readerId || '');
  if (!readerId) return err('Missing reader.', 400);

  const acct = getConfig().stripe?.connectedAccountId;
  let reader;
  try { reader = await retrieveTerminalReader(readerId, acct, env); }
  catch (e) { return err('Could not read the reader status.', 502); }

  const action = reader.action || {};
  return Response.json({
    status: action.status || 'idle', // in_progress | succeeded | failed | idle
    failure: action.failure_message || action.failure_code || null,
  });
};

function err(error, status) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
}
