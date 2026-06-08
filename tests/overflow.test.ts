import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  archiveCategory,
  createCategory,
  createPocket,
  setPocketStatus,
} from "@/server/services/catalog";
import { addPaycheck } from "@/server/services/paycheck";
import { setAsideToPocket } from "@/server/services/moneyMovement";
import { transfer } from "@/server/services/transfer";
import { getTransferTargets } from "@/server/queries";
import { purchasePocket, cancelPocket } from "@/server/services/purchaseCancel";
import { LedgerError } from "@/server/services/ledger";
import { makeFundingPlan, seedUser } from "./factories";

const pocket = (id: string) => prisma.pocket.findUniqueOrThrow({ where: { id } });
const overflowOf = (categoryId: string) =>
  prisma.pocket.findFirstOrThrow({ where: { categoryId, isOverflow: true } });

describe("Overflow pocket lifecycle", () => {
  it("creates exactly one Overflow pocket with each category", async () => {
    const { userId } = await seedUser();
    const cat = await createCategory({ userId, name: "Travel" });
    const overflows = await prisma.pocket.findMany({
      where: { categoryId: cat.id, isOverflow: true },
    });
    expect(overflows).toHaveLength(1);
    expect(overflows[0].status).toBe("active");
    expect(overflows[0].targetAmountCents).toBeNull();
    expect(overflows[0].pocketType).toBe("overflow");
  });

  it("rejects creating a pocket with the reserved overflow type", async () => {
    const { userId } = await seedUser();
    const cat = await createCategory({ userId, name: "Travel" });
    await expect(
      createPocket({ userId, categoryId: cat.id, name: "Sneaky", pocketType: "overflow" }),
    ).rejects.toThrow(LedgerError);
  });

  it("rejects archiving the Overflow pocket directly", async () => {
    const { userId } = await seedUser();
    const cat = await createCategory({ userId, name: "Travel" });
    const overflow = await overflowOf(cat.id);

    await expect(
      setPocketStatus({ userId, pocketId: overflow.id, status: "archived" }),
    ).rejects.toThrow(LedgerError);
  });

  it("can't be purchased or cancelled", async () => {
    const { userId } = await seedUser();
    const cat = await createCategory({ userId, name: "Travel" });
    const overflow = await overflowOf(cat.id);
    await expect(
      purchasePocket({ userId, pocketId: overflow.id, purchaseAmountCents: 100 }),
    ).rejects.toThrow(LedgerError);
    await expect(cancelPocket({ userId, pocketId: overflow.id })).rejects.toThrow(LedgerError);
  });

  it("can transfer to and from the Overflow pocket", async () => {
    const { userId } = await seedUser(500_000);
    const cat = await createCategory({ userId, name: "Travel" });
    const overflow = await overflowOf(cat.id);
    const spain = await createPocket({
      userId,
      categoryId: cat.id,
      name: "Spain",
      targetAmountCents: 100_000,
    });

    await setAsideToPocket({ userId, pocketId: spain.id, amountCents: 40_000 });
    await transfer({
      userId,
      sourcePocketId: spain.id,
      destinationType: "pocket",
      destinationId: overflow.id,
      amountCents: 15_000,
    });
    expect((await pocket(overflow.id)).currentBalanceCents).toBe(15_000);

    await transfer({
      userId,
      sourcePocketId: overflow.id,
      destinationType: "pocket",
      destinationId: spain.id,
      amountCents: 5_000,
    });
    expect((await pocket(overflow.id)).currentBalanceCents).toBe(10_000);
    expect((await pocket(spain.id)).currentBalanceCents).toBe(30_000);
  });
});

describe("Overflow captures paycheck leftovers", () => {
  async function fixture(pocketWeightBp: number, rentTargetCents: number) {
    const { userId } = await seedUser(500_000);
    const cat = await createCategory({ userId, name: "Needs" });
    const rent = await createPocket({
      userId,
      categoryId: cat.id,
      name: "Rent",
      targetAmountCents: rentTargetCents,
    });
    await makeFundingPlan(userId, {
      freeToSpendBp: 0,
      categories: [
        { categoryId: cat.id, weightBp: 10000, pockets: [{ pocketId: rent.id, weightBp: pocketWeightBp }] },
      ],
    });
    return { userId, catId: cat.id, rentId: rent.id };
  }

  it("routes the sub-100% remainder to Overflow", async () => {
    const f = await fixture(6000, 1_000_000); // rent claims 60%, big target
    await addPaycheck({ userId: f.userId, amountCents: 100_000, autoDisperse: true });
    expect((await pocket(f.rentId)).currentBalanceCents).toBe(60_000);
    expect((await overflowOf(f.catId)).currentBalanceCents).toBe(40_000);
  });

  it("routes capped-pocket overflow to Overflow", async () => {
    const f = await fixture(10000, 50_000); // rent claims 100% but caps at $500
    await addPaycheck({ userId: f.userId, amountCents: 100_000, autoDisperse: true });
    expect((await pocket(f.rentId)).currentBalanceCents).toBe(50_000);
    expect((await overflowOf(f.catId)).currentBalanceCents).toBe(50_000);
  });

  it("sends the whole share to Overflow when a category has no normal pockets", async () => {
    const { userId } = await seedUser(500_000);
    const cat = await createCategory({ userId, name: "Needs" });
    await makeFundingPlan(userId, {
      freeToSpendBp: 0,
      categories: [{ categoryId: cat.id, weightBp: 10000, pockets: [] }],
    });
    await addPaycheck({ userId, amountCents: 100_000, autoDisperse: true });
    expect((await overflowOf(cat.id)).currentBalanceCents).toBe(100_000);
  });
});

describe("archiveCategory with Overflow", () => {
  it("is blocked while a normal pocket is still live", async () => {
    const { userId } = await seedUser();
    const cat = await createCategory({ userId, name: "Travel" });
    await createPocket({ userId, categoryId: cat.id, name: "Spain", targetAmountCents: 100_000 });
    await expect(archiveCategory({ userId, categoryId: cat.id })).rejects.toThrow(LedgerError);
  });

  it("is blocked while the Overflow pocket holds money", async () => {
    const { userId } = await seedUser(500_000);
    const cat = await createCategory({ userId, name: "Travel" });
    const overflow = await overflowOf(cat.id);
    await setAsideToPocket({ userId, pocketId: overflow.id, amountCents: 1_000 });
    await expect(archiveCategory({ userId, categoryId: cat.id })).rejects.toThrow(LedgerError);
  });

  it("archives an empty category and its Overflow pocket together", async () => {
    const { userId } = await seedUser();
    const cat = await createCategory({ userId, name: "Travel" });
    await archiveCategory({ userId, categoryId: cat.id });
    expect((await prisma.category.findUniqueOrThrow({ where: { id: cat.id } })).status).toBe("archived");
    expect((await overflowOf(cat.id)).status).toBe("archived");
    const targets = await getTransferTargets(userId);
    const archivedOverflow = await overflowOf(cat.id);
    expect(targets.categories.some((target) => target.id === cat.id)).toBe(false);
    expect(targets.pockets.some((target) => target.id === archivedOverflow.id)).toBe(false);
  });

  it("rejects creating a pocket inside an archived category", async () => {
    const { userId } = await seedUser();
    const cat = await createCategory({ userId, name: "Travel" });
    await archiveCategory({ userId, categoryId: cat.id });

    await expect(
      createPocket({
        userId,
        categoryId: cat.id,
        name: "Spain",
        targetAmountCents: 100_000,
      }),
    ).rejects.toThrow(LedgerError);
  });
});
