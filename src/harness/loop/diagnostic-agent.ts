import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  generateText,
  Output,
  stepCountIs,
  tool,
} from "ai";
import { z } from "zod";
import { renderDiagnosisMd } from "@/export/render-diagnosis-md";
import {
  buildSafeFallbackDiagnosis,
  buildServiceFailureDiagnosis,
  classifyServiceFailureReason,
  isServiceFailureError,
  validateDiagnosis,
  validateInput,
  type ServiceFailureReason,
} from "../guardrails/validator";
import { buildUserPrompt, REWRITE_PROMPT, SYSTEM_PROMPT } from "../guardrails/prompts";
import { diagnosisSchema, type DiagnosisOutput } from "../guardrails/schema";
import { DiagnosisLogger } from "../observability/logger";
import { getGeminiModelId } from "../config/model";
import { buildContextPack, formatVehicleLabel } from "../prefetch";
import { lookupDtc } from "../tools/dtc";
import { lookupSymptomFromText } from "../tools/symptom-index";
import { buildSearchQuery } from "../tools/query-builder";
import {
  isWebSearchOffline,
  resetWebSearchOffline,
  searchWeb,
} from "../tools/web-search";
import { lookupVin } from "../tools/vin";
import type {
  DiagnosisInput,
  DiagnosisOutcome,
  DiagnosisResult,
  ProgressEvent,
  WebSearchResponse,
} from "../types";

function getModel() {
  const apiKey =
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const google = createGoogleGenerativeAI({ apiKey });
  return google(getGeminiModelId());
}
const MAX_TOOL_STEPS = 6;
const MAX_WEB_SEARCHES = 2;
const TIMEOUT_MS = 60_000;

function serviceFailureStatus(reason: ServiceFailureReason): string {
  switch (reason) {
    case "spending_cap":
      return "Google AI monthly spending cap reached — adjust at ai.studio/spend.";
    case "quota":
      return "LLM quota unavailable — please try again later.";
    case "timeout":
      return "Diagnosis timed out — please try again.";
    case "rewrite":
      return "Diagnosis service unavailable during safety rewrite.";
    default:
      return "Diagnosis service unavailable — please try again later.";
  }
}

function finishDiagnosis(params: {
  diagnosis: DiagnosisOutput;
  outcome: DiagnosisOutcome;
  requestId: string;
  vehicleLabel?: string;
  logger: DiagnosisLogger;
  emitStatus: (message: string) => void;
  logOutcome?: DiagnosisOutcome;
}): DiagnosisResult {
  if (isWebSearchOffline()) {
    params.logger.setOfflineMode(true);
  }

  const trace = params.logger.buildTrace();
  params.logger.flush(params.logOutcome ?? params.outcome);
  params.emitStatus(
    params.outcome === "success" ? "Diagnosis complete." : "Diagnosis could not be completed.",
  );

  return {
    diagnosis: params.diagnosis,
    markdown: renderDiagnosisMd(params.diagnosis, {
      requestId: params.requestId,
      vehicle: params.vehicleLabel,
    }),
    trace,
    outcome: params.outcome,
  };
}

function finishWithServiceFailure(params: {
  reason: ServiceFailureReason;
  requestId: string;
  vehicleLabel?: string;
  logger: DiagnosisLogger;
  emitStatus: (message: string) => void;
}): DiagnosisResult {
  params.emitStatus(serviceFailureStatus(params.reason));
  return finishDiagnosis({
    diagnosis: buildServiceFailureDiagnosis(params.reason),
    outcome: "service_unavailable",
    requestId: params.requestId,
    vehicleLabel: params.vehicleLabel,
    logger: params.logger,
    emitStatus: params.emitStatus,
  });
}

