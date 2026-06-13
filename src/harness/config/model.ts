export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

export function getGeminiModelId(): string {
  const fromEnv = process.env.GEMINI_MODEL?.trim();
  return fromEnv || DEFAULT_GEMINI_MODEL;
}
