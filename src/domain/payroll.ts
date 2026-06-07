import type { PayFrequency } from "./types";

// ---------------------------------------------------------------------------
// Pure pay-schedule math. All dates are treated as UTC calendar days so the
// engine is fully deterministic (no local-timezone drift). A "pay date" is a
// UTC-midnight Date. These functions never touch the database.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export interface JobSchedule {
  payFrequency: PayFrequency;
  /** Anchor + start boundary: no paycheck is ever generated before this date. */
  firstPayDate: Date;
  semiMonthlyDay1?: number | null;
  semiMonthlyDay2?: number | null;
}

function utcDay(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

/** Normalize any Date/instant to its UTC-midnight calendar day. */
export function startOfUtcDay(d: Date): Date {
  return utcDay(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** The two semimonthly days, normalized and ordered (defaults to 1 and 15). */
function semiDays(s: JobSchedule): [number, number] {
  const a = clampDay(s.semiMonthlyDay1 ?? 1);
  const b = clampDay(s.semiMonthlyDay2 ?? 15);
  return a <= b ? [a, b] : [b, a];
}

function clampDay(day: number): number {
  if (!Number.isFinite(day)) return 1;
  return Math.min(31, Math.max(1, Math.trunc(day)));
}

/** A semimonthly pay date for a given month, clamping the day to month length. */
function semiDate(year: number, monthIndex: number, day: number): Date {
  return utcDay(year, monthIndex, Math.min(day, daysInMonth(year, monthIndex)));
}

/** A monthly pay date in a given month, clamping payDay to month length. */
function monthlyDate(year: number, monthIndex: number, payDay: number): Date {
  return utcDay(year, monthIndex, Math.min(payDay, daysInMonth(year, monthIndex)));
}

/** The first scheduled pay date on/after firstPayDate. */
export function firstScheduledDate(s: JobSchedule): Date {
  const first = startOfUtcDay(s.firstPayDate);
  if (s.payFrequency === "semimonthly") {
    const [d1, d2] = semiDays(s);
    let year = first.getUTCFullYear();
    let month = first.getUTCMonth();
    // Search this month and the next for the earliest day >= firstPayDate.
    for (let i = 0; i < 2; i += 1) {
      for (const day of [d1, d2]) {
        const candidate = semiDate(year, month, day);
        if (candidate.getTime() >= first.getTime()) return candidate;
      }
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
    return first; // unreachable in practice
  }
  // weekly / biweekly / monthly: the anchor itself is the first pay date.
  return first;
}

/** The next scheduled pay date strictly after `date`. */
export function nextScheduledDateAfter(s: JobSchedule, date: Date): Date {
  const from = startOfUtcDay(date);
  const first = firstScheduledDate(s);
  if (from.getTime() < first.getTime()) return first;

  if (s.payFrequency === "weekly" || s.payFrequency === "biweekly") {
    const interval = s.payFrequency === "weekly" ? 7 : 14;
    const anchor = startOfUtcDay(s.firstPayDate);
    const diffDays = Math.round((from.getTime() - anchor.getTime()) / DAY_MS);
    let k = Math.floor(diffDays / interval) + 1;
    let candidate = addDays(anchor, k * interval);
    while (candidate.getTime() <= from.getTime()) {
      k += 1;
      candidate = addDays(anchor, k * interval);
    }
    return candidate;
  }

  if (s.payFrequency === "monthly") {
    const payDay = startOfUtcDay(s.firstPayDate).getUTCDate();
    let year = from.getUTCFullYear();
    let month = from.getUTCMonth() + 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    return monthlyDate(year, month, payDay);
  }

  // semimonthly: smallest of the four candidates (this & next month) that is > from
  const [d1, d2] = semiDays(s);
  const candidates: Date[] = [];
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  for (let i = 0; i < 2; i += 1) {
    candidates.push(semiDate(year, month, d1), semiDate(year, month, d2));
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return candidates
    .filter((c) => c.getTime() > from.getTime())
    .sort((a, b) => a.getTime() - b.getTime())[0];
}

/**
 * All pay dates that are due: scheduled on/before `now` (UTC day) and strictly
 * after `lastProcessed` (or from firstScheduledDate when never processed).
 * Returned ascending. Capped to avoid runaway generation for very old anchors.
 */
export function duePayDates(
  s: JobSchedule,
  lastProcessed: Date | null,
  now: Date,
  cap = 1000,
): Date[] {
  const today = startOfUtcDay(now);
  const out: Date[] = [];
  let cursor = lastProcessed
    ? nextScheduledDateAfter(s, lastProcessed)
    : firstScheduledDate(s);
  while (cursor.getTime() <= today.getTime() && out.length < cap) {
    out.push(cursor);
    cursor = nextScheduledDateAfter(s, cursor);
  }
  return out;
}

/** The next upcoming pay date strictly after `now` (for display). */
export function nextPayDate(s: JobSchedule, now: Date): Date {
  return nextScheduledDateAfter(s, startOfUtcDay(now));
}

/** Estimated monthly net income for one job (cents). */
export function estimatedMonthlyIncomeCents(
  payFrequency: PayFrequency,
  amountCents: number,
): number {
  switch (payFrequency) {
    case "weekly":
      return Math.round((amountCents * 52) / 12);
    case "biweekly":
      return Math.round((amountCents * 26) / 12);
    case "semimonthly":
      return amountCents * 2;
    case "monthly":
    default:
      return amountCents;
  }
}

/** Format a pay date as the YYYY-MM-DD key used in idempotency keys. */
export function payDateKey(d: Date): string {
  return startOfUtcDay(d).toISOString().slice(0, 10);
}
