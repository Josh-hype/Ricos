import * as auth from '../functions/_lib/auth.js';

const env = { SESSION_SECRET: 'test-secret-123' };
const reqWith = (h) => ({ headers: { get: (k) => h[k] ?? h[k.toLowerCase()] ?? null } });
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  ✗ FAIL:', name); } };

// Mint tokens exactly as login.js does.
const legacy = await auth.makeSession(env);
const op = await auth.makeSession(env, { id: 'op1', name: 'Sam', role: 'manager', colour: '#0070F0' });

// WEB path: cookie (this is the regression-sensitive one).
const c1 = await auth.resolveSession(reqWith({ Cookie: 'rs=' + legacy }), env);
ok('cookie legacy resolves', c1 && typeof c1.exp === 'number' && !c1.op);
const c2 = await auth.resolveSession(reqWith({ Cookie: 'foo=bar; rs=' + op + '; x=y' }), env);
ok('cookie among many resolves operator', c2 && c2.op === 'op1' && c2.name === 'Sam' && c2.role === 'manager');
const cWeb = await auth.readSession('rs=' + op, env);
ok('readSession (web cookie) unchanged', cWeb && cWeb.op === 'op1' && cWeb.role === 'manager');

// APP path: Authorization: Bearer.
const b1 = await auth.resolveSession(reqWith({ Authorization: 'Bearer ' + op }), env);
ok('bearer resolves operator', b1 && b1.op === 'op1' && b1.role === 'manager');
const b2 = await auth.resolveSession(reqWith({ Authorization: 'bearer ' + legacy }), env); // case-insensitive
ok('bearer case-insensitive', b2 && typeof b2.exp === 'number');

// Negatives.
ok('no creds -> null', (await auth.resolveSession(reqWith({}), env)) === null);
ok('bad signature -> null', (await auth.resolveSession(reqWith({ Authorization: 'Bearer ' + legacy.slice(0, -4) + 'AAAA' }), env)) === null);
ok('garbage cookie -> null', (await auth.resolveSession(reqWith({ Cookie: 'rs=not.a.token' }), env)) === null);
ok('wrong secret rejects', (await auth.resolveSession(reqWith({ Cookie: 'rs=' + op }), { SESSION_SECRET: 'other' })) === null);

// Expiry.
const expired = await (async () => {
  const realNow = Date.now; Date.now = () => realNow() - 13 * 3600 * 1000; // 13h ago (TTL 12h)
  const t = await auth.makeSession(env, { id: 'x', name: 'Old', role: 'staff' });
  Date.now = realNow; return t;
})();
ok('expired token -> null', (await auth.resolveSession(reqWith({ Authorization: 'Bearer ' + expired }), env)) === null);

// requireStaff gate (web cookie + app bearer + deny).
ok('requireStaff allows cookie', (await auth.requireStaff(reqWith({ Cookie: 'rs=' + legacy }), env)) === null);
ok('requireStaff allows bearer', (await auth.requireStaff(reqWith({ Authorization: 'Bearer ' + op }), env)) === null);
const denied = await auth.requireStaff(reqWith({}), env);
ok('requireStaff denies (401 Response)', denied && denied.status === 401);

// Auth-override token round-trip (manager approval).
const at = await auth.makeAuthToken(env, { op: 'm1', name: 'Boss', perm: 'refund' });
const atRead = await auth.readAuthToken(at, env);
ok('auth token round-trips', atRead && atRead.op === 'm1' && atRead.perm === 'refund');
const atBound = await auth.readAuthToken(await auth.makeAuthToken(env, { op: 'm1', name: 'Boss', perm: 'refund', orderId: 'XYZ123' }), env);
ok('auth token carries order id + jti', atBound && atBound.oid === 'XYZ123' && !!atBound.jti);

// PIN hashing: keyed (preferred) and legacy bare SHA-256 both verify (P0-4).
const te = new TextEncoder();
const sha256Hex = async (s) => { const b = await crypto.subtle.digest('SHA-256', te.encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); };
const hmacHex = async (s, secret) => { const k = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const sig = await crypto.subtle.sign('HMAC', k, te.encode(s)); return [...new Uint8Array(sig)].map(x => x.toString(16).padStart(2, '0')).join(''); };
const PIN = '4271';
ok('checkPin legacy sha256 accepted', await auth.checkPin(PIN, { ...env, STAFF_PIN_HASH: await sha256Hex(PIN) }));
ok('checkPin keyed hmac accepted', await auth.checkPin(PIN, { ...env, STAFF_PIN_HASH: await hmacHex(PIN, env.SESSION_SECRET) }));
ok('checkPin wrong pin rejected (keyed store)', !(await auth.checkPin('9999', { ...env, STAFF_PIN_HASH: await hmacHex(PIN, env.SESSION_SECRET) })));
ok('checkPin no hash -> false', !(await auth.checkPin(PIN, { ...env })));

// CSRF/Origin gate (P2-8).
const mkReq = (h, method = 'POST', url = 'https://shop.example/api/staff/x') => ({ method, url, headers: { get: (k) => h[k] ?? h[k.toLowerCase()] ?? null } });
ok('csrf bearer (app) exempt', auth.csrfOriginCheck(mkReq({ Authorization: 'Bearer x', Origin: 'https://evil.com' })) === null);
ok('csrf GET exempt', auth.csrfOriginCheck(mkReq({ Origin: 'https://evil.com' }, 'GET')) === null);
ok('csrf same-origin POST allowed', auth.csrfOriginCheck(mkReq({ Origin: 'https://shop.example' })) === null);
ok('csrf no-Origin POST allowed', auth.csrfOriginCheck(mkReq({})) === null);
const csrfBad = auth.csrfOriginCheck(mkReq({ Origin: 'https://evil.com' }));
ok('csrf cross-origin POST blocked (403)', csrfBad && csrfBad.status === 403);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
