import type { Transition, Variants } from "motion/react";

// Strong custom easing curves. The built-in CSS/JS easings are too weak and
// lack the punch that makes UI motion feel intentional.
export const easeOut = [0.23, 1, 0.32, 1] as const;
export const easeInOut = [0.77, 0, 0.175, 1] as const;

// A single entering element (modal-free): start fast, settle smoothly.
export const enter: Transition = {
  duration: 0.25,
  ease: easeOut,
};

// Container that staggers its children as they enter a list.
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      // Short delay between items keeps the cascade from feeling slow.
      staggerChildren: 0.05,
    },
  },
};

// List item entrance. Never animate from scale(0) — nothing in the real world
// appears from nothing, so we start barely deflated with a small upward drift.
export const listItem: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.25, ease: easeOut },
  },
};
