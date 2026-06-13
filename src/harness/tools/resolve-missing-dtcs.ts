import type { ToolLogger } from "../agents/interface";
import type { ProgressEvent, VinDecodeResult, WebSearchResponse } from "../types";
import { searchWeb } from "./web-search";

export function buildMissingDtcSearchQuery(
  codes: string[],
  vehicle?: VinDecodeResult,
): string {
  const parts: string[] = [...codes];

  if (vehicle?.valid) {
    if (vehicle.year) parts.push(vehicle.year);
    if (vehicle.make) parts.push(vehicle.make);
    if (vehicle.model) parts.push(vehicle.model);
  }

  parts.push("OBD-II code meaning diagnostic steps");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export async function resolveMissingDtcsViaWeb(params: {
  unfoundCodes: string[];
  vehicle?: VinDecodeResult;
  toolLogger: ToolLogger;
  emitProgress: (event: ProgressEvent) => void;
}): Promise<{ results: WebSearchResponse | null; searchesUsed: number }> {
  if (params.unfoundCodes.length === 0) {
    return { results: null, searchesUsed: 0 };
  }

  const query = buildMissingDtcSearchQuery(params.unfoundCodes, params.vehicle);
  const start = Date.now();
  const result = await searchWeb(query);

  params.toolLogger.search(query, result.results.length, result.offlineMode);
  params.toolLogger.tool(
    "searchWeb",
    result.error ??
      `Harness lookup for ${params.unfoundCodes.join(", ")}: ${result.results.length} results`,
    Date.now() - start,
  );

  if (result.offlineMode) {
    params.toolLogger.setOfflineMode(true);
    params.emitProgress({
      type: "offline",
      message:
        result.error ??
        "Live search unavailable — using offline knowledge only.",
    });
    return { results: null, searchesUsed: 0 };
  }

  return { results: result, searchesUsed: 1 };
}
