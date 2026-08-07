import posthog from "posthog-js";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

if (projectToken) {
  posthog.init(projectToken, {
    api_host: "/e7n",
    ui_host: host.replace(".i.posthog.com", ".posthog.com"),
    defaults: "2026-06-25",
    capture_exceptions: true,
    capture_pageview: "history_change",
    capture_pageleave: true,
    capture_performance: {
      network_timing: true,
      web_vitals: true,
    },
    tracing_headers: [window.location.hostname],
    session_recording: {
      maskAllInputs: true,
      recordBody: false,
      recordHeaders: false,
    },
  });
}
