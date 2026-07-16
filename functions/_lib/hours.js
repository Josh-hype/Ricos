/* Opening-hours and slot validation. All times are interpreted in
   config.ordering.timezone (Europe/London).

   Cross-midnight support: if a window's close > "24:00" (e.g. "25:00"), it
   means close at 01:00 on the next day. This is needed for late-night
   trading on Friday and Saturday. */

const DAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function nowInTz(tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  const dayName = ({ Sun:'sunday', Mon:'monday', Tue:'tuesday', Wed:'wednesday',
    Thu:'thursday', Fri:'friday', Sat:'saturday' })[parts.weekday];
  return {
    dayName,
    minutesOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function hhmmToMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function prevDay(name) {
  const i = DAY_ORDER.indexOf(name);
  return DAY_ORDER[(i - 1 + 7) % 7];
}

export function isOpenNow(config) {
  const tz = config.ordering.timezone;
  const { dayName, minutesOfDay } = nowInTz(tz);
  const lastBuffer = config.ordering.lastOrderBeforeCloseMinutes || 0;

  // Today's windows.
  const today = config.hours[dayName];
  if (today && !today.closed && Array.isArray(today.windows)) {
    for (const w of today.windows) {
      const open = hhmmToMin(w.open);
      const close = hhmmToMin(w.close) - lastBuffer;
      if (minutesOfDay >= open && minutesOfDay <= close) return true;
    }
  }

  // Yesterday's windows that crossed midnight into today.
  const yesterday = config.hours[prevDay(dayName)];
  if (yesterday && !yesterday.closed && Array.isArray(yesterday.windows)) {
    for (const w of yesterday.windows) {
      const close = hhmmToMin(w.close) - lastBuffer;
      if (close > 1440 && minutesOfDay <= (close - 1440)) return true;
    }
  }

  return false;
}

/* Returns array of available slot timestamps (ISO strings) over horizonDays. */
export function listSlots(config) {
  const tz = config.ordering.timezone;
  const slotMin = config.ordering.scheduling.slotMinutes;
  const horizon = config.ordering.scheduling.horizonDays;
  const lead = config.ordering.asapMinPrepMinutes;
  const lastBuffer = config.ordering.lastOrderBeforeCloseMinutes || 0;

  const out = [];
  const baseUtc = new Date();
  for (let d = 0; d < horizon; d++) {
    const day = new Date(baseUtc.getTime() + d * 86400000);
    const weekdayShort = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(day);
    const dayKey = ({ Sun:'sunday', Mon:'monday', Tue:'tuesday', Wed:'wednesday',
      Thu:'thursday', Fri:'friday', Sat:'saturday' })[weekdayShort];
    const conf = config.hours[dayKey];
    if (!conf || conf.closed || !Array.isArray(conf.windows)) continue;
    // Skip a whole day that has a one-off closure — no slots should be offered
    // for a day the shop has taken offline (matches activeClosure's keys,
    // including the indefinite "*" closure).
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(day);
    if (config.closures && (config.closures[ymd] || config.closures['*'])) continue;
    for (const w of conf.windows) {
      const start = hhmmToMin(w.open);
      const end = hhmmToMin(w.close) - lastBuffer;
      const startAligned = Math.ceil(start / slotMin) * slotMin;
      for (let m = startAligned; m <= end; m += slotMin) {
        const slot = buildLocalIso(day, m, tz);
        if (!slot) continue;
        if (slot.getTime() < Date.now() + lead * 60000) continue;
        const iso = slot.toISOString();
        if (!out.includes(iso)) out.push(iso);
      }
    }
  }
  return out;
}

/* Construct a UTC Date that, when interpreted in tz, is on the given day at
   H:M. If minutes >= 1440 the slot rolls onto the next calendar day. */
function buildLocalIso(day, minutes, tz) {
  const adjusted = new Date(day.getTime());
  if (minutes >= 1440) {
    adjusted.setUTCDate(adjusted.getUTCDate() + 1);
    minutes = minutes - 1440;
  }
  const yyyy = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric' }).format(adjusted);
  const mm   = new Intl.DateTimeFormat('en-CA', { timeZone: tz, month: '2-digit' }).format(adjusted);
  const dd   = new Intl.DateTimeFormat('en-CA', { timeZone: tz, day: '2-digit' }).format(adjusted);
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const min = String(minutes % 60).padStart(2, '0');
  const local = new Date(`${yyyy}-${mm}-${dd}T${h}:${min}:00`);
  const localUtcGuess = new Date(local.toLocaleString('en-US', { timeZone: 'UTC' }));
  const localInTz = new Date(local.toLocaleString('en-US', { timeZone: tz }));
  const offsetMs = localUtcGuess.getTime() - localInTz.getTime();
  return new Date(local.getTime() + offsetMs);
}

export function isSlotValid(slotIso, config) {
  if (!slotIso) return false;
  const slot = new Date(slotIso);
  if (Number.isNaN(slot.getTime())) return false;
  const lead = config.ordering.asapMinPrepMinutes;
  if (slot.getTime() < Date.now() + lead * 60000) return false;
  const all = listSlots(config);
  return all.includes(slotIso);
}

const WEEKDAY = { Sun: 'sunday', Mon: 'monday', Tue: 'tuesday', Wed: 'wednesday', Thu: 'thursday', Fri: 'friday', Sat: 'saturday' };

// Shop-local calendar date (YYYY-MM-DD), weekday key and minutes-into-day for any Date.
function localParts(when, tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(when).map(x => [x.type, x.value]));
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    dayKey: WEEKDAY[p.weekday],
    minutesOfDay: (Number(p.hour) % 24) * 60 + Number(p.minute),
  };
}

