// Enum-like unions (SQLite has no native enums). These are the allowed string
// values for the corresponding String columns in schema.prisma.

export const POCKET_TYPES = [
  "one_time_goal",
  "monthly_budget",
  "recurring_bill",
  "emergency_fund",
  "investment_contribution",
  "sinking_fund",
  "free_to_spend",
  "overflow",
] as const;
export type PocketType = (typeof POCKET_TYPES)[number];

/** Name given to every category's auto-created catch-all pocket. */
export const OVERFLOW_POCKET_NAME = "Overflow";

export const POCKET_STATUSES = [
  "draft",
  "active",
  "paused",
  "fully_funded",
  "purchased",
  "cancelled",
  "archived",
] as const;
export type PocketStatus = (typeof POCKET_STATUSES)[number];

/** Pocket statuses whose balances count toward "Set Aside". */
export const SET_ASIDE_STATUSES: PocketStatus[] = ["active", "paused", "fully_funded"];

/** Pocket statuses that may receive new money. */
export const FUNDABLE_STATUSES: PocketStatus[] = ["active"];

export const TRANSACTION_TYPES = [
  "income",
  "payback",
  "refund",
  "expense",
  "transfer",
  "manual_adjustment",
  "purchase",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const BATCH_TYPES = [
  "PAYCHECK_DEPOSIT",
  "PAYBACK_RESTORE",
  "MANUAL_SET_ASIDE",
  "MANUAL_REALLOCATION",
  "PURCHASE",
  "CANCEL_GOAL",
  "MANUAL_ADJUSTMENT",
  "AUTO_ALLOCATION",
  "PAYCHECK_CORRECTION",
  "REVERSAL",
] as const;
export type BatchType = (typeof BATCH_TYPES)[number];

export const BATCH_STATUSES = [
  "pending",
  "applied",
  "partially_reversed",
  "reversed",
  "failed",
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const MOVEMENT_TYPES = [
  "MAIN_ACCOUNT_INCREASE",
  "MAIN_ACCOUNT_DECREASE",
  "SET_ASIDE_TO_POCKET",
  "RELEASE_FROM_POCKET",
  "RESTORE_TO_POCKET",
  "RESTORE_TO_FREE_TO_SPEND",
  "PURCHASE_FROM_POCKET",
  "PURCHASE_FROM_FREE_TO_SPEND",
  "LEFT_AS_FREE_TO_SPEND",
  "PAYCHECK_CORRECTION_TO_FREE_TO_SPEND",
  "PAYCHECK_CORRECTION_FROM_FREE_TO_SPEND",
  "ROUNDING_LEFTOVER",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const LOCATION_TYPES = [
  "main_account",
  "pocket",
  "free_to_spend",
  "category_unallocated",
  "external",
] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const PAY_FREQUENCIES = ["weekly", "biweekly", "monthly", "semimonthly"] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

export const JOB_STATUSES = ["active", "paused", "archived"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type RestoreMode =
  | "exact_original_destinations"
  | "manual_destination"
  | "free_to_spend";

export const NOTIFICATION_TYPES = [
  "POCKET_FULLY_FUNDED",
  "CATEGORY_ALL_FUNDED",
  "PURCHASE_RECORDED",
  "GOAL_CANCELLED",
  "ALLOCATION_NEEDS_REVIEW",
  "FREE_TO_SPEND_LOW",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Effect a movement type has on a stored balance (one effect per movement). */
export type BalanceTarget =
  | "main_account"
  | "pocket_destination"
  | "pocket_source"
  | "none";

interface MovementEffect {
  target: BalanceTarget;
  /** +1 increases the target balance, -1 decreases it. */
  direction: 1 | -1;
}

/**
 * The single balance effect each movement type applies when a batch is applied.
 * Reversal applies the negation of this. Movements with target "none"
 * (free-to-spend / rounding metadata) are logged for auditability but do not
 * mutate a stored row, because Free to Spend is derived.
 */
export const MOVEMENT_EFFECTS: Record<MovementType, MovementEffect> = {
  MAIN_ACCOUNT_INCREASE: { target: "main_account", direction: 1 },
  MAIN_ACCOUNT_DECREASE: { target: "main_account", direction: -1 },
  SET_ASIDE_TO_POCKET: { target: "pocket_destination", direction: 1 },
  RESTORE_TO_POCKET: { target: "pocket_destination", direction: 1 },
  RELEASE_FROM_POCKET: { target: "pocket_source", direction: -1 },
  PURCHASE_FROM_POCKET: { target: "pocket_source", direction: -1 },
  RESTORE_TO_FREE_TO_SPEND: { target: "none", direction: 1 },
  PURCHASE_FROM_FREE_TO_SPEND: { target: "none", direction: -1 },
  LEFT_AS_FREE_TO_SPEND: { target: "none", direction: 1 },
  PAYCHECK_CORRECTION_TO_FREE_TO_SPEND: { target: "none", direction: 1 },
  PAYCHECK_CORRECTION_FROM_FREE_TO_SPEND: { target: "none", direction: -1 },
  ROUNDING_LEFTOVER: { target: "none", direction: 1 },
};
