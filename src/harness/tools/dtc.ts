import dtcCodes from "@/knowledge/dtc-codes.json";
import type { DtcLookupResult } from "../types";

const dtcMap = dtcCodes as Record<
  string,
  {
    code: string;
    description: string;
    typicalCauses: string[];
    diyChecks: string[];
    safetyNotes: string[];
  }
>;

export function normalizeDtcCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function parseDtcList(input: string): string[] {
  return input
    .split(/[,;\s]+/)
    .map(normalizeDtcCode)
    .filter((code) => /^P[0-9A-F]{4}$/.test(code));
}

export function lookupDtc(code: string): DtcLookupResult {
  const normalized = normalizeDtcCode(code);
  const entry = dtcMap[normalized];

  if (!entry) {
    return { code: normalized, found: false };
  }

  return {
    code: normalized,
    found: true,
    description: entry.description,
    typicalCauses: entry.typicalCauses,
    diyChecks: entry.diyChecks,
    safetyNotes: entry.safetyNotes,
  };
}

export function lookupDtcs(codes: string[]): DtcLookupResult[] {
  return codes.map(lookupDtc);
}
