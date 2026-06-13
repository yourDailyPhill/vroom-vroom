import type { VinDecodeResult } from "../types";

export interface SearchQueryContext {
  symptoms: string;
  dtcs?: string[];
  vehicle?: VinDecodeResult;
}

export function buildSearchQuery(context: SearchQueryContext): string {
  const parts: string[] = [];

  if (context.vehicle?.valid) {
    if (context.vehicle.year) parts.push(context.vehicle.year);
    if (context.vehicle.make) parts.push(context.vehicle.make);
    if (context.vehicle.model) parts.push(context.vehicle.model);
  }

  if (context.dtcs?.length) {
    parts.push(...context.dtcs.slice(0, 2));
  }

  const symptomWords = context.symptoms
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 6)
    .join(" ");

  if (symptomWords) parts.push(symptomWords);
  parts.push("diagnostic steps");

  return parts.join(" ").replace(/\s+/g, " ").trim();
}
