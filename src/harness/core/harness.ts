import { renderDiagnosisMd } from "@/export/render-diagnosis-md";
import type { DiagnosticAgent } from "../agents/interface";
import { AlarmEmitter } from "../alarms/emitter";
import { evaluateCheckpoint } from "../checkpoints/runner";
import { CheckpointStore } from "../checkpoints/store";
import {
  buildSafeFallbackDiagnosis,
  buildServiceFailureDiagnosis,
  classifyServiceFailureReason,
  isServiceFailureError,
  type ServiceFailureReason,
} from "../guardrails/validator";
import { formatVehicleLabel } from "../prefetch";
import { DiagnosisLogger } from "../observability/logger";
import { MaterialStore } from "../material/store";
import {
  isWebSearchOffline,
  resetWebSearchOffline,
} from "../tools/web-search";
import { buildHarnessTools } from "../tools/harness-tools";
import { TOOL_CALLING_TIMEOUT_MS } from "../agents/tool-calling-agent";
import type {
  DiagnosisInput,
  DiagnosisOutcome,
  DiagnosisResult,
  ProgressEvent,
} from "../types";
import type { DiagnosisOutput } from "../guardrails/schema";

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
  escalation?: DiagnosisResult["escalation"];
}): DiagnosisResult {
  if (isWebSearchOffline()) {
    params.logger.setOfflineMode(true);
  }

  const trace = params.logger.buildTrace();
  params.logger.flush(params.outcome);
  params.emitStatus(
    params.outcome === "success"
      ? "Diagnosis complete."
      : params.outcome === "awaiting_human"
        ? "Additional information needed."
        : "Diagnosis could not be completed.",
  );

  return {
    diagnosis: params.diagnosis,
    markdown: renderDiagnosisMd(params.diagnosis, {
      requestId: params.requestId,
      vehicle: params.vehicleLabel,
    }),
    trace,
    outcome: params.outcome,
    escalation: params.escalation,
  };
}

export interface HarnessRunOptions {
  skipStages?: string[];
  humanAnswers?: Record<string, string>;
  replayRequestId?: string;
  replayFromCheckpoint?: "material_ready";
}

