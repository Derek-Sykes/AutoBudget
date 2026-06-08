import { prisma } from "@/lib/prisma";
import type { Tx } from "@/lib/prisma";
import { normalizeHumanName } from "@/domain/names";
import { LedgerError } from "./ledger";
import { logActivity } from "./activity";
import { isFullyFunded } from "@/domain/money";
import { OVERFLOW_POCKET_NAME, POCKET_TYPES, type PocketType } from "@/domain/types";

/** Create a category's auto-managed Overflow pocket (no target = infinite capacity). */
export function createOverflowPocket(tx: Tx, userId: string, categoryId: string) {
  return tx.pocket.create({
    data: {
      userId,
      categoryId,
      name: OVERFLOW_POCKET_NAME,
      pocketType: "overflow",
      isOverflow: true,
      status: "active",
      targetAmountCents: null,
      currentBalanceCents: 0,
    },
  });
}

// ---------------------------- Categories -----------------------------------

export async function createCategory(input: {
  userId: string;
  name: string;
  description?: string;
}) {
  const name = normalizeHumanName(input.name);
  if (!name) throw new LedgerError("Category name is required.");

  return prisma.$transaction(async (tx) => {
    const last = await tx.category.findFirst({
      where: { userId: input.userId },
      orderBy: { sortOrder: "desc" },
    });
    const category = await tx.category.create({
      data: {
        userId: input.userId,
        name,
        description: input.description?.trim() || null,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
    // Every category comes with an Overflow pocket.
    await createOverflowPocket(tx, input.userId, category.id);
    await logActivity(tx, {
      userId: input.userId,
      type: "CATEGORY_CREATED",
      message: `Created category ${name}`,
      categoryId: category.id,
    });
    return category;
  });
}

export async function archiveCategory(input: { userId: string; categoryId: string }) {
  const category = await prisma.category.findFirst({
    where: { id: input.categoryId, userId: input.userId },
    include: { pockets: true },
  });
  if (!category) throw new LedgerError("Category not found.");

  const live = category.pockets.filter(
    (p) => !p.isOverflow && ["active", "paused", "fully_funded", "draft"].includes(p.status),
  );
  if (live.length > 0) {
    throw new LedgerError("Archive or cancel the pockets in this category first.");
  }

  const overflow = category.pockets.find((p) => p.isOverflow);
  if (overflow && overflow.currentBalanceCents > 0) {
    throw new LedgerError(
      "Move the money out of this category's Overflow pocket before archiving it.",
    );
  }

  await prisma.$transaction(async (tx) => {
    if (overflow) {
      await tx.pocket.update({
        where: { id: overflow.id },
        data: { status: "archived", archivedAt: new Date() },
      });
    }
    await tx.category.update({ where: { id: category.id }, data: { status: "archived" } });
    await logActivity(tx, {
      userId: input.userId,
      type: "CATEGORY_ARCHIVED",
      message: `Archived category ${category.name}`,
      categoryId: category.id,
    });
  });
}

export async function updateCategory(input: {
  userId: string;
  categoryId: string;
  name?: string;
  description?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const category = await tx.category.findFirst({
      where: { id: input.categoryId, userId: input.userId },
    });
    if (!category) throw new LedgerError("Category not found.");

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = normalizeHumanName(input.name);
      if (!name) throw new LedgerError("Category name is required.");
      data.name = name;
    }
    if (input.description !== undefined) data.description = input.description?.trim() || null;

    const updated = await tx.category.update({ where: { id: category.id }, data });
    await logActivity(tx, {
      userId: input.userId,
      type: "CATEGORY_UPDATED",
      message: `Updated category ${updated.name}`,
      categoryId: category.id,
    });
    return updated;
  });
}

// ------------------------------ Pockets ------------------------------------

export interface CreatePocketInput {
  userId: string;
  categoryId: string;
  name: string;
  description?: string;
  pocketType?: PocketType;
  targetAmountCents?: number | null;
  status?: "draft" | "active";
  targetBuyDate?: Date | null;
  lockUntilDate?: Date | null;
}

const TYPES_REQUIRING_TARGET: PocketType[] = [
  "one_time_goal",
  "emergency_fund",
  "sinking_fund",
];

export async function createPocket(input: CreatePocketInput) {
  const name = normalizeHumanName(input.name);
  if (!name) throw new LedgerError("Pocket name is required.");

  const category = await prisma.category.findFirst({
    where: { id: input.categoryId, userId: input.userId },
  });
  if (!category) throw new LedgerError("Category not found.");
  if (category.status !== "active") {
    throw new LedgerError("You can't create a pocket inside an archived category.");
  }

  const pocketType = input.pocketType ?? "one_time_goal";
  if (!POCKET_TYPES.includes(pocketType)) throw new LedgerError("Invalid pocket type.");
  if (pocketType === "overflow" || pocketType === "free_to_spend") {
    throw new LedgerError("That pocket type is reserved.");
  }

  const target = input.targetAmountCents ?? null;
  if (TYPES_REQUIRING_TARGET.includes(pocketType)) {
    if (target == null || target <= 0) {
      throw new LedgerError("Set a goal amount greater than zero.");
    }
  }
  if (target != null && (!Number.isInteger(target) || target < 0)) {
    throw new LedgerError("Goal amount must be valid whole cents.");
  }

  const pocket = await prisma.pocket.create({
    data: {
      userId: input.userId,
      categoryId: input.categoryId,
      name,
      description: input.description?.trim() || null,
      pocketType,
      status: input.status ?? "active",
      targetAmountCents: target,
      targetBuyDate: input.targetBuyDate ?? null,
      lockUntilDate: input.lockUntilDate ?? null,
    },
  });
  await prisma.$transaction((tx) =>
    logActivity(tx, {
      userId: input.userId,
      type: "POCKET_CREATED",
      message: `Created pocket ${name}`,
      pocketId: pocket.id,
      categoryId: input.categoryId,
    }),
  );
  return pocket;
}

export interface UpdatePocketInput {
  userId: string;
  pocketId: string;
  name?: string;
  description?: string | null;
  targetAmountCents?: number | null;
  targetBuyDate?: Date | null;
  lockUntilDate?: Date | null;
}

export async function updatePocket(input: UpdatePocketInput) {
  return prisma.$transaction(async (tx) => {
    const pocket = await tx.pocket.findFirst({
      where: { id: input.pocketId, userId: input.userId },
    });
    if (!pocket) throw new LedgerError("Pocket not found.");
    if (pocket.isOverflow) throw new LedgerError("The Overflow pocket can't be edited.");

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = normalizeHumanName(input.name);
      if (!name) throw new LedgerError("Pocket name is required.");
      data.name = name;
    }
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.targetBuyDate !== undefined) data.targetBuyDate = input.targetBuyDate;
    if (input.lockUntilDate !== undefined) data.lockUntilDate = input.lockUntilDate;

    if (input.targetAmountCents !== undefined) {
      const target = input.targetAmountCents;
      if (target != null && (!Number.isInteger(target) || target < 0)) {
        throw new LedgerError("Goal amount must be valid whole cents.");
      }
      data.targetAmountCents = target;
      // Changing the target may flip fully_funded <-> active.
      if (pocket.status === "active" || pocket.status === "fully_funded") {
        data.status = isFullyFunded(pocket.currentBalanceCents, target ?? null)
          ? "fully_funded"
          : "active";
      }
    }

    const updated = await tx.pocket.update({ where: { id: pocket.id }, data });
    await logActivity(tx, {
      userId: input.userId,
      type: "POCKET_UPDATED",
      message: `Updated pocket ${updated.name}`,
      pocketId: pocket.id,
      categoryId: pocket.categoryId,
    });
    return updated;
  });
}

