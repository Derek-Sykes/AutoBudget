import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  cookies: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

function emptyCookieStore() {
  return {
    get: vi.fn(() => undefined),
    set: mocks.cookieSet,
  };
}

describe("auth guards", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue(emptyCookieStore());
  });

  it("protected page guards redirect unauthenticated users to login", async () => {
    const { requireCurrentUserId } = await import("@/server/auth");

    await expect(requireCurrentUserId()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });

  it("server actions fail before mutating data when no session is present", async () => {
    const { createCategoryAction } = await import("@/app/actions");
    const fd = new FormData();
    fd.set("name", "Private");

    await expect(createCategoryAction({ ok: false }, fd)).resolves.toEqual({
      ok: false,
      error: "Please log in again.",
    });
  });
});
