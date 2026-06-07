// Pure money helpers. Money is ALWAYS integer cents — no floating point math
// is ever used for stored balances.

export const BASIS_POINTS_FULL = 10_000; // 100.00%

/** Thrown for invalid money input so callers/validators can surface a message. */
export class MoneyError extends Error {}

/**
 * Parse a user-entered dollar string/number into integer cents.
 * Accepts "$1,234.56", "1234.5", "12", 12.34. Rejects negatives, NaN, and
 * more than two decimal places.
 */
export function parseDollarsToCents(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new MoneyError("Amount is not a number.");
    input = input.toString();
  }
  const cleaned = input.replace(/[$,\s]/g, "").trim();
  if (cleaned === "") throw new MoneyError("Amount is required.");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new MoneyError("Enter a valid dollar amount (max 2 decimals).");
  }
  const [whole, frac = ""] = cleaned.split(".");
  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt(frac.padEnd(2, "0"), 10);
  return cents;
}

/** Format integer cents as a USD currency string, e.g. 123456 -> "$1,234.56". */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const formatted = `${dollars.toLocaleString("en-US")}.${remainder
    .toString()
    .padStart(2, "0")}`;
  return `${negative ? "-" : ""}$${formatted}`;
}

/** Validate a positive integer-cents amount. */
export function assertPositiveCents(cents: number, label = "Amount"): void {
  if (!Number.isInteger(cents)) throw new MoneyError(`${label} must be whole cents.`);
  if (cents <= 0) throw new MoneyError(`${label} must be greater than zero.`);
}

/** Free to Spend = Main Account Balance - Set Aside. Never negative in MVP. */
export function computeFreeToSpend(mainBalanceCents: number, setAsideCents: number): number {
  return mainBalanceCents - setAsideCents;
}

/** A pocket is fully funded when its balance meets or exceeds a positive target. */
export function isFullyFunded(balanceCents: number, targetCents: number | null | undefined): boolean {
  return typeof targetCents === "number" && targetCents > 0 && balanceCents >= targetCents;
}

/** Remaining capacity before a pocket reaches its target (0 if no/met target). */
export function remainingCapacityCents(
  balanceCents: number,
  targetCents: number | null | undefined,
): number {
  if (typeof targetCents !== "number" || targetCents <= 0) return Infinity;
  return Math.max(0, targetCents - balanceCents);
}
