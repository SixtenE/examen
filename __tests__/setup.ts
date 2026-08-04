import { vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: Object.assign(vi.fn(), {
    protect: vi.fn().mockResolvedValue({ userId: "user_test" }),
  }),
}));
