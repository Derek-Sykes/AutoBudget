import { describe, expect, it } from "vitest";
import {
  computeFreeToSpend,
  formatCents,
  isFullyFunded,
  MoneyError,
  parseDollarsToCents,
  remainingCapacityCents,
} from "@/domain/money";

describe("parseDollarsToCents", () => {
  it("parses plain and formatted dollar strings to integer cents", () => {
    expect(parseDollarsToCents("12.34")).toBe(1234);
    expect(parseDollarsToCents("$1,234.56")).toBe(123456);
    expect(parseDollarsToCents("12")).toBe(1200);
    expect(parseDollarsToCents("12.5")).toBe(1250);
    expect(parseDollarsToCents("0.99")).toBe(99);
    expect(parseDollarsToCents(12.34)).toBe(1234);
  });

  it("rejects invalid, negative, and over-precise amounts", () => {
    expect(() => parseDollarsToCents("abc")).toThrow(MoneyError);
    expect(() => parseDollarsToCents("-5")).toThrow(MoneyError);
    expect(() => parseDollarsToCents("1.234")).toThrow(MoneyError);
    expect(() => parseDollarsToCents("")).toThrow(MoneyError);
  });
});

describe("formatCents", () => {
  it("formats integer cents as USD", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(-150)).toBe("-$1.50");
  });
});

describe("computeFreeToSpend", () => {
  it("is Main Account balance minus Set Aside", () => {
    expect(computeFreeToSpend(500_000, 213_000)).toBe(287_000);
    expect(computeFreeToSpend(100, 100)).toBe(0);
  });
});

describe("isFullyFunded / remainingCapacityCents", () => {
  it("detects fully funded only against a positive target", () => {
    expect(isFullyFunded(1000, 1000)).toBe(true);
    expect(isFullyFunded(1200, 1000)).toBe(true);
    expect(isFullyFunded(999, 1000)).toBe(false);
    expect(isFullyFunded(1000, null)).toBe(false);
    expect(isFullyFunded(1000, 0)).toBe(false);
  });

  it("reports remaining capacity (Infinity when no target)", () => {
    expect(remainingCapacityCents(400, 1000)).toBe(600);
    expect(remainingCapacityCents(1000, 1000)).toBe(0);
    expect(remainingCapacityCents(1200, 1000)).toBe(0);
    expect(remainingCapacityCents(100, null)).toBe(Infinity);
  });
});
