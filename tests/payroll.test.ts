import { describe, expect, it } from "vitest";
import {
  duePayDates,
  estimatedMonthlyIncomeCents,
  firstScheduledDate,
  nextPayDate,
  nextScheduledDateAfter,
  payDateKey,
  type JobSchedule,
} from "@/domain/payroll";

/** UTC calendar day from "YYYY-MM-DD". */
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
/** Due pay dates as YYYY-MM-DD strings. */
const due = (s: JobSchedule, last: string | null, now: string) =>
  duePayDates(s, last ? d(last) : null, d(now)).map(payDateKey);

const weekly = (first: string): JobSchedule => ({ payFrequency: "weekly", firstPayDate: d(first) });
const biweekly = (first: string): JobSchedule => ({ payFrequency: "biweekly", firstPayDate: d(first) });
const monthly = (first: string): JobSchedule => ({ payFrequency: "monthly", firstPayDate: d(first) });
const semi = (first: string, d1 = 1, d2 = 15): JobSchedule => ({
  payFrequency: "semimonthly",
  firstPayDate: d(first),
  semiMonthlyDay1: d1,
  semiMonthlyDay2: d2,
});

describe("weekly schedule", () => {
  const s = weekly("2026-01-02"); // Friday
  it("does not pay before the first pay date", () => {
    expect(due(s, null, "2026-01-01")).toEqual([]);
  });
  it("pays on the exact pay date", () => {
    expect(due(s, null, "2026-01-02")).toEqual(["2026-01-02"]);
  });
  it("returns each weekly date for multiple missed paydays", () => {
    expect(due(s, null, "2026-01-23")).toEqual([
      "2026-01-02",
      "2026-01-09",
      "2026-01-16",
      "2026-01-23",
    ]);
  });
  it("only returns dates after lastProcessed (one missed payday)", () => {
    expect(due(s, "2026-01-02", "2026-01-09")).toEqual(["2026-01-09"]);
  });
});

describe("biweekly schedule", () => {
  const s = biweekly("2026-01-02");
  it("steps every 14 days", () => {
    expect(due(s, null, "2026-02-13")).toEqual([
      "2026-01-02",
      "2026-01-16",
      "2026-01-30",
      "2026-02-13",
    ]);
  });
  it("does not pay one day early", () => {
    expect(due(s, "2026-01-02", "2026-01-15")).toEqual([]);
    expect(due(s, "2026-01-02", "2026-01-16")).toEqual(["2026-01-16"]);
  });
});

describe("monthly schedule (with month-end clamping)", () => {
  const s = monthly("2026-01-31");
  it("clamps to the last day of shorter months", () => {
    expect(due(s, null, "2026-03-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });
  it("wraps the year", () => {
    expect(payDateKey(nextScheduledDateAfter(monthly("2026-12-15"), d("2026-12-15")))).toBe(
      "2027-01-15",
    );
  });
});

describe("semimonthly schedule (1st & 15th)", () => {
  it("pays both days each month", () => {
    expect(due(semi("2026-01-01"), null, "2026-02-15")).toEqual([
      "2026-01-01",
      "2026-01-15",
      "2026-02-01",
      "2026-02-15",
    ]);
  });
  it("first scheduled date is the first day >= firstPayDate", () => {
    expect(payDateKey(firstScheduledDate(semi("2026-01-10")))).toBe("2026-01-15");
    expect(due(semi("2026-01-10"), null, "2026-02-01")).toEqual(["2026-01-15", "2026-02-01"]);
  });
  it("wraps from the 15th to the 1st of next month and across years", () => {
    expect(payDateKey(nextScheduledDateAfter(semi("2026-01-01"), d("2026-12-15")))).toBe(
      "2027-01-01",
    );
  });
  it("supports custom days", () => {
    expect(due(semi("2026-03-01", 5, 20), null, "2026-03-20")).toEqual([
      "2026-03-05",
      "2026-03-20",
    ]);
  });
});

describe("nextPayDate", () => {
  it("returns the next upcoming date strictly after now", () => {
    expect(payDateKey(nextPayDate(weekly("2026-01-02"), d("2026-01-05")))).toBe("2026-01-09");
  });
  it("returns the first pay date when the job has not started yet", () => {
    expect(payDateKey(nextPayDate(weekly("2026-06-01"), d("2026-05-01")))).toBe("2026-06-01");
  });
});

describe("estimatedMonthlyIncomeCents", () => {
  it("annualizes weekly and biweekly, doubles semimonthly", () => {
    expect(estimatedMonthlyIncomeCents("weekly", 100_000)).toBe(433_333);
    expect(estimatedMonthlyIncomeCents("biweekly", 100_000)).toBe(216_667);
    expect(estimatedMonthlyIncomeCents("semimonthly", 100_000)).toBe(200_000);
    expect(estimatedMonthlyIncomeCents("monthly", 100_000)).toBe(100_000);
  });
});

describe("determinism", () => {
  it("is stable across times of day on the pay date", () => {
    const s = weekly("2026-01-02");
    const morning = duePayDates(s, null, new Date("2026-01-02T06:00:00Z")).map(payDateKey);
    const night = duePayDates(s, null, new Date("2026-01-02T23:59:00Z")).map(payDateKey);
    expect(morning).toEqual(["2026-01-02"]);
    expect(night).toEqual(["2026-01-02"]);
  });
  it("caps runaway generation", () => {
    expect(duePayDates(weekly("1990-01-01"), null, d("2026-01-01"), 50)).toHaveLength(50);
  });
});
