/* Customer record helpers: read/write to CUSTOMERS_KV. Records are keyed by
   normalised contact (lowercase email or +44... phone) so signin can look up
   directly without needing a secondary index. */

const MAX_SAVED_ADDRESSES = 5;

export async function getCustomer(contact, env) {
  if (!env.CUSTOMERS_KV) return null;
  const raw = await env.CUSTOMERS_KV.get(`customer:${contact}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function putCustomer(customer, env) {
  await env.CUSTOMERS_KV.put(`customer:${customer.contact}`, JSON.stringify(customer));
}

export function newCustomerId() {
  // 12 chars from a 36-char alphabet, with rejection sampling so the modulo
  // doesn't bias the first few characters (256 % 36 != 0).
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const max = 256 - (256 % alphabet.length); // 252
  let out = '';
  while (out.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(12 - out.length))) {
      if (b < max) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

// Public projection: never returns password hash, salt, or iteration count.
// Addresses are sorted most-recently-used first so the frontend can pick the
// first one as the default prefill.
export function publicProfile(customer) {
  if (!customer) return null;
  const addresses = [...(customer.addresses || [])]
    .sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''));
  return {
    name: customer.name,
    contact: customer.contact,
    contactType: customer.contactType,
    email: customer.email || (customer.contactType === 'email' ? customer.contact : null),
    phone: customer.phone || (customer.contactType === 'phone' ? customer.contact : null),
    addresses,
  };
}

// Update the contact details on a customer record from whatever was entered
// at checkout. The signup `contact` (email or phone) stays the login key
// and never changes - we just fill in the *other* channel.
export function updateContactDetails(customer, { email, phone }) {
  if (email && email !== customer.email) customer.email = email;
  if (phone && phone !== customer.phone) customer.phone = phone;
  return customer;
}

// Add (or refresh) an address on a customer's record. Dedupes by lowercased
// line1+postcode so re-ordering to the same place doesn't make duplicate
// entries. Caller is responsible for persisting via putCustomer.
export function upsertAddress(customer, addr) {
  if (!addr || !addr.line1 || !addr.postcode) return customer;
  const normLine1 = addr.line1.trim().toLowerCase();
  const normPostcode = addr.postcode.trim().toUpperCase().replace(/\s+/g, '');
  const now = new Date().toISOString();

  const next = {
    line1: addr.line1.trim().slice(0, 100),
    line2: (addr.line2 || '').trim().slice(0, 100),
    city: (addr.city || '').trim().slice(0, 60),
    postcode: addr.postcode.trim().toUpperCase().slice(0, 12),
    notes: (addr.notes || '').trim().slice(0, 280),
    lastUsedAt: now,
  };

  const existing = customer.addresses || [];
  const filtered = existing.filter(a => {
    const aLine = (a.line1 || '').trim().toLowerCase();
    const aPc = (a.postcode || '').trim().toUpperCase().replace(/\s+/g, '');
    return !(aLine === normLine1 && aPc === normPostcode);
  });
  filtered.unshift(next);
  customer.addresses = filtered.slice(0, MAX_SAVED_ADDRESSES);
  return customer;
}
