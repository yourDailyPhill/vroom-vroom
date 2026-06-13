import { tool } from "ai";
import { z } from "zod";
import type { ToolLogger } from "../agents/interface";
import { lookupDtc } from "./dtc";
import { buildSearchQuery } from "./query-builder";
import { lookupSymptomFromText } from "./symptom-index";
import {
  isWebSearchOffline,
  searchWeb,
} from "./web-search";
import { lookupVin } from "./vin";
import type { DiagnosisInput, ProgressEvent, WebSearchResponse } from "../types";
import type { MaterialSnapshot } from "../material/store";

const MAX_WEB_SEARCHES = 2;

export function buildHarnessTools(params: {
  input: DiagnosisInput;
  material: MaterialSnapshot;
  toolLogger: ToolLogger;
  emitProgress: (event: ProgressEvent) => void;
}): { tools: Record<string, unknown>; contextJson: string; webSearchCount: () => number } {
  let webSearchCount = 0;
  const webSearchResults: WebSearchResponse[] = [];

  const searchContext = {
    symptoms: params.input.symptoms,
    dtcs: params.input.dtcs,
    vehicle: params.material.contextPack.vehicle,
  };

  const tools = {
    lookupVin: tool({
      description: "Decode a 17-character VIN via NHTSA to get year, make, model, engine.",
      inputSchema: z.object({
        vin: z.string().describe("17-character VIN"),
      }),
      execute: async ({ vin }) => {
        const start = Date.now();
        const result = await lookupVin(vin);
        params.toolLogger.tool(
          "lookupVin",
          result.valid ? `${result.year} ${result.make} ${result.model}` : result.error ?? "failed",
          Date.now() - start,
        );
        return result;
      },
    }),
    lookupDtc: tool({
      description: "Look up an OBD-II trouble code in the bundled knowledge base.",
      inputSchema: z.object({
        code: z.string().describe("DTC code like P0301"),
      }),
      execute: async ({ code }) => {
        const start = Date.now();
        const result = lookupDtc(code);
        params.toolLogger.tool(
          "lookupDtc",
          result.found ? result.description ?? code : `${code} not found`,
          Date.now() - start,
        );
        return result;
      },
    }),
    lookupSymptom: tool({
      description: "Search bundled symptom fault trees by keywords.",
      inputSchema: z.object({
        keywords: z.string().describe("Symptom keywords"),
      }),
      execute: async ({ keywords }) => {
        const start = Date.now();
        const results = lookupSymptomFromText(keywords);
        params.toolLogger.tool("lookupSymptom", `${results.length} matches`, Date.now() - start);
        return results;
      },
    }),
    searchWeb: tool({
      description:
        "Search trusted automotive domains for diagnostic info. Max 2 calls per diagnosis. Use only when bundled KB is insufficient.",
      inputSchema: z.object({
        query: z.string().describe("Automotive diagnostic search query"),
      }),
      execute: async ({ query }) => {
        if (webSearchCount >= MAX_WEB_SEARCHES) {
          return {
            query,
            results: [],
            offlineMode: true,
            error: "Web search limit reached for this diagnosis (max 2).",
          };
        }
        webSearchCount += 1;
        const start = Date.now();
        const result = await searchWeb(query);
        webSearchResults.push(result);
        params.toolLogger.search(query, result.results.length, result.offlineMode);
        params.toolLogger.tool(
          "searchWeb",
          result.error ?? `${result.results.length} results`,
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
        }

        return result;
      },
    }),
  };

  const contextJson = JSON.stringify(
    {
      ...params.material.contextPack,
      suggestedSearchQuery: buildSearchQuery(searchContext),
      webSearchOffline: isWebSearchOffline(),
      humanAnswers: params.material.input.mileage
        ? { mileage: params.material.input.mileage }
        : undefined,
    },
    null,
    2,
  );

  return {
    tools,
    contextJson,
    webSearchCount: () => webSearchCount,
  };
}