export async function runHarness(
  input: DiagnosisInput,
  agent: DiagnosticAgent,
  onProgress?: (event: ProgressEvent) => void,
  requestId?: string,
  options?: HarnessRunOptions,
): Promise<DiagnosisResult> {
  resetWebSearchOffline();

  const id =
    requestId ??
    `vv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const skipStages = new Set(options?.skipStages ?? []);
  const completedStages: string[] = [];

  const logger = new DiagnosisLogger(id, {
    onTrace: (entry) => onProgress?.({ type: "trace", entry }),
  });

  logger.setAgent(agent.id, agent.name);
  logger.setInput({
    symptoms: input.symptoms,
    vin: input.vin,
    dtcs: input.dtcs,
  });

  const alarms = new AlarmEmitter({
    onAlarm: (alarm) => {
      logger.alarm(alarm);
      onProgress?.({ type: "alarm", alarm });
    },
  });

  const checkpointStore = new CheckpointStore(id, input, agent.id);

  const emitStatus = (message: string) => {
    logger.status(message);
    onProgress?.({ type: "status", message });
  };

  const recordCheckpoint = (
    checkpointId: Parameters<typeof evaluateCheckpoint>[0],
    materialStore: MaterialStore,
    draft?: DiagnosisOutput,
  ) => {
    const { result, escalation } = evaluateCheckpoint(checkpointId, {
      input,
      material: materialStore.snapshot(),
      draft,
    });
    logger.checkpoint(result);
    onProgress?.({ type: "checkpoint", result });
    checkpointStore.save({
      checkpointId,
      result,
      materialSnapshot: materialStore.snapshot(),
      draft,
      completedStages: [...completedStages],
    });
    return { result, escalation };
  };

  // --- Stage: input validation ---
  if (!skipStages.has("input_valid")) {
    emitStatus("Validating input…");
    const { result: inputCheckpoint } = recordCheckpoint(
      "input_valid",
      new MaterialStore(input),
    );
    completedStages.push("input_received");

    if (!inputCheckpoint.passed) {
      for (const issue of inputCheckpoint.failures) {
        logger.guardrail(issue);
        alarms.emit({
          type: "guardrail_violation",
          severity: "critical",
          context: { checkpoint: "input_valid", issue },
          recommendedAction: "Revise your symptoms to stay within DIY ICE scope",
        });
      }
      emitStatus("Request blocked by safety guardrails.");
      return finishDiagnosis({
        diagnosis: buildSafeFallbackDiagnosis(inputCheckpoint.failures),
        outcome: "safety_blocked",
        requestId: id,
        logger,
        emitStatus,
      });
    }
  }

  // --- Stage: material prefetch ---
  let materialStore: MaterialStore;
  let vehicleLabel: string | undefined;

  if (options?.replayRequestId && options.replayFromCheckpoint) {
    const replay = CheckpointStore.replayFrom(
      options.replayRequestId,
      options.replayFromCheckpoint,
    );
    if (!replay) {
      throw new Error(`No checkpoint "${options.replayFromCheckpoint}" for replay`);
    }
    materialStore = new MaterialStore(input);
    materialStore.restore(replay.materialSnapshot);
    vehicleLabel = formatVehicleLabel(replay.materialSnapshot.contextPack);
    completedStages.push("prefetch");
  } else if (!skipStages.has("material_ready")) {
    emitStatus("Pre-fetching vehicle data and knowledge base…");
    materialStore = new MaterialStore(input);
    const contextPack = await materialStore.prefetch();
    vehicleLabel = formatVehicleLabel(contextPack);

    if (contextPack.vehicle) {
      logger.tool(
        "lookupVin",
        contextPack.vehicle.valid
          ? `Decoded ${vehicleLabel ?? contextPack.vehicle.vin}`
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

    completedStages.push("prefetch");

    const { result: materialCheckpoint, escalation } = recordCheckpoint(
      "material_ready",
      materialStore,
    );

    if (!materialCheckpoint.passed) {
      for (const failure of materialCheckpoint.failures) {
        alarms.emit({
          type: "material_incomplete",
          severity: "warning",
          context: { failure },
          recommendedAction: "Provide more detail or answer follow-up questions",
        });
      }

      if (escalation && !options?.humanAnswers) {
        alarms.emit({
          type: "human_escalation",
          severity: "warning",
          context: { reason: escalation.reason },
          recommendedAction: escalation.questions.join(" "),
        });
        onProgress?.({ type: "escalation", escalation, requestId: id });
        return finishDiagnosis({
          diagnosis: buildSafeFallbackDiagnosis([
            "Additional context needed before diagnosis can proceed safely.",
          ]),
          outcome: "awaiting_human",
          requestId: id,
          logger,
          emitStatus,
          escalation,
        });
      }
    }
  } else {
    materialStore = new MaterialStore(input);
    await materialStore.prefetch();
    vehicleLabel = formatVehicleLabel(materialStore.getContextPack());
  }

  // --- Stage: agent execution ---
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), TOOL_CALLING_TIMEOUT_MS);

  emitStatus(`Running ${agent.name}…`);

  const harnessTools = buildHarnessTools({
    input,
    material: materialStore.snapshot(),
    toolLogger: logger,
    emitProgress: (event) => onProgress?.(event),
  });

  let agentResult;
  try {
    agentResult = await agent.execute({
      input,
      material: materialStore.snapshot(),
      feedback: options?.humanAnswers
        ? { kind: "human_answers", answers: options.humanAnswers }
        : undefined,
      tools: harnessTools,
      signal: abortController.signal,
      emitProgress: (event) => onProgress?.(event),
      toolLogger: logger,
    });
  } catch (error) {
    clearTimeout(timeout);
    const message = error instanceof Error ? error.message : "Agent loop failed";
    logger.error(message);
    const reason = classifyServiceFailureReason(message);
    alarms.emit({
      type: "service_error",
      severity: "critical",
      context: { reason, message },
      recommendedAction: serviceFailureStatus(reason),
    });
    emitStatus(serviceFailureStatus(reason));
    return finishDiagnosis({
      diagnosis: buildServiceFailureDiagnosis(reason),
      outcome: "service_unavailable",
      requestId: id,
      vehicleLabel,
      logger,
      emitStatus,
    });
  } finally {
    clearTimeout(timeout);
  }

  logger.setModelId(agentResult.modelId);
  logger.iteration(agentResult.iterations);
  if (agentResult.investigationNotes) {
    materialStore.setNotes(agentResult.investigationNotes);
  }
  materialStore.setDraft(agentResult.draft);
  completedStages.push("agent_execute");

  const { result: draftCheckpoint } = recordCheckpoint(
    "agent_produced_draft",
    materialStore,
    agentResult.draft,
  );

  if (!draftCheckpoint.passed) {
    for (const failure of draftCheckpoint.failures) {
      logger.error(failure);
      alarms.emit({
        type: "checkpoint_failed",
        severity: "critical",
        context: { checkpoint: "agent_produced_draft", failure },
        recommendedAction: "Retry diagnosis or swap to a different agent",
      });
    }
    emitStatus("Agent did not produce a valid diagnosis.");
    return finishDiagnosis({
      diagnosis: buildServiceFailureDiagnosis("agent"),
      outcome: "service_unavailable",
      requestId: id,
      vehicleLabel,
      logger,
      emitStatus,
    });
  }

  // --- Stage: output guardrails ---
  emitStatus("Validating safety guardrails…");
  let draft = agentResult.draft;
  let { result: outputCheckpoint } = recordCheckpoint(
    "output_safe",
    materialStore,
    draft,
  );
  completedStages.push("guardrails");

  if (!outputCheckpoint.passed) {
    for (const issue of outputCheckpoint.failures) {
      logger.guardrail(issue);
      alarms.emit({
        type: "guardrail_violation",
        severity: "warning",
        context: { issue },
        recommendedAction: "Agent will rewrite diagnosis with harness feedback",
      });
    }

    emitStatus("Rewriting diagnosis for safety…");
    try {
      const rewriteResult = await agent.execute({
        input,
        material: materialStore.snapshot(),
        feedback: {
          kind: "rewrite",
          issues: outputCheckpoint.failures,
          previousDraft: draft,
        },
        tools: harnessTools,
        signal: AbortSignal.timeout(30_000),
        emitProgress: (event) => onProgress?.(event),
        toolLogger: logger,
      });

      draft = rewriteResult.draft;
      materialStore.setDraft(draft);
      logger.iteration(agentResult.iterations + rewriteResult.iterations);

      ({ result: outputCheckpoint } = recordCheckpoint(
        "output_safe",
        materialStore,
        draft,
      ));
    } catch (rewriteError) {
      const rewriteMessage =
        rewriteError instanceof Error ? rewriteError.message : "Safe rewrite failed";
      logger.error(rewriteMessage);

      if (isServiceFailureError(rewriteMessage)) {
        const reason = classifyServiceFailureReason(rewriteMessage);
        alarms.emit({
          type: "service_error",
          severity: "critical",
          context: { reason, phase: "rewrite" },
          recommendedAction: serviceFailureStatus(reason),
        });
        emitStatus(serviceFailureStatus(reason));
        return finishDiagnosis({
          diagnosis: buildServiceFailureDiagnosis(reason),
          outcome: "service_unavailable",
          requestId: id,
          vehicleLabel,
          logger,
          emitStatus,
        });
      }
    }
  }

  if (!outputCheckpoint.passed) {
    for (const issue of outputCheckpoint.failures) {
      logger.guardrail(issue);
    }

    if (
      draft.confidence === "low" &&
      draft.sources.length === 0 &&
      !options?.humanAnswers
    ) {
      const escalation = {
        reason: "Low confidence diagnosis with no cited sources",
        questions: [
          "Can you provide your vehicle mileage?",
          "When did the symptom first appear?",
          "Does the issue happen under specific conditions (cold, hot, accelerating)?",
        ],
      };
      alarms.emit({
        type: "human_escalation",
        severity: "warning",
        context: { reason: escalation.reason },
        recommendedAction: "Answer follow-up questions for a more reliable diagnosis",
      });
      onProgress?.({ type: "escalation", escalation, requestId: id });
      return finishDiagnosis({
        diagnosis: buildSafeFallbackDiagnosis(outputCheckpoint.failures),
        outcome: "awaiting_human",
        requestId: id,
        vehicleLabel,
        logger,
        emitStatus,
        escalation,
      });
    }

    return finishDiagnosis({
      diagnosis: buildSafeFallbackDiagnosis(outputCheckpoint.failures),
      outcome: "safety_blocked",
      requestId: id,
      vehicleLabel,
      logger,
      emitStatus,
    });
  }

  return finishDiagnosis({
    diagnosis: draft,
    outcome: "success",
    requestId: id,
    vehicleLabel,
    logger,
    emitStatus,
  });
}
