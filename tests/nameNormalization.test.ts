import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createUserAccount, updateCurrentUserProfile } from "@/server/auth";
import { createCategory, createPocket } from "@/server/services/catalog";
import { createJob } from "@/server/services/jobs";
import { LedgerError } from "@/server/services/ledger";
import { seedUser } from "./factories";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("user-created name normalization", () => {
  it("capitalizes signup display names without title-casing email addresses", async () => {
    const user = await createUserAccount({
      email: "  PERSON.Name@Example.COM ",
      displayName: "  derek   sykes ",
      password: "password123",
      confirmPassword: "password123",
    });

    expect(user.email).toBe("person.name@example.com");
    expect(user.displayName).toBe("Derek Sykes");
  });

  it("capitalizes account display-name updates", async () => {
    const user = await createUserAccount({
      email: "profile@example.com",
      displayName: "old name",
      password: "password123",
      confirmPassword: "password123",
    });

    await updateCurrentUserProfile({ userId: user.id, displayName: "  john   smith " });

    await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.toMatchObject({
      displayName: "John Smith",
    });
  });

  it("capitalizes category and pocket names", async () => {
    const { userId } = await seedUser();
    const category = await createCategory({ userId, name: "  monthly   bills " });
    const pocket = await createPocket({
      userId,
      categoryId: category.id,
      name: "  rent   money ",
      targetAmountCents: 100_000,
    });

    expect(category.name).toBe("Monthly Bills");
    expect(pocket.name).toBe("Rent Money");
  });

  it("capitalizes job and income source names", async () => {
    const { userId } = await seedUser();
    const job = await createJob({
      userId,
      name: "  side   gig ",
      amountCents: 100_000,
      payFrequency: "weekly",
      firstPayDate: d("2026-01-02"),
      autoDisperse: false,
    });

    expect(job.name).toBe("Side Gig");
  });

  it("keeps all-caps acronyms when easy", async () => {
    const { userId } = await seedUser();
    const category = await createCategory({ userId, name: "roth IRA" });

    expect(category.name).toBe("Roth IRA");
  });

  it("still rejects empty or whitespace-only names", async () => {
    const { userId } = await seedUser();
    const category = await createCategory({ userId, name: "Travel" });

    await expect(createCategory({ userId, name: "   " })).rejects.toThrow(LedgerError);
    await expect(
      createPocket({ userId, categoryId: category.id, name: "   ", targetAmountCents: 100_000 }),
    ).rejects.toThrow(LedgerError);
    await expect(
      createJob({
        userId,
        name: "   ",
        amountCents: 100_000,
        payFrequency: "weekly",
        firstPayDate: d("2026-01-02"),
        autoDisperse: false,
      }),
    ).rejects.toThrow(LedgerError);
  });
});
