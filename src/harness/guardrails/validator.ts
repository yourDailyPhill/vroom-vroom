import type { DiagnosisOutput } from "./schema";
import { diagnosisSchema } from "./schema";
import {
  BYPASS_KEYWORDS,
  DANGEROUS_PHRASES,
  EV_HYBRID_KEYWORDS,
} from "./blocklist";
import {
  SAFE_FALLBACK_DISCLAIMER,
  SERVICE_FAILURE_DISCLAIMER,
} from "./prompts";

export type ServiceFailureReason =
  | "quota"
  | "spending_cap"
  | "timeout"
  | "agent"
  | "rewrite";

const SERVICE_FAILURE_PATTERNS = [
  /spending cap/i,
  /monthly spending/i,
  /429/,
  /rate limit/i,
  /api key/i,
  /failed after \d+ attempts/i,
  /abort/i,
  /timeout/i,
  /timed out/i,
  /generativelanguage/i,
  /econnrefused/i,
  /enotfound/i,
  /network/i,
  /fetch failed/i,
  /no structured output/i,
  /response mime type.*application\/json/i,
  /function calling with a response mime type/i,
  /agent loop failed/i,
];

export function isServiceFailureError(message: string): boolean {
  return SERVICE_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

export function classifyServiceFailureReason(
  message: string,
): ServiceFailureReason {
  if (/spending cap|monthly spending/i.test(message)) return "spending_cap";
  if (/quota|429|rate limit/i.test(message)) return "quota";
  if (/timeout|timed out|abort/i.test(message)) return "timeout";
  if (/rewrite/i.test(message)) return "rewrite";
  return "agent";
}

function sanitizeSafetyIssueForUser(issue: string): string {
  if (issue.startsWith("Request involves prohibited topic:")) {
    return issue;
  }
  if (issue.includes("out of scope")) {
    return issue;
  }
  if (issue.startsWith("Blocked dangerous content:")) {
    return issue;
  }
  return "Automated safety checks flagged this request.";
}

export function buildServiceFailureDiagnosis(
  reason: ServiceFailureReason = "agent",
): DiagnosisOutput {
  if (reason === "spending_cap") {
    return {
      summary:
        "Your Google AI Studio project has hit its monthly spending cap.",
      mostLikelyCause:
        "Billing may be enabled, but AI Studio also enforces a separate monthly spend cap per project. This is not related to the safety of your vehicle request.",
      confidence: "low",
      diagnosticSteps: [
        {
          step: 1,
          action:
            "Open https://ai.studio/spend and raise or remove the monthly spend cap for the project linked to your GEMINI_API_KEY.",
          toolsNeeded: [],
        },
        {
          step: 2,
          action:
            "Confirm the API key in .env.local was created in that same AI Studio project (API keys → your project).",
          toolsNeeded: [],
        },
        {
          step: 3,
          action: "Restart the dev server and try again after updating the cap.",
          toolsNeeded: [],
        },
      ],
      whenToSeekPro: [
        "This is a hosting/API configuration issue, not a vehicle safety issue.",
        "If symptoms are severe (flashing check engine light, overheating, loss of brakes or steering), seek professional help regardless of this tool.",
      ],
      sources: [
        {
          title: "Gemini API billing — project spend caps",
          url: "https://ai.google.dev/gemini-api/docs/billing#project-spend-caps",
        },
      ],
      disclaimer: SERVICE_FAILURE_DISCLAIMER,
    };
  }

  const quotaSummary =
    reason === "quota"
      ? "The AI service quota is temporarily unavailable."
      : "We couldn't complete your diagnosis right now.";

  const retryStep =
    reason === "quota"
      ? "Wait a few minutes and try again. Free-tier limits reset periodically."
      : "Wait a moment and try submitting your diagnosis again.";

  return {
    summary: quotaSummary,
    mostLikelyCause:
      "The diagnostic service is temporarily unavailable — this is not related to the safety of your request.",
    confidence: "low",
    diagnosticSteps: [
      {
        step: 1,
        action: retryStep,
        toolsNeeded: [],
      },
      {
        step: 2,
        action:
          "If you are self-hosting, verify GEMINI_API_KEY is set in .env.local and restart the dev server.",
        toolsNeeded: [],
      },
    ],
    whenToSeekPro: [
      "If symptoms are severe (flashing check engine light, overheating, loss of brakes or steering), seek professional help regardless of this tool.",
      "Persistent issues after a successful diagnosis should be inspected by a certified technician.",
    ],
    sources: [],
    disclaimer: SERVICE_FAILURE_DISCLAIMER,
  };
}

export interface ValidationResult {
  valid: boolean;
  issues: string[];
}

function collectText(output: DiagnosisOutput): string {
  const parts = [
    output.summary,
    output.mostLikelyCause,
    output.disclaimer,
    ...output.whenToSeekPro,
    ...output.diagnosticSteps.flatMap((s) => [
      s.action,
      ...(s.safetyNotes ?? []),
    ]),
  ];
  return parts.join("\n");
}

export function validateInput(params: {
  symptoms: string;
  vin?: string;
}): ValidationResult {
  const issues: string[] = [];
  const lower = params.symptoms.toLowerCase();

  for (const keyword of BYPASS_KEYWORDS) {
    if (lower.includes(keyword)) {
      issues.push(`Request involves prohibited topic: ${keyword}`);
    }
  }

  for (const keyword of EV_HYBRID_KEYWORDS) {
    if (lower.includes(keyword)) {
      issues.push(`EV/hybrid high-voltage diagnostics are out of scope`);
      break;
    }
  }

  if (!params.symptoms.trim()) {
    issues.push("Symptoms description is required");
  }

  return { valid: issues.length === 0, issues };
}

export function validateDiagnosis(output: DiagnosisOutput): ValidationResult {
  const issues: string[] = [];
  const text = collectText(output);

  const parsed = diagnosisSchema.safeParse(output);
  if (!parsed.success) {
    issues.push(`Schema validation failed: ${parsed.error.message}`);
  }

  for (const { pattern, reason } of DANGEROUS_PHRASES) {
    if (pattern.test(text)) {
      issues.push(`Blocked dangerous content: ${reason}`);
    }
  }

  for (const keyword of EV_HYBRID_KEYWORDS) {
    if (text.toLowerCase().includes(keyword)) {
      issues.push("EV/hybrid content detected in output");
      break;
    }
  }

  const riskyStepPattern =
    /(fuel|coolant|electrical|ignition|exhaust|battery)/i;
  for (const step of output.diagnosticSteps) {
    if (
      riskyStepPattern.test(step.action) &&
      (!step.safetyNotes || step.safetyNotes.length === 0)
    ) {
      issues.push(
        `Step ${step.step} involves risky work but lacks safety notes`,
      );
    }
  }

  if (!output.disclaimer.trim()) {
    issues.push("Missing disclaimer");
  }

  if (output.whenToSeekPro.length === 0) {
    issues.push("Missing professional referral guidance");
  }

  return { valid: issues.length === 0, issues };
}

export function buildSafeFallbackDiagnosis(
  issues: string[],
): DiagnosisOutput {
  return {
    summary:
      "Your request could not be safely answered with DIY guidance. Some topics require professional equipment and training.",
    mostLikelyCause:
      "Unable to determine — safety validation blocked automated diagnosis.",
    confidence: "low",
    diagnosticSteps: [
      {
        step: 1,
        action:
          "Do not attempt repairs involving fuel systems, airbags, brakes, or high-voltage components.",
        toolsNeeded: [],
        safetyNotes: [
          "Your safety is the priority. Stop if you are unsure.",
        ],
      },
      {
        step: 2,
        action:
          "Schedule an inspection with a certified automotive technician. Share your symptoms and any trouble codes.",
        toolsNeeded: ["OBD-II scanner (optional, to share codes with shop)"],
        safetyNotes: [
          "A professional can properly diagnose issues that require specialized tools.",
        ],
      },
    ],
    whenToSeekPro: [
      "Immediately — do not proceed with DIY repairs for this request.",
      "If the check engine light is flashing, reduce driving and seek service promptly.",
      issues.length > 0
        ? sanitizeSafetyIssueForUser(issues[0])
        : "Automated safety checks flagged this request.",
    ],
    sources: [],
    disclaimer: SAFE_FALLBACK_DISCLAIMER,
  };
}
