import type { DiagnosisOutput } from "../guardrails/schema";
import type { ToolLogger } from "../agents/interface";
import { buildContextPack } from "../prefetch";
import { buildSearchQuery } from "../tools/query-builder";
import { resolveMissingDtcsViaWeb } from "../tools/resolve-missing-dtcs";
import type {
  ContextPack,
  DiagnosisInput,
  ProgressEvent,
  VinDecodeResult,
  WebSearchResponse,
} from "../types";

export interface MaterialSnapshot {
  input: DiagnosisInput;
  contextPack: ContextPack;
  investigationNotes?: string;
  draft?: DiagnosisOutput;
  suggestedSearchQuery?: string;
  missingDtcWebResults?: WebSearchResponse;
  harnessWebSearchesUsed?: number;
}

export class MaterialStore {
  private input: DiagnosisInput;
  private contextPack?: ContextPack;
  private investigationNotes?: string;
  private draft?: DiagnosisOutput;
  private suggestedSearchQuery?: string;
  private missingDtcWebResults?: WebSearchResponse;
  private harnessWebSearchesUsed = 0;

  constructor(input: DiagnosisInput) {
    this.input = input;
  }

  async prefetch(): Promise<ContextPack> {
    this.contextPack = await buildContextPack(this.input);
    this.suggestedSearchQuery = buildSearchQuery({
      symptoms: this.input.symptoms,
      dtcs: this.input.dtcs,
      vehicle: this.contextPack.vehicle,
    });
    return this.contextPack;
  }

  async enrichMissingDtcs(params: {
    toolLogger: ToolLogger;
    emitProgress: (event: ProgressEvent) => void;
    vehicle?: VinDecodeResult;
  }): Promise<void> {
    if (this.missingDtcWebResults) {
      return;
    }

    const contextPack = this.getContextPack();
    const unfoundCodes = contextPack.dtcs.filter((d) => !d.found).map((d) => d.code);
    if (unfoundCodes.length === 0) {
      return;
    }

    const { results, searchesUsed } = await resolveMissingDtcsViaWeb({
      unfoundCodes,
      vehicle: params.vehicle,
      toolLogger: params.toolLogger,
      emitProgress: params.emitProgress,
    });

    this.harnessWebSearchesUsed = searchesUsed;
    if (results) {
      this.missingDtcWebResults = results;
    }
  }

  setNotes(notes: string): void {
    this.investigationNotes = notes;
  }

  setDraft(draft: DiagnosisOutput): void {
    this.draft = draft;
  }

  getContextPack(): ContextPack {
    if (!this.contextPack) {
      throw new Error("Material not prefetched — call prefetch() first");
    }
    return this.contextPack;
  }

  snapshot(): MaterialSnapshot {
    return {
      input: this.input,
      contextPack: this.contextPack ?? {
        dtcs: [],
        symptoms: [],
        prefetchedAt: "",
      },
      investigationNotes: this.investigationNotes,
      draft: this.draft,
      suggestedSearchQuery: this.suggestedSearchQuery,
      missingDtcWebResults: this.missingDtcWebResults,
      harnessWebSearchesUsed: this.harnessWebSearchesUsed,
    };
  }

  restore(snapshot: MaterialSnapshot): void {
    this.input = snapshot.input;
    this.contextPack = snapshot.contextPack;
    this.investigationNotes = snapshot.investigationNotes;
    this.draft = snapshot.draft;
    this.suggestedSearchQuery = snapshot.suggestedSearchQuery;
    this.missingDtcWebResults = snapshot.missingDtcWebResults;
    this.harnessWebSearchesUsed = snapshot.harnessWebSearchesUsed ?? 0;
  }
}
