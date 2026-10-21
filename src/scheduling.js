const config = require('./config');

// All times are minutes after midnight, local facility time.

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function label12(min) {
  let h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function partyMinutes(cfg = config) {
  return cfg.party.phases.reduce((s, p) => s + p.minutes, 0);
}

/** Time windows a party starting at `start` occupies. */
function windowsFor(start, cfg = config) {
  const end = start + partyMinutes(cfg);
  const phases = [];
  let t = start;
  for (const p of cfg.party.phases) {
    phases.push({ key: p.key, label: p.label, start: t, end: t + p.minutes, exclusive: !!p.exclusive });
    t += p.minutes;
  }
  return { start, end, occupiedUntil: end + cfg.party.turnoverMinutes, phases };
}

const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

/**
 * Why can't a party start at `start`? Returns null if it can.
 * @param {number[]} existingStarts start minutes of parties already holding this date
 */
function conflictReason(start, existingStarts, cfg = config) {
  const cand = windowsFor(start, cfg);
  const others = existingStarts.map((s) => windowsFor(s, cfg));

  // 1) Exclusive rooms (the single video game room) can't overlap.
  for (const phase of cand.phases.filter((p) => p.exclusive)) {
    for (const o of others) {
      const op = o.phases.find((p) => p.key === phase.key);
      if (op && overlaps(phase.start, phase.end, op.start, op.end)) {
        return `${phase.label} is booked then`;
      }
    }
  }

  // 2) No more than maxConcurrentParties at any moment (including turnover time).
  const checkpoints = new Set([cand.start]);
  for (const o of others) {
    if (o.start > cand.start && o.start < cand.occupiedUntil) checkpoints.add(o.start);
  }
  for (const t of checkpoints) {
    const busy = others.filter((o) => o.start <= t && t < o.occupiedUntil).length;
    if (busy + 1 > cfg.party.maxConcurrentParties) return 'Fully booked at that time';
  }
  return null;
}

/**
 * List every start time for a date with availability.
 * @param {string} dateYmd 'YYYY-MM-DD'
 * @param {number[]} existingStarts
 */
function slotsForDate(dateYmd, existingStarts, cfg = config) {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const hours = cfg.partyHours[weekday];
  if (!hours) return { open: false, slots: [] };

  const open = toMinutes(hours.open);
  const close = toMinutes(hours.close);
  const length = partyMinutes(cfg);
  const slots = [];
  for (let s = open; s + length <= close; s += cfg.party.slotIntervalMinutes) {
    const reason = conflictReason(s, existingStarts, cfg);
    slots.push({ start: s, time: toHHMM(s), label: label12(s), endLabel: label12(s + length), available: !reason, reason });
  }
  return { open: true, slots };
}

module.exports = { toMinutes, toHHMM, label12, partyMinutes, windowsFor, conflictReason, slotsForDate };
