import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output, stepCountIs } from "ai";
import { getGeminiModelId } from "../config/model";
import {
  buildUserPrompt,
  REWRITE_PROMPT,
  SYSTEM_PROMPT,
} from "../guardrails/prompts";
import { diagnosisSchema } from "../guardrails/schema";
import {
  classifyServiceFailureReason,
  isServiceFailureError,
} from "../guardrails/validator";
import type {
  AgentExecutionContext,
  AgentExecutionResult,
  DiagnosticAgent,
} from "./interface";

const MAX_TOOL_STEPS = 6;
const TIMEOUT_MS = 60_000;

function getModel() {
  const apiKey =
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const google = createGoogleGenerativeAI({ apiKey });
  return google(getGeminiModelId());
}

export const toolCallingAgent: DiagnosticAgent = {
  id: "tool-calling",
  name: "Tool-Calling Diagnostic Agent",
  description:
    "Multi-phase agent: tool investigation loop, structured synthesis, rewrite on harness feedback",

  async execute(ctx: AgentExecutionContext): Promise<AgentExecutionResult> {
    const modelId = getGeminiModelId();
    const { input, material, feedback, tools, signal, toolLogger } = ctx;
    const contextJson = tools.contextJson;

    if (feedback?.kind === "rewrite") {
      try {
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
          investigationNotes: material.investigationNotes,
          iterations: rewrite.steps.length,
          modelId,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Safe rewrite failed";
        if (isServiceFailureError(message)) {
          throw new Error(classifyServiceFailureReason(message));
        }
        throw error;
      }
    }

    if (feedback?.kind === "human_answers") {
      const answersText = Object.entries(feedback.answers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      ctx.emitProgress({
        type: "status",
        message: "Incorporating human-provided context…",
      });

      const synthesis = await generateText({
        model: getModel(),
        system: SYSTEM_PROMPT,
        prompt: `Produce the final structured diagnosis JSON using pre-fetched context and human answers.

Symptoms: ${input.symptoms}
Human answers:
${answersText}

Pre-fetched context:
${contextJson}

Return complete structured JSON.`,
        output: Output.object({ schema: diagnosisSchema }),
        abortSignal: signal,
      });

      if (!synthesis.output) {
        throw new Error("No structured output generated");
      }

      return {
        draft: synthesis.output,
        iterations: synthesis.steps.length,
        modelId,
      };
    }

    let loopIterations = 0;
    let toolInvestigationText = "";

    const toolPhase = await generateText({
      model: getModel(),
      system: SYSTEM_PROMPT,
      prompt: `${buildUserPrompt({
        symptoms: input.symptoms,
        mileage: input.mileage,
        contextJson,
      })}\n\nUse tools only to gather any missing information. Do not produce the final diagnosis yet — a follow-up step will synthesize structured output.${
        feedback?.kind === "gather_more"
          ? `\n\nHarness feedback: ${feedback.reason}. Use additional tools before synthesis.`
          : ""
      }`,
      tools: tools.tools as Parameters<typeof generateText>[0]["tools"],
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      abortSignal: signal,
      onStepFinish: ({ stepNumber }) => {
        loopIterations = stepNumber;
        toolLogger.iteration(stepNumber);
      },
    });

    toolInvestigationText = toolPhase.text;
    loopIterations = toolPhase.steps.length;
    toolLogger.iteration(loopIterations);

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
      abortSignal: signal,
    });

    if (!synthesis.output) {
      throw new Error("No structured output generated");
    }

    return {
      draft: synthesis.output,
      investigationNotes: toolInvestigationText,
      iterations: loopIterations + synthesis.steps.length,
      modelId,
    };
  },
};

export { TIMEOUT_MS as TOOL_CALLING_TIMEOUT_MS };
