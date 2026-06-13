import { tavily } from "@tavily/core";
import trustedDomains from "@/knowledge/trusted-domains.json";
import type { WebSearchResponse } from "../types";

export const MAX_WEB_SEARCHES_PER_DIAGNOSIS = 2;

const MAX_RESULTS = 5;

let offlineMode = false;

export function isWebSearchOffline(): boolean {
  return offlineMode;
}

export function resetWebSearchOffline(): void {
  offlineMode = false;
}

export async function searchWeb(query: string): Promise<WebSearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    offlineMode = true;
    return {
      query,
      results: [],
      offlineMode: true,
      error: "TAVILY_API_KEY not configured — using offline knowledge only.",
    };
  }

  if (offlineMode) {
    return {
      query,
      results: [],
      offlineMode: true,
      error: "Live search unavailable — using offline knowledge only.",
    };
  }

  try {
    const client = tavily({ apiKey });
    const response = await client.search(query, {
      searchDepth: "basic",
      maxResults: MAX_RESULTS,
      includeDomains: trustedDomains as string[],
      includeAnswer: false,
    });

    const results = (response.results ?? []).map((item) => ({
      title: item.title ?? "Untitled",
      url: item.url ?? "",
      snippet: item.content ?? "",
    }));

    return { query, results, offlineMode: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Web search failed";
    const isQuota =
      message.includes("429") ||
      message.toLowerCase().includes("quota") ||
      message.toLowerCase().includes("rate limit");

    if (isQuota) {
      offlineMode = true;
    }

    return {
      query,
      results: [],
      offlineMode: isQuota || offlineMode,
      error: isQuota
        ? "Tavily quota reached — using offline knowledge only."
        : message,
    };
  }
}
