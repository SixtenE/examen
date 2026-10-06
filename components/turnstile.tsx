"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const FAILED = "Couldn't verify this upload. Try again.";
const UNAVAILABLE = "Verification unavailable. Try again shortly.";
const WIDGET_TIMEOUT_MS = 15_000;
const CHALLENGE_TIMEOUT_MS = 30_000;

type TurnstileRenderOptions = {
  sitekey: string;
  action: string;
  theme: "auto";
  appearance: "interaction-only";
  execution: "execute";
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
};

type TurnstileApi = {
  ready: (callback: () => void) => void;
  render?: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type Waiter = {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
};

let generation = 0;
let widgetId: string | null = null;
let executing = false;
let started = false;
let scriptFailed = false;
let token: string | null = null;
let pending: Waiter | null = null;
let readyPromise: Promise<void> | null = null;
let markReady: (() => void) | null = null;
let rejectReady: ((error: Error) => void) | null = null;

function siteKey() {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
}

function fail(error: Error) {
  executing = false;
  token = null;
  const waiter = pending;
  pending = null;
  waiter?.reject(error);
}

function startChallenge() {
  const api = window.turnstile;
  if (!api || !widgetId || executing) return;
  executing = true;
  try {
    if (started) api.reset(widgetId);
    started = true;
    api.execute(widgetId);
  } catch {
    fail(new Error(FAILED));
  }
}

function settle(value: string) {
  if (!widgetId) return;
  executing = false;
  const waiter = pending;
  pending = null;
  if (waiter) {
    token = null;
    waiter.resolve(value);
    queueMicrotask(() => {
      if (widgetId) startChallenge();
    });
    return;
  }
  token = value;
}

function onExpired() {
  token = null;
  if (executing) return;
  startChallenge();
}

function widgetReady() {
  if (scriptFailed) return Promise.reject(new Error(FAILED));
  if (widgetId) return Promise.resolve();
  if (!readyPromise) {
    readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        readyPromise = null;
        markReady = null;
        rejectReady = null;
        reject(new Error(FAILED));
      }, WIDGET_TIMEOUT_MS);
      markReady = () => {
        clearTimeout(timer);
        rejectReady = null;
        resolve();
      };
      rejectReady = (error) => {
        clearTimeout(timer);
        readyPromise = null;
        markReady = null;
        rejectReady = null;
        reject(error);
      };
    });
  }
  return readyPromise;
}

function waitForToken() {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending) fail(new Error(FAILED));
    }, CHALLENGE_TIMEOUT_MS);
    pending = {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
    startChallenge();
  });
}

function renderWidget(container: HTMLElement, api: TurnstileApi, key: string) {
  if (!api.render) return;
  widgetId = api.render(container, {
    sitekey: key,
    action: "upload",
    theme: "auto",
    appearance: "interaction-only",
    execution: "execute",
    callback: settle,
    "error-callback": () => fail(new Error(FAILED)),
    "expired-callback": onExpired,
    "timeout-callback": () => fail(new Error(FAILED)),
  });
  markReady?.();
  startChallenge();
}

export function bindTurnstile(container: HTMLElement) {
  const key = siteKey();
  const api = window.turnstile;
  if (!key || !api || widgetId) return;
  // ready() warns and drops the callback once api.js has already loaded.
  if (typeof api.render === "function") {
    renderWidget(container, api, key);
    return;
  }
  const gen = generation;
  api.ready(() => {
    const loaded = window.turnstile;
    if (gen !== generation || !loaded || widgetId) return;
    renderWidget(container, loaded, key);
  });
}

export function unbindTurnstile() {
  generation += 1;
  const api = window.turnstile;
  const id = widgetId;
  widgetId = null;
  executing = false;
  started = false;
  scriptFailed = false;
  token = null;
  if (id && api) api.remove(id);
  rejectReady?.(new Error(FAILED));
  const waiter = pending;
  pending = null;
  waiter?.reject(new Error(FAILED));
}

export function noteTurnstileScriptError() {
  scriptFailed = true;
  rejectReady?.(new Error(FAILED));
}

function takeToken(): Promise<string> {
  if (token) {
    const current = token;
    token = null;
    startChallenge();
    return Promise.resolve(current);
  }
  return waitForToken();
}

export function getUploadToken(): Promise<string> {
  if (!siteKey()) {
    if (process.env.NODE_ENV === "production") {
      return Promise.reject(new Error(UNAVAILABLE));
    }
    return Promise.resolve("");
  }
  if (scriptFailed) return Promise.reject(new Error(FAILED));
  if (widgetId) return takeToken();

  return widgetReady().then(takeToken);
}

export function TurnstileWidget() {
  const ref = useRef<HTMLDivElement>(null);
  const key = siteKey();

  useEffect(() => {
    if (ref.current) bindTurnstile(ref.current);
    return () => unbindTurnstile();
  }, []);

  if (!key) return null;

  return (
    <>
      <Script
        src={SCRIPT_SRC}
        strategy="afterInteractive"
        onReady={() => {
          if (ref.current) bindTurnstile(ref.current);
        }}
        onError={() => noteTurnstileScriptError()}
      />
      <div
        ref={ref}
        className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2"
      />
    </>
  );
}
