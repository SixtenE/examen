import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  bindTurnstile,
  getUploadToken,
  noteTurnstileScriptError,
  unbindTurnstile,
} from "@/components/turnstile";

type Options = {
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  appearance: string;
  execution: string;
  action: string;
  sitekey: string;
};

function installTurnstile() {
  let options: Options | null = null;
  const api = {
    ready: (callback: () => void) => callback(),
    render: vi.fn((_container: HTMLElement, next: Options) => {
      options = next;
      return "widget-1";
    }),
    execute: vi.fn(),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  window.turnstile = api;
  return {
    api,
    options: () => options,
    succeed: (token: string) => options?.callback(token),
    fail: () => options?.["error-callback"](),
    expire: () => options?.["expired-callback"](),
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  unbindTurnstile();
  delete window.turnstile;
  vi.unstubAllEnvs();
});

it("renders an interaction-only challenge and runs it before the visitor uploads", () => {
  const turnstile = installTurnstile();

  bindTurnstile(document.createElement("div"));

  expect(turnstile.api.render).toHaveBeenCalledWith(
    expect.any(HTMLElement),
    expect.objectContaining({
      sitekey: "site-key",
      action: "upload",
      appearance: "interaction-only",
      execution: "execute",
    }),
  );
  expect(turnstile.api.execute).toHaveBeenCalledTimes(1);
});

it("returns a fresh token per upload", async () => {
  const turnstile = installTurnstile();
  bindTurnstile(document.createElement("div"));
  turnstile.succeed("token-1");

  await expect(getUploadToken()).resolves.toBe("token-1");
  expect(turnstile.api.reset).toHaveBeenCalledTimes(1);

  turnstile.succeed("token-2");
  await expect(getUploadToken()).resolves.toBe("token-2");
});

it("waits for the challenge already in flight", async () => {
  const turnstile = installTurnstile();
  bindTurnstile(document.createElement("div"));

  const pending = getUploadToken();
  expect(turnstile.api.execute).toHaveBeenCalledTimes(1);
  turnstile.succeed("token-1");

  await expect(pending).resolves.toBe("token-1");
});

it("refreshes an expired token instead of reusing it", async () => {
  const turnstile = installTurnstile();
  bindTurnstile(document.createElement("div"));
  turnstile.succeed("token-1");
  turnstile.expire();

  expect(turnstile.api.execute).toHaveBeenCalledTimes(2);
  turnstile.succeed("token-2");
  await expect(getUploadToken()).resolves.toBe("token-2");
});

it("rejects when the challenge fails", async () => {
  const turnstile = installTurnstile();
  bindTurnstile(document.createElement("div"));

  const pending = getUploadToken();
  turnstile.fail();

  await expect(pending).rejects.toThrow(
    "Couldn't verify this upload. Try again.",
  );
});

it("skips the widget when the site key is unset outside production", async () => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");

  await expect(getUploadToken()).resolves.toBe("");
});

it("fails closed in production when the site key is unset", async () => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
  vi.stubEnv("NODE_ENV", "production");

  await expect(getUploadToken()).rejects.toThrow(
    "Verification unavailable. Try again shortly.",
  );
});

it("fails fast when the script cannot load", async () => {
  noteTurnstileScriptError();

  await expect(getUploadToken()).rejects.toThrow(
    "Couldn't verify this upload. Try again.",
  );
});
