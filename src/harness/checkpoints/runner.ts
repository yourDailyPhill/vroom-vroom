import type { DiagnosisOutput } from "../guardrails/schema";
import { diagnosisSchema } from "../guardrails/schema";
import { runInputGuardrails, runOutputGuardrails } from "../guardrails/registry";
import type { MaterialSnapshot } from "../material/store";
import type { DiagnosisInput } from "../types";
import type { CheckpointId, CheckpointResult, HumanEscalation } from "./definitions";

function isVagueSymptoms(symptoms: string): boolean {
  const words = symptoms.trim().split(/\s+/).filter(Boolean);
  return words.length < 4;
}

export function evaluateCheckpoint(
  checkpointId: CheckpointId,
  ctx: {
    input: DiagnosisInput;
    material?: MaterialSnapshot;
    draft?: DiagnosisOutput;
  },
): { result: CheckpointResult; escalation?: HumanEscalation } {
  const timestamp = new Date().toISOString();
  const failures: string[] = [];
  let escalation: HumanEscalation | undefined;

  switch (checkpointId) {
    case "input_valid": {
      const validation = runInputGuardrails(ctx.input);
      if (!validation.valid) failures.push(...validation.issues);
      break;
    }
    case "material_ready": {
      if (!ctx.material) {
        failures.push("Material snapshot missing after prefetch");
        break;
      }
      const { contextPack, input } = ctx.material;
      if (input.vin && contextPack.vehicle && !contextPack.vehicle.valid) {
        failures.push(`Invalid VIN: ${contextPack.vehicle.error ?? "unknown"}`);
      }
      const hasSymptomMatch = contextPack.symptoms.length > 0;
      const hasDtcMatch = contextPack.dtcs.some((d) => d.found);
      const hasVehicle = contextPack.vehicle?.valid === true;
      if (!hasSymptomMatch && !hasDtcMatch && !hasVehicle && isVagueSymptoms(input.symptoms)) {
        failures.push("Symptoms too vague and no matching knowledge base entries");
        escalation = {
          reason: "Insufficient context for reliable diagnosis",
          questions: [
            "Can you describe when the symptom occurs (cold start, highway, idle)?",
            "What is your vehicle mileage?",
            "Are there any other warning lights or noises?",
          ],
        };
      }
      break;
    }
    case "agent_produced_draft": {
      if (!ctx.draft) {
        failures.push("Agent did not produce a diagnosis draft");
      } else {
        const parsed = diagnosisSchema.safeParse(ctx.draft);
        if (!parsed.success) {
          failures.push(`Draft schema invalid: ${parsed.error.message}`);
        }
      }
      break;
    }
    case "output_safe": {
      if (!ctx.draft) {
        failures.push("No draft to validate");
      } else {
        const validation = runOutputGuardrails(ctx.draft);
        if (!validation.valid) failures.push(...validation.issues);
      }
      break;
    }
  }

  return {
    result: {
      checkpointId,
      passed: failures.length === 0,
      failures,
      timestamp,
    },
    escalation,
  };
}