export async function setPocketStatus(input: {
  userId: string;
  pocketId: string;
  status: "active" | "paused" | "archived";
}) {
  return prisma.$transaction(async (tx) => {
    const pocket = await tx.pocket.findFirst({
      where: { id: input.pocketId, userId: input.userId },
    });
    if (!pocket) throw new LedgerError("Pocket not found.");
    if (pocket.isOverflow) throw new LedgerError("The Overflow pocket is managed automatically.");
    if (input.status === "archived" && pocket.currentBalanceCents > 0) {
      throw new LedgerError("Move this pocket's money out before archiving it.");
    }

    if (input.status === "active" && pocket.status === "paused") {
      // resume: recompute fully funded
      const status = isFullyFunded(pocket.currentBalanceCents, pocket.targetAmountCents)
        ? "fully_funded"
        : "active";
      await tx.pocket.update({ where: { id: pocket.id }, data: { status } });
    } else if (input.status === "paused" && ["active", "fully_funded"].includes(pocket.status)) {
      await tx.pocket.update({ where: { id: pocket.id }, data: { status: "paused" } });
    } else if (input.status === "archived") {
      await tx.pocket.update({
        where: { id: pocket.id },
        data: { status: "archived", archivedAt: new Date() },
      });
    } else {
      throw new LedgerError("Invalid status change.");
    }

    await logActivity(tx, {
      userId: input.userId,
      type: "POCKET_STATUS_CHANGED",
      message: `${pocket.name} -> ${input.status}`,
      pocketId: pocket.id,
      categoryId: pocket.categoryId,
    });
  });
}
