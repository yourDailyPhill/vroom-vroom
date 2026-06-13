import { lookupDtcs, parseDtcList } from "./tools/dtc";
import { lookupSymptomFromText } from "./tools/symptom-index";
import { lookupVin } from "./tools/vin";
import type { ContextPack, DiagnosisInput } from "./types";

export async function buildContextPack(input: DiagnosisInput): Promise<ContextPack> {
  const dtcs = input.dtcs?.length
    ? lookupDtcs(input.dtcs)
    : parseDtcList(input.symptoms).length > 0
      ? lookupDtcs(parseDtcList(input.symptoms))
      : [];

  const vehicle = input.vin ? await lookupVin(input.vin) : undefined;
  const symptoms = lookupSymptomFromText(input.symptoms);

  return {
    vehicle,
    dtcs,
    symptoms,
    prefetchedAt: new Date().toISOString(),
  };
}

export function formatVehicleLabel(pack: ContextPack): string | undefined {
  const v = pack.vehicle;
  if (!v?.valid) return undefined;
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
}
