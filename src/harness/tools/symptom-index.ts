import symptomTrees from "@/knowledge/symptom-trees.json";
import type { SymptomMatch } from "../types";

interface SymptomTreeEntry {
  keywords: string[];
  title: string;
  checks: string[];
  commonCauses: string[];
  safetyNotes: string[];
}

const trees = symptomTrees as SymptomTreeEntry[];

function scoreMatch(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword.toLowerCase()));
}

export function lookupSymptom(keywords: string): SymptomMatch[] {
  const query = keywords.trim();
  if (!query) return [];

  const matches = trees
    .map((tree) => {
      const matchedKeywords = scoreMatch(query, tree.keywords);
      return { tree, matchedKeywords, score: matchedKeywords.length };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return matches.map(({ tree, matchedKeywords }) => ({
    title: tree.title,
    checks: tree.checks,
    commonCauses: tree.commonCauses,
    safetyNotes: tree.safetyNotes,
    matchedKeywords,
  }));
}

export function lookupSymptomFromText(symptoms: string): SymptomMatch[] {
  return lookupSymptom(symptoms);
}
