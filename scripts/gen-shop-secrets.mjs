/* Generate a shop's session secret, till setup password and PIN hashes.

   Run on YOUR machine (not in a shared session — it prints secrets):
     node scripts/gen-shop-secrets.mjs

   Why a script: STAFF_PIN_HASH and MANAGER_PIN_HASH are not plain SHA-256 of
   the PIN. They are HMAC-SHA256 of the PIN **keyed by SESSION_SECRET** (see
   functions/_lib/auth.js), so a leaked hash can't be brute-forced offline. Two
   consequences people get wrong:

     1. SESSION_SECRET has to exist FIRST — the hashes are derived from it.
     2. Changing SESSION_SECRET later silently invalidates BOTH PIN hashes, and
        staff simply can't log in. Regenerate them together or not at all.

   auth.js also still accepts a legacy bare SHA-256 hash, so an older shop can be
   migrated with no downtime — but anything generated here is the keyed form.

   Nothing is written to disk. Paste the output straight into the Pages project
   as ENCRYPTED environment variables, on Production AND Preview. */
import { createHmac, randomBytes } from 'node:crypto';
import readline from 'node:readline';

/* One interface, pulled as a line iterator. Two things this avoids: a fresh
   readline per question hangs once stdin is piped (closing the first consumes
   the stream), and overriding _writeToOutput to hide the PIN fights readline's
   own bookkeeping and stalls the next prompt. The PIN therefore echoes as you
   type it — it is a short PIN on your own machine, and only its hash is ever
   stored, which is the part that matters. */
const rl = readline.createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();

const ask = async (q) => {
  process.stdout.write(q);
  const { value, done } = await lines.next();
  if (done) { process.stdout.write('\n'); return ''; }
  return String(value).trim();
};

const hmacHex = (value, key) => createHmac('sha256', key).update(value).digest('hex');

const slug = (await ask('Shop slug (e.g. leaf-cafe): ')) || 'shop';
const staffPin = await ask('Staff PIN (digits, what staff type at /staff): ');
const mgrPin = await ask('Manager PIN (DIFFERENT — gates takings + refunds): ');

rl.close();

if (!staffPin || !mgrPin) {
  console.error('\nBoth PINs are required. Nothing generated.');
  process.exit(1);
}
if (staffPin === mgrPin) {
  console.error('\nThe manager PIN must differ from the staff PIN — otherwise the '
    + 'financial views and refund override are gated by a PIN every member of staff already knows.');
  process.exit(1);
}

// 48 random bytes. Signs session cookies AND keys the PIN hashes below.
const sessionSecret = randomBytes(48).toString('base64');
// Per-shop, and different from every other shop's.
const tillPassword = randomBytes(12).toString('base64url');

console.log(`\n${'='.repeat(64)}\n  ${slug} — paste as ENCRYPTED vars, Production AND Preview\n${'='.repeat(64)}\n`);
console.log(`SESSION_SECRET\n  ${sessionSecret}\n`);
console.log(`STAFF_PIN_HASH\n  ${hmacHex(staffPin, sessionSecret)}\n`);
console.log(`MANAGER_PIN_HASH\n  ${hmacHex(mgrPin, sessionSecret)}\n`);
console.log(`TILL_SETUP_PASSWORD\n  ${tillPassword}\n`);
console.log('-'.repeat(64));
console.log('These three belong together. If you regenerate SESSION_SECRET you MUST');
console.log('regenerate both PIN hashes from it, or nobody can log in to the till.');
console.log('Keep the PINs themselves somewhere safe — they are not recoverable');
console.log('from the hashes, which is the point.');
console.log('-'.repeat(64));
