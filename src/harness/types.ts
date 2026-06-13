import type { DiagnosisOutput } from "./guardrails/schema";

export interface DiagnosisInput {
  symptoms: string;
  vin?: string;
  dtcs?: string[];
  mileage?: string;
}

export interface VinDecodeResult {
  vin: string;
  valid: boolean;
  year?: string;
  make?: string;
  model?: string;
  trim?: string;
  engine?: string;
  error?: string;
}

export interface DtcLookupResult {
  code: string;
  found: boolean;
  description?: string;
  typicalCauses?: string[];
  diyChecks?: string[];
  safetyNotes?: string[];
}

export interface SymptomMatch {
  title: string;
  checks: string[];
  commonCauses: string[];
  safetyNotes: string[];
  matchedKeywords: string[];
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  offlineMode: boolean;
  error?: string;
}

export interface ContextPack {
  vehicle?: VinDecodeResult;
  dtcs: DtcLookupResult[];
  symptoms: SymptomMatch[];
  prefetchedAt: string;
}

export interface TraceEntry {
  timestamp: string;
  type: "tool" | "search" | "guardrail" | "status" | "error";
  name: string;
  detail: string;
  durationMs?: number;
}

export interface DiagnosisTrace {
  requestId: string;
  entries: TraceEntry[];
  toolCallCount: number;
  webSearchCount: number;
  guardrailHits: string[];
  loopIterations: number;
  latencyMs: number;
  modelId: string;
  offlineMode: boolean;
}

export type DiagnosisOutcome =
  | "success"
  | "safety_blocked"
  | "service_unavailable";

export interface DiagnosisResult {
  diagnosis: DiagnosisOutput;
  markdown: string;
  trace: DiagnosisTrace;
  outcome: DiagnosisOutcome;
}

export type ProgressEvent =
  | { type: "status"; message: string }
  | { type: "trace"; entry: TraceEntry }
  | { type: "offline"; message: string };
