// ---------------------------------------------------------------------------
// MVP mock bank configuration.
//
// The simulated Main Account starting balance lives here as ONE obvious,
// easy-to-edit constant. Later this can be replaced by a real bank API
// response. For now it is hardcoded (with an optional env override) so the
// app works with zero external setup.
// ---------------------------------------------------------------------------

/** Default simulated Main Account starting balance, in integer cents. */
export const MOCK_MAIN_ACCOUNT_STARTING_BALANCE_CENTS = 500_000; // $5,000.00

/** Resolve the starting balance, allowing a numeric env override for local dev. */
export function getMockStartingBalanceCents(): number {
  const raw = process.env.MOCK_MAIN_ACCOUNT_STARTING_BALANCE_CENTS;
  if (raw && /^\d+$/.test(raw.trim())) {
    return Number.parseInt(raw.trim(), 10);
  }
  return MOCK_MAIN_ACCOUNT_STARTING_BALANCE_CENTS;
}

export const DEMO_USER_EMAIL = "demo@autobudget.local";
export const DEMO_USER_PASSWORD = "password123";
export const MAIN_ACCOUNT_NAME = "Main Account";