export async function runDiagnosis(
  input: DiagnosisInput,
  onProgress?: (event: ProgressEvent) => void,
  requestId?: string,
): Promise<DiagnosisResult> {
  resetWebSearchOffline();

  const id =
    requestId ??
    `vv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const logger = new DiagnosisLogger(id, {
    onTrace: (entry) => onProgress?.({ type: "trace", entry }),
  });

  logger.setInput({
    symptoms: input.symptoms,
    vin: input.vin,
    dtcs: input.dtcs,
  });
  logger.setModelId(getGeminiModelId());

  const emitStatus = (message: string) => {
    logger.status(message);
    onProgress?.({ type: "status", message });
  };

  emitStatus("Validating input…");
  const inputValidation = validateInput(input);
  if (!inputValidation.valid) {
    for (const issue of inputValidation.issues) {
      logger.guardrail(issue);
    }
    const diagnosis = buildSafeFallbackDiagnosis(inputValidation.issues);
    emitStatus("Request blocked by safety guardrails.");
    return finishDiagnosis({
      diagnosis,
      outcome: "safety_blocked",
      requestId: id,
      logger,
      emitStatus,
    });
  }

  emitStatus("Pre-fetching vehicle data and knowledge base…");
  const contextPack = await buildContextPack(input);

  if (contextPack.vehicle) {
    logger.tool(
      "lookupVin",
      contextPack.vehicle.valid
        ? `Decoded ${formatVehicleLabel(contextPack) ?? contextPack.vehicle.vin}`
        : `Invalid VIN: ${contextPack.vehicle.error ?? "unknown"}`,
    );
  }

  for (const dtc of contextPack.dtcs) {
    logger.tool(
      "lookupDtc",
      dtc.found
        ? `${dtc.code}: ${dtc.description}`
        : `${dtc.code}: not in bundled KB`,
    );
  }

  if (contextPack.symptoms.length > 0) {
    logger.tool(
      "lookupSymptom",
      `Matched: ${contextPack.symptoms.map((s) => s.title).join(", ")}`,
    );
  }

  let webSearchCount = 0;
  const webSearchResults: WebSearchResponse[] = [];

  const searchContext = {
    symptoms: input.symptoms,
    dtcs: input.dtcs,
    vehicle: contextPack.vehicle,
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
        logger.tool("lookupVin", result.valid ? `${result.year} ${result.make} ${result.model}` : result.error ?? "failed", Date.now() - start);
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
        logger.tool("lookupDtc", result.found ? result.description ?? code : `${code} not found`, Date.now() - start);
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
        logger.tool("lookupSymptom", `${results.length} matches`, Date.now() - start);
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
        logger.search(query, result.results.length, result.offlineMode);
        logger.tool("searchWeb", result.error ?? `${result.results.length} results`, Date.now() - start);

        if (result.offlineMode) {
          logger.setOfflineMode(true);
          onProgress?.({
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
      ...contextPack,
      suggestedSearchQuery: buildSearchQuery(searchContext),
      webSearchOffline: isWebSearchOffline(),
    },
    null,
    2,
  );

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), TIMEOUT_MS);

  emitStatus("Running diagnostic agent…");

  let diagnosis: DiagnosisOutput | undefined;
  let loopIterations = 0;
  let toolInvestigationText = "";

  try {
    const toolPhase = await generateText({
      model: getModel(),
      system: SYSTEM_PROMPT,
      prompt: `${buildUserPrompt({
        symptoms: input.symptoms,
        mileage: input.mileage,
        contextJson,
      })}\n\nUse tools only to gather any missing information. Do not produce the final diagnosis yet — a follow-up step will synthesize structured output.`,
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      abortSignal: abortController.signal,
      onStepFinish: ({ stepNumber }) => {
        loopIterations = stepNumber;
        logger.iteration(stepNumber);
      },
    });

    toolInvestigationText = toolPhase.text;
    loopIterations = toolPhase.steps.length;
    logger.iteration(loopIterations);

    emitStatus("Synthesizing diagnosis…");

    const synthesis = await generateText({
      model: getModel(),
      system: SYSTEM_PROMPT,
      prompt: `Produce the final structured diagnosis JSON based on all available evidence.

Symptoms: ${input.symptoms}
${input.mileage ? `Mileage: ${input.mileage}` : ""}

Pre-fetched context:
${contextJson}

Tool investigation notes:
${toolInvestigationText || "(No additional tool notes — use pre-fetched context only.)"}

Only cite sources from tool/web search results in context. Return complete structured JSON.`,
      output: Output.object({ schema: diagnosisSchema }),
      abortSignal: abortController.signal,
    });

    diagnosis = synthesis.output;
    loopIterations += synthesis.steps.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent loop failed";
    logger.error(message);

    clearTimeout(timeout);

    const reason = classifyServiceFailureReason(message);
    return finishWithServiceFailure({
      reason,
      requestId: id,
      vehicleLabel: formatVehicleLabel(contextPack),
      logger,
      emitStatus,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!diagnosis) {
    logger.error("No structured output generated");
    return finishWithServiceFailure({
      reason: "agent",
      requestId: id,
      vehicleLabel: formatVehicleLabel(contextPack),
      logger,
      emitStatus,
    });
  }

  emitStatus("Validating safety guardrails…");
  let validation = validateDiagnosis(diagnosis);

  if (!validation.valid) {
    for (const issue of validation.issues) {
      logger.guardrail(issue);
    }

    emitStatus("Rewriting diagnosis for safety…");
    try {
      const rewrite = await generateText({
        model: getModel(),
        system: `${SYSTEM_PROMPT}\n\n${REWRITE_PROMPT}`,
        prompt: `Issues found:\n${validation.issues.join("\n")}\n\nOriginal diagnosis:\n${JSON.stringify(diagnosis, null, 2)}\n\nContext:\n${contextJson}`,
        output: Output.object({ schema: diagnosisSchema }),
        abortSignal: AbortSignal.timeout(30_000),
      });

      if (rewrite.output) {
        diagnosis = rewrite.output;
        validation = validateDiagnosis(diagnosis);
      }
    } catch (rewriteError) {
      const rewriteMessage =
        rewriteError instanceof Error ? rewriteError.message : "Safe rewrite failed";
      logger.error(rewriteMessage);

      if (isServiceFailureError(rewriteMessage)) {
        return finishWithServiceFailure({
          reason: "rewrite",
          requestId: id,
          vehicleLabel: formatVehicleLabel(contextPack),
          logger,
          emitStatus,
        });
      }

      logger.guardrail("Safe rewrite failed");
    }
  }

  if (!validation.valid) {
    for (const issue of validation.issues) {
      logger.guardrail(issue);
    }
    return finishDiagnosis({
      diagnosis: buildSafeFallbackDiagnosis(validation.issues),
      outcome: "safety_blocked",
      requestId: id,
      vehicleLabel: formatVehicleLabel(contextPack),
      logger,
      emitStatus,
    });
  }

  return finishDiagnosis({
    diagnosis,
    outcome: "success",
    requestId: id,
    vehicleLabel: formatVehicleLabel(contextPack),
    logger,
    emitStatus,
  });
}
