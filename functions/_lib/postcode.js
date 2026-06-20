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
  if (!outcode || !Array.isArray(allowed)) return false;
  return allowed.includes(outcode.toUpperCase());
}

export function validateDeliveryPostcode(raw, allowedOutcodes, areaDescription = 'in our delivery area', blockedPrefixes = []) {
  const p = normalisePostcode(raw);
  if (!p) return { ok: false, reason: 'Please enter a valid UK postcode.' };
  if (!isOutcodeAllowed(p.outcode, allowedOutcodes)) {
    return {
      ok: false,
      reason: `Sorry, we don't deliver to ${p.formatted}. We deliver ${areaDescription} only.`,
    };
  }
  // Block-list: specific too-far addresses that sit INSIDE an otherwise-allowed
  // outcode (e.g. Bilbrough/Askham Richard share YO23 with Copmanthorpe). A blocked
  // entry matches by the start of the space-free postcode, so it can be an outcode
  // (YO23), a sector (YO233) or a full postcode (YO233PS) — as precise as you need.
  if (Array.isArray(blockedPrefixes) && blockedPrefixes.length) {
    const compact = `${p.outcode}${p.incode}`;
    const hit = blockedPrefixes.some(b => b && compact.startsWith(String(b).toUpperCase().replace(/\s+/g, '')));
    if (hit) {
      return {
        ok: false,
        reason: `Sorry, ${p.formatted} is just outside our delivery range. You can still collect.`,
        suggestCollection: true,
      };
    }
  }
  return { ok: true, postcode: p.formatted, outcode: p.outcode };
}
