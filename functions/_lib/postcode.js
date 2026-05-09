/* UK postcode normalisation + outcode allow-list check. */

export function normalisePostcode(raw) {
  if (!raw) return null;
  const cleaned = String(raw).toUpperCase().replace(/\s+/g, '');
  // Standard UK regex (relaxed). Examples: YO241AZ, SW1A1AA.
  const m = cleaned.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  if (!m) return null;
  return { outcode: m[1], incode: m[2], formatted: `${m[1]} ${m[2]}` };
}

export function isOutcodeAllowed(outcode, allowed) {
  if (!outcode) return false;
  return allowed.includes(outcode.toUpperCase());
}

export function validateDeliveryPostcode(raw, allowedOutcodes) {
  const p = normalisePostcode(raw);
  if (!p) return { ok: false, reason: 'Please enter a valid UK postcode.' };
  if (!isOutcodeAllowed(p.outcode, allowedOutcodes)) {
    return {
      ok: false,
      reason: `Sorry, we don't deliver to ${p.formatted}. We deliver inside the York ring road only.`,
    };
  }
  return { ok: true, postcode: p.formatted, outcode: p.outcode };
}
