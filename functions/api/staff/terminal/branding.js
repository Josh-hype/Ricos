/* POST /api/staff/terminal/branding — put the shop's logo on the card reader's idle
   screen. The browser reads its own /logo.png and posts the bytes (base64) so the
   Function never self-fetches; falls back to the Pages ASSETS binding for the native app.
   The image is uploaded to Stripe, wrapped in a Terminal Configuration, and that config is
   assigned to the shop's Terminal location (readers there adopt it). We avoid
   `is_account_default`, which older account API versions reject.

   GET ?step=logo|upload|full&key=rdiag — temporary diagnostic probe (run a step, get JSON;
   ?step=full sets the branding). GET with no step returns the deployed version. */

import { requirePermission } from '../../../_lib/permissions.js';
import { getConfig } from '../../../_lib/config.js';
import {
  uploadTerminalSplash, createTerminalConfiguration,
  listTerminalLocations, createTerminalLocation, updateTerminalLocation,
} from '../../../_lib/stripe.js';

const VERSION = 'v6-location';
const PROBE_KEY = 'rdiag';

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error((label || 'request') + ' timed out')), ms)),
  ]);
}
function json(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}
function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'image/png' });
}
async function readLogoServerSide(request, env) {
  const logoUrl = new URL('/logo.png', request.url).toString();
  const r = (env.ASSETS && env.ASSETS.fetch) ? await env.ASSETS.fetch(new Request(logoUrl)) : await fetch(logoUrl);
  if (!r.ok) throw new Error('logo status ' + r.status);
  return { buf: await r.arrayBuffer(), type: r.headers.get('content-type') || 'image/png' };
}
async function ensureLocation(acct, env) {
  const locs = await withTimeout(listTerminalLocations(acct, env), 12000, 'list locations');
  let location = (locs.data || [])[0];
  if (!location) {
    const biz = getConfig().business || {};
    const addr = biz.address || {};
    location = await withTimeout(createTerminalLocation(
      biz.tradingName || biz.shortName || 'Counter',
      { line1: addr.line1 || 'Counter', city: addr.city || '', postal_code: addr.postcode || '', country: 'GB' },
      acct, env), 12000, 'create location');
  }
  return location;
}
// Upload the splash, wrap it in a config, and assign that config to the location.
async function applyLogo(blob, acct, env) {
  const file = await withTimeout(uploadTerminalSplash(blob, 'reader-splash.png', acct, env), 20000, 'Stripe upload');
  const cfg = await withTimeout(createTerminalConfiguration({ splashscreenFileId: file.id }, acct, env), 15000, 'Stripe config');
  const location = await ensureLocation(acct, env);
  await withTimeout(updateTerminalLocation(location.id, { configuration_overrides: cfg.id }, acct, env), 12000, 'apply to location');
  return { fileId: file.id, configurationId: cfg.id, locationId: location.id };
}

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const step = url.searchParams.get('step');
  if (!step) return json({ ok: true, version: VERSION });
  if (url.searchParams.get('key') !== PROBE_KEY) return json({ ok: false, error: 'add &key=' + PROBE_KEY }, 403);
  try {
    const acct = getConfig().stripe?.connectedAccountId;
    if (!acct || acct === 'TBD') return json({ ok: false, step, error: 'no connected account configured' });

    const got = await withTimeout(readLogoServerSide(request, env), 12000, 'logo read');
    const blob = new Blob([got.buf], { type: got.type });
    if (step === 'logo') return json({ ok: true, step: 'logo', size: got.buf.byteLength, type: got.type });

    const file = await withTimeout(uploadTerminalSplash(blob, 'reader-splash.png', acct, env), 20000, 'Stripe upload');
    if (step === 'upload') return json({ ok: true, step: 'upload', fileId: file.id });

    const cfg = await withTimeout(createTerminalConfiguration({ splashscreenFileId: file.id }, acct, env), 15000, 'Stripe config');
    const location = await ensureLocation(acct, env);
    await withTimeout(updateTerminalLocation(location.id, { configuration_overrides: cfg.id }, acct, env), 12000, 'apply to location');
    return json({ ok: true, step: 'full', fileId: file.id, configurationId: cfg.id, locationId: location.id, note: 'branding set ✓' });
  } catch (e) {
    return json({ ok: false, step, error: e && e.message ? e.message : 'unknown' });
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const denied = await requirePermission(request, env, 'sell');
    if (denied) return denied;

    let body = {};
    try { body = await request.json(); } catch { /* tolerate empty body */ }

    const acct = getConfig().stripe?.connectedAccountId;
    if (!acct || acct === 'TBD') return json({ error: 'Card payments are not configured for this shop.' }, 400);

    let blob;
    if (body.logo) {
      try { blob = b64ToBlob(String(body.logo), body.contentType); }
      catch (e) { return json({ error: 'Bad logo data: ' + (e.message || 'decode failed') }, 400); }
    } else {
      try { const got = await withTimeout(readLogoServerSide(request, env), 12000, 'logo read'); blob = new Blob([got.buf], { type: got.type }); }
      catch (e) { return json({ error: 'Could not load the shop logo: ' + (e.message || 'failed') }, 502); }
    }

    let result;
    try { result = await applyLogo(blob, acct, env); }
    catch (e) { return json({ error: 'Could not set the reader logo: ' + (e.message || 'Stripe error') }, 502); }

    return json({ ok: true, version: VERSION, ...result });
  } catch (e) {
    return json({ error: 'Branding failed: ' + (e && e.message ? e.message : 'unknown error') }, 500);
  }
};
