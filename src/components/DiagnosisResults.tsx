"use client";

import type { DiagnosisOutput } from "@/harness/guardrails/schema";
import type { DiagnosisOutcome, DiagnosisTrace, HarnessAlarm, TraceEntry } from "@/harness/types";

function confidenceBadge(confidence: DiagnosisOutput["confidence"]) {
  const styles = {
    high: "bg-emerald-100 text-emerald-800",
    medium: "bg-amber-100 text-amber-900",
    low: "bg-red-100 text-red-800",
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${styles[confidence]}`}>
      {confidence} confidence
    </span>
  );
}

export function DiagnosisResults({
  diagnosis,
  offlineBanner,
  outcome = "success",
}: {
  diagnosis: DiagnosisOutput;
  offlineBanner?: string;
  outcome?: DiagnosisOutcome;
}) {
  return (
    <div className="space-y-8">
      {outcome === "service_unavailable" && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          Diagnosis unavailable — please try again later. This is a temporary service issue,
          not a safety concern with your request.
        </div>
      )}

      {outcome === "safety_blocked" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          This request was blocked by safety guardrails. Professional guidance is recommended
          for the topic you described.
        </div>
      )}

      {outcome === "awaiting_human" && (
        <div className="rounded-lg border border-violet-300 bg-violet-50 px-4 py-3 text-sm text-violet-950">
          The harness needs more information before it can produce a reliable diagnosis.
          Answer the follow-up questions below and continue.
        </div>
      )}

      {offlineBanner && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-950">
          {offlineBanner}
        </div>
      )}

      <section>
        <h2 className="text-lg font-bold text-zinc-900 mb-2">Summary</h2>
        <p className="text-zinc-700 leading-relaxed">{diagnosis.summary}</p>
      </section>

      <section>
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <h2 className="text-lg font-bold text-zinc-900">Most Likely Cause</h2>
          {confidenceBadge(diagnosis.confidence)}
        </div>
        <p className="text-zinc-800 font-medium">{diagnosis.mostLikelyCause}</p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-zinc-900 mb-4">Diagnostic Steps</h2>
        <ol className="space-y-4">
          {diagnosis.diagnosticSteps.map((step) => (
            <li key={step.step} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-sm font-bold text-zinc-900">
                  {step.step}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-zinc-800">{step.action}</p>
                  {step.toolsNeeded.length > 0 && (
                    <p className="mt-2 text-sm text-zinc-600">
                      <span className="font-semibold">Tools:</span> {step.toolsNeeded.join(", ")}
                    </p>
                  )}
                  {step.safetyNotes && step.safetyNotes.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-amber-900">
                      {step.safetyNotes.map((note) => (
                        <li key={note}>⚠ {note}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="text-lg font-bold text-zinc-900 mb-2">When to Seek a Professional</h2>
        <ul className="list-disc space-y-1 pl-5 text-zinc-700">
          {diagnosis.whenToSeekPro.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      {diagnosis.sources.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-zinc-900 mb-2">Sources</h2>
          <ul className="space-y-2">
            {diagnosis.sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-700 underline hover:text-amber-900"
                >
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
        <strong className="font-semibold text-zinc-800">Disclaimer:</strong> {diagnosis.disclaimer}
      </section>
    </div>
  );
}

export function TracePanel({
  trace,
  outcome = "success",
}: {
  trace: DiagnosisTrace;
  outcome?: DiagnosisOutcome;
}) {
  return (
    <details className="rounded-lg border border-zinc-200 bg-zinc-50">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-100">
        Diagnosis trace ({trace.toolCallCount} tools · {trace.webSearchCount} searches ·{" "}
        {trace.latencyMs}ms)
      </summary>
      <div className="border-t border-zinc-200 px-4 py-3">
        <dl className="mb-4 grid grid-cols-2 gap-2 text-xs text-zinc-600 sm:grid-cols-4">
          <div>
            <dt className="font-semibold">Request ID</dt>
            <dd className="font-mono truncate">{trace.requestId}</dd>
          </div>
          <div>
            <dt className="font-semibold">Agent</dt>
            <dd>{trace.agentName}</dd>
          </div>
          <div>
            <dt className="font-semibold">Model</dt>
            <dd>{trace.modelId}</dd>
          </div>
          <div>
            <dt className="font-semibold">Loop steps</dt>
            <dd>{trace.loopIterations}</dd>
          </div>
          <div>
            <dt className="font-semibold">Mode</dt>
            <dd>{trace.offlineMode ? "Offline KB" : "Online"}</dd>
          </div>
        </dl>
        {trace.checkpointResults.length > 0 && (
          <div className="mb-3 text-xs">
            <p className="font-semibold text-zinc-700 mb-1">Checkpoints</p>
            <ul className="space-y-1">
              {trace.checkpointResults.map((cp) => (
                <li
                  key={`${cp.checkpointId}-${cp.timestamp}`}
                  className={cp.passed ? "text-emerald-700" : "text-red-700"}
                >
                  {cp.checkpointId}: {cp.passed ? "PASS" : `FAIL (${cp.failures.join("; ")})`}
                </li>
              ))}
            </ul>
          </div>
        )}
        {trace.alarms.length > 0 && (
          <div className="mb-3 text-xs">
            <p className="font-semibold text-zinc-700 mb-1">Alarms</p>
            <ul className="space-y-1">
              {trace.alarms.map((alarm: HarnessAlarm, i) => (
                <li key={`${alarm.type}-${i}`} className="text-amber-900">
                  [{alarm.severity}] {alarm.type}: {alarm.recommendedAction}
                </li>
              ))}
            </ul>
          </div>
        )}
        {trace.guardrailHits.length > 0 && outcome !== "service_unavailable" && (
          <p className="mb-3 text-xs text-red-700">
            Guardrail hits: {trace.guardrailHits.join("; ")}
          </p>
        )}
        <ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs text-zinc-600">
          {trace.entries.map((entry: TraceEntry, i) => (
            <li key={`${entry.timestamp}-${i}`} className="flex gap-2">
              <span className="shrink-0 text-zinc-400">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className="shrink-0 font-semibold text-amber-700">[{entry.type}]</span>
              <span className="truncate">
                {entry.name}: {entry.detail}
                {entry.durationMs != null ? ` (${entry.durationMs}ms)` : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export function downloadMarkdown(markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "DIAGNOSIS.md";
  anchor.click();
  URL.revokeObjectURL(url);
}