/* TEMPORARY, date-bounded delivery late-start.
   config.fulfillment.delivery.lateStart maps shop-local dates "YYYY-MM-DD" -> "HH:MM".
   On a listed date, online DELIVERY is only offered from that time (it blocks only that
   date's own daytime trading BEFORE the time — never collection, never other dates,
   never other shops). `when` is the fulfillment moment: now for ASAP, or the chosen
   slot. It deliberately does NOT block the post-midnight spillover of the previous
   day's late session (e.g. 00:00-01:00 belongs to Saturday's window, not Sunday's
   daytime), by only blocking at/after that day's own opening time. Self-expiring: once
   the dates pass, every lookup misses and it's a no-op. Returns { ok:false, from } when
   delivery is too early, else { ok:true }. */
export function deliveryLateStart(config, when = new Date()) {
  const map = config?.fulfillment?.delivery?.lateStart;
  if (!map || typeof map !== 'object') return { ok: true };
  const tz = config.ordering?.timezone || 'Europe/London';
  const { ymd, dayKey, minutesOfDay } = localParts(when, tz);
  const from = map[ymd];
  if (!from || typeof from !== 'string') return { ok: true };
  const fromMin = hhmmToMin(from);
  const day = config.hours?.[dayKey];
  const openMin = (day && !day.closed && Array.isArray(day.windows) && day.windows.length)
    ? Math.min(...day.windows.map(w => hhmmToMin(w.open)))
    : (Number(config.ordering?.businessDayStartHour) || 0) * 60;
  if (minutesOfDay >= openMin && minutesOfDay < fromMin) return { ok: false, from };
  return { ok: true };
}

/* One-off full-day closure. config.closures maps shop-local "YYYY-MM-DD" -> { title,
   message }. On a listed date the shop is fully closed for online ordering (enforced
   in /api/order) and the order page shows the message + disables checkout. Self-
   expiring: a past date never matches, so it's a no-op afterwards. The special key
   "*" closes the shop indefinitely ("until further notice") — it matches every
   date until the entry is removed from config. A date entry wins over "*" so a
   specific day can carry its own message. Returns { title, message } for the
   given day, else null. */
export function activeClosure(config, when = new Date()) {
  const closures = config?.closures;
  if (!closures || typeof closures !== 'object') return null;
  const tz = config.ordering?.timezone || 'Europe/London';
  const { ymd } = localParts(when, tz);
  const rec = closures[ymd] || closures['*'];
  if (!rec || typeof rec !== 'object') return null;
  return {
    title: (rec.title && String(rec.title)) || 'We’re closed today',
    message: String(rec.message || 'We’re closed today. Apologies for any inconvenience.'),
  };
}
