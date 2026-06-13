import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { getGeminiModelId } from "../config/model";
import {
  buildUserPrompt,
  REWRITE_PROMPT,
  SYSTEM_PROMPT,
} from "../guardrails/prompts";
import { diagnosisSchema } from "../guardrails/schema";
import type {
  AgentExecutionContext,
  AgentExecutionResult,
  DiagnosticAgent,
} from "./interface";

function getModel() {
  const apiKey =
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const google = createGoogleGenerativeAI({ apiKey });
  return google(getGeminiModelId());
}

export const singlePassAgent: DiagnosticAgent = {
  id: "single-pass",
  name: "Single-Pass Diagnostic Agent",
  description:
    "One-shot structured diagnosis from pre-fetched material only — no tool loop",

  async execute(ctx: AgentExecutionContext): Promise<AgentExecutionResult> {
    const modelId = getGeminiModelId();
    const { input, feedback, tools, signal } = ctx;
    const contextJson = tools.contextJson;

    if (feedback?.kind === "rewrite") {
      const rewrite = await generateText({
        model: getModel(),
        system: `${SYSTEM_PROMPT}\n\n${REWRITE_PROMPT}`,
        prompt: `Issues found:\n${feedback.issues.join("\n")}\n\nOriginal diagnosis:\n${JSON.stringify(feedback.previousDraft, null, 2)}\n\nContext:\n${contextJson}`,
        output: Output.object({ schema: diagnosisSchema }),
        abortSignal: AbortSignal.timeout(30_000),
      });

      if (!rewrite.output) {
        throw new Error("Rewrite produced no structured output");
      }

      return {
        draft: rewrite.output,
        iterations: rewrite.steps.length,
        modelId,
      };
    }

    let prompt = buildUserPrompt({
      symptoms: input.symptoms,
      mileage: input.mileage,
      contextJson,
    });

    if (feedback?.kind === "human_answers") {
      const answersText = Object.entries(feedback.answers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      prompt += `\n\nHuman-provided answers:\n${answersText}`;
    }

    prompt +=
      "\n\nSynthesize a practical DIY diagnosis from the pre-fetched context only. Do not invent sources.";

    const result = await generateText({
      model: getModel(),
      system: SYSTEM_PROMPT,
      prompt,
      output: Output.object({ schema: diagnosisSchema }),
      abortSignal: signal,
    });

    if (!result.output) {
      throw new Error("No structured output generated");
    }

    return {
      draft: result.output,
      investigationNotes: "(Single-pass — no tool investigation)",
      iterations: result.steps.length,
      modelId,
    };
  },
};
