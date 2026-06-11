import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { z } from "zod";

export function isUuid(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function relativeTimeUntilNow(target: Date | string): string {
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const targetDate = target instanceof Date ? target : new Date(target);
  const diffMs = targetDate.getTime() - new Date().getTime();
  const diffSec = Math.round(diffMs / 1000);

  const abs = Math.abs(diffSec);

  if (abs < 60) return diffSec < 0 ? "<1 minute ago" : "<1 minute from now";
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 604800) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 2629800) return rtf.format(Math.round(diffSec / 604800), "week");
  if (abs < 31557600) return rtf.format(Math.round(diffSec / 2629800), "month");
  return rtf.format(Math.round(diffSec / 31557600), "year");
}
