import { z } from "zod";

export const diagnosticStepSchema = z.object({
  step: z.number().int().positive(),
  action: z.string().min(1),
  toolsNeeded: z.array(z.string()),
  safetyNotes: z.array(z.string()).optional(),
});

export const sourceSchema = z.object({
  title: z.string(),
  url: z.string(),
});

export const diagnosisSchema = z.object({
  summary: z.string().min(1),
  mostLikelyCause: z.string().min(1),
  confidence: z.enum(["low", "medium", "high"]),
  diagnosticSteps: z.array(diagnosticStepSchema).min(1),
  whenToSeekPro: z.array(z.string()).min(1),
  sources: z.array(sourceSchema),
  disclaimer: z.string().min(1),
});

export type DiagnosisOutput = z.infer<typeof diagnosisSchema>;
export type DiagnosticStep = z.infer<typeof diagnosticStepSchema>;
