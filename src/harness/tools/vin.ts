import type { VinDecodeResult } from "../types";

const NHTSA_BASE =
  "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";

export function normalizeVin(vin: string): string {
  return vin.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
}

export function isValidVinFormat(vin: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizeVin(vin));
}

export async function lookupVin(vin: string): Promise<VinDecodeResult> {
  const normalized = normalizeVin(vin);

  if (!isValidVinFormat(normalized)) {
    return {
      vin: normalized,
      valid: false,
      error: "VIN must be exactly 17 characters (letters and numbers, no I/O/Q).",
    };
  }

  try {
    const url = `${NHTSA_BASE}/${encodeURIComponent(normalized)}?format=json`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      return {
        vin: normalized,
        valid: false,
        error: `NHTSA API returned ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      Results?: Array<Record<string, string>>;
    };

    const result = data.Results?.[0];
    if (!result) {
      return {
        vin: normalized,
        valid: false,
        error: "No decode results returned from NHTSA.",
      };
    }

    const errorCode = result.ErrorCode ?? "";
    const errorText = result.ErrorText ?? "";

    if (errorCode !== "0" && !result.Make) {
      return {
        vin: normalized,
        valid: false,
        error: errorText || "VIN could not be decoded.",
      };
    }

    return {
      vin: normalized,
      valid: true,
      year: result.ModelYear || undefined,
      make: result.Make || undefined,
      model: result.Model || undefined,
      trim: result.Trim || undefined,
      engine:
        [result.DisplacementL && `${result.DisplacementL}L`, result.EngineConfiguration, result.FuelTypePrimary]
          .filter(Boolean)
          .join(" ") || undefined,
    };
  } catch (error) {
    return {
      vin: normalized,
      valid: false,
      error: error instanceof Error ? error.message : "VIN lookup failed",
    };
  }
}
