/* Opening-hours and slot validation. All times are interpreted in
   config.ordering.timezone (Europe/London). */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

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
    hh: Number(parts.hour),
    mm: Number(parts.minute),
    minutesOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function hhmmToMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function isOpenNow(config) {
  const { dayName, minutesOfDay } = nowInTz(config.ordering.timezone);
  const day = config.hours[dayName];
  if (!day || day.closed) return false;
  for (const w of day.windows) {
    const open = hhmmToMin(w.open);
    const close = hhmmToMin(w.close) - (config.ordering.lastOrderBeforeCloseMinutes || 0);
    if (minutesOfDay >= open && minutesOfDay <= close) return true;
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
    const dayKey = DAYS[Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' })
      .format(day)
      .replace('Sun','0').replace('Mon','1').replace('Tue','2').replace('Wed','3')
      .replace('Thu','4').replace('Fri','5').replace('Sat','6'))];
    const conf = config.hours[dayKey];
    if (!conf || conf.closed) continue;
    for (const w of conf.windows) {
      const start = hhmmToMin(w.open);
      const end = hhmmToMin(w.close) - lastBuffer;
      // Build slots aligned to the slot grid.
      const startAligned = Math.ceil(start / slotMin) * slotMin;
      for (let m = startAligned; m <= end; m += slotMin) {
        const slot = buildLocalIso(day, m, tz);
        if (!slot) continue;
        // Skip slots earlier than now + lead minutes.
        if (slot.getTime() < Date.now() + lead * 60000) continue;
        out.push(slot.toISOString());
      }
    }
  }
  return out;
}

/* Construct a UTC Date that, when interpreted in tz, is on the given day at H:M. */
function buildLocalIso(day, minutes, tz) {
  const yyyy = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric' }).format(day);
  const mm = new Intl.DateTimeFormat('en-CA', { timeZone: tz, month: '2-digit' }).format(day);
  const dd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, day: '2-digit' }).format(day);
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const min = String(minutes % 60).padStart(2, '0');
  // Build a string and let Date parse it as if the wall-clock time is in tz.
  // We approximate by computing the offset for that day.
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
  // Check it's within an open window. Cheap check: compare to listSlots.
  const all = listSlots(config);
  return all.includes(slotIso);
}
