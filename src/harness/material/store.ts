import type { DiagnosisOutput } from "../guardrails/schema";
import { buildContextPack } from "../prefetch";
import { buildSearchQuery } from "../tools/query-builder";
import type { ContextPack, DiagnosisInput } from "../types";

export interface MaterialSnapshot {
  input: DiagnosisInput;
  contextPack: ContextPack;
  investigationNotes?: string;
  draft?: DiagnosisOutput;
  suggestedSearchQuery?: string;
}

export class MaterialStore {
  private input: DiagnosisInput;
  private contextPack?: ContextPack;
  private investigationNotes?: string;
  private draft?: DiagnosisOutput;
  private suggestedSearchQuery?: string;

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
    };
  }

  restore(snapshot: MaterialSnapshot): void {
    this.input = snapshot.input;
    this.contextPack = snapshot.contextPack;
    this.investigationNotes = snapshot.investigationNotes;
    this.draft = snapshot.draft;
    this.suggestedSearchQuery = snapshot.suggestedSearchQuery;
  }
}
