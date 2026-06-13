"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DiagnosisFormData } from "@/components/DiagnosisForm";
import { STORAGE_KEY } from "@/components/DiagnosisForm";
import {
  DiagnosisResults,
  downloadMarkdown,
  TracePanel,
} from "@/components/DiagnosisResults";
import type { DiagnosisOutput } from "@/harness/guardrails/schema";
import type {
  DiagnosisOutcome,
  DiagnosisTrace,
  HarnessAlarm,
  HumanEscalation,
  TraceEntry,
} from "@/harness/types";

type StreamState =
  | { phase: "loading" }
  | {
      phase: "streaming";
      status: string;
      trace: TraceEntry[];
      offlineBanner?: string;
      alarms: HarnessAlarm[];
    }
  | {
      phase: "complete";
      diagnosis: DiagnosisOutput;
      markdown: string;
      trace: DiagnosisTrace;
      outcome: DiagnosisOutcome;
      offlineBanner?: string;
      requestId: string;
    }
  | {
      phase: "escalation";
      escalation: HumanEscalation;
      requestId: string;
      trace: TraceEntry[];
      alarms: HarnessAlarm[];
      answers: Record<string, string>;
    }
  | { phase: "error"; message: string };

function readAgentFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("agent") ?? undefined;
}

async function consumeSseStream(
  response: Response,
  handlers: {
    onStatus: (message: string) => void;
    onTrace: (entry: TraceEntry) => void;
    onOffline: (message: string) => void;
    onAlarm: (alarm: HarnessAlarm) => void;
    onEscalation: (escalation: HumanEscalation, requestId: string) => void;
    onComplete: (payload: {
      diagnosis: DiagnosisOutput;
      markdown: string;
      trace: DiagnosisTrace;
      outcome: DiagnosisOutcome;
      requestId: string;
    }) => void;
  },
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response stream");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data: ")) continue;

      const payload = JSON.parse(line.slice(6)) as {
        type: string;
        message?: string;
        entry?: TraceEntry;
        alarm?: HarnessAlarm;
        escalation?: HumanEscalation;
        requestId?: string;
        diagnosis?: DiagnosisOutput;
        markdown?: string;
        trace?: DiagnosisTrace;
        outcome?: DiagnosisOutcome;
      };

      if (payload.type === "status" && payload.message) {
        handlers.onStatus(payload.message);
      }
      if (payload.type === "offline" && payload.message) {
        handlers.onOffline(payload.message);
      }
      if (payload.type === "trace" && payload.entry) {
        handlers.onTrace(payload.entry);
      }
      if (payload.type === "alarm" && payload.alarm) {
        handlers.onAlarm(payload.alarm);
      }
      if (payload.type === "escalation" && payload.escalation && payload.requestId) {
        handlers.onEscalation(payload.escalation, payload.requestId);
      }
      if (
        payload.type === "complete" &&
        payload.diagnosis &&
        payload.markdown &&
        payload.trace &&
        payload.requestId
      ) {
        handlers.onComplete({
          diagnosis: payload.diagnosis,
          markdown: payload.markdown,
          trace: payload.trace,
          outcome: payload.outcome ?? "success",
          requestId: payload.requestId,
        });
      }
      if (payload.type === "error") {
        throw new Error(payload.message ?? "Diagnosis failed");
      }
    }
  }
}

export default function DiagnosePage() {
  const [state, setState] = useState<StreamState>({ phase: "loading" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setState({
          phase: "error",
          message: "No diagnosis input found. Start from the home page.",
        });
        return;
      }

      let formData: DiagnosisFormData;
      try {
        formData = JSON.parse(raw) as DiagnosisFormData;
      } catch {
        setState({ phase: "error", message: "Invalid session data." });
        return;
      }

      const traceEntries: TraceEntry[] = [];
      const alarms: HarnessAlarm[] = [];
      let offlineBanner: string | undefined;
      let currentStatus = "Connecting…";

      setState({ phase: "streaming", status: currentStatus, trace: [], alarms: [] });

      try {
        const agent = readAgentFromUrl();
        const response = await fetch("/api/diagnose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...formData, agent }),
        });

        if (!response.ok) {
          const err = (await response.json()) as { error?: string };
          throw new Error(err.error ?? `HTTP ${response.status}`);
        }

        await consumeSseStream(response, {
          onStatus: (message) => {
            currentStatus = message;
            setState({
              phase: "streaming",
              status: currentStatus,
              trace: [...traceEntries],
              offlineBanner,
              alarms: [...alarms],
            });
          },
          onOffline: (message) => {
            offlineBanner = message;
            setState({
              phase: "streaming",
              status: currentStatus,
              trace: [...traceEntries],
              offlineBanner,
              alarms: [...alarms],
            });
          },
          onTrace: (entry) => {
            traceEntries.push(entry);
            setState({
              phase: "streaming",
              status: currentStatus,
              trace: [...traceEntries],
              offlineBanner,
              alarms: [...alarms],
            });
          },
          onAlarm: (alarm) => {
            alarms.push(alarm);
            setState({
              phase: "streaming",
              status: currentStatus,
              trace: [...traceEntries],
              offlineBanner,
              alarms: [...alarms],
            });
          },
          onEscalation: (escalation, requestId) => {
            setState({
              phase: "escalation",
              escalation,
              requestId,
              trace: [...traceEntries],
              alarms: [...alarms],
              answers: {},
            });
          },
          onComplete: (payload) => {
            if (payload.outcome === "awaiting_human") {
              return;
            }
            setState({
              phase: "complete",
              diagnosis: payload.diagnosis,
              markdown: payload.markdown,
              trace: payload.trace,
              outcome: payload.outcome,
              offlineBanner,
              requestId: payload.requestId,
            });
          },
        });
      } catch (error) {
        setState({
          phase: "error",
          message: error instanceof Error ? error.message : "Diagnosis failed",
        });
      }
    })();
  }, []);

  async function submitEscalationAnswers(
    requestId: string,
    escalation: HumanEscalation,
    answers: Record<string, string>,
    trace: TraceEntry[],
    alarms: HarnessAlarm[],
  ) {
    setState({
      phase: "streaming",
      status: "Continuing with your answers…",
      trace,
      alarms,
    });

    try {
      const agent = readAgentFromUrl();
      const response = await fetch("/api/diagnose/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, answers, agent }),
      });

      if (!response.ok) {
        const err = (await response.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${response.status}`);
      }

      const traceEntries = [...trace];
      const alarmList = [...alarms];
      let offlineBanner: string | undefined;
      let currentStatus = "Continuing…";

      await consumeSseStream(response, {
        onStatus: (message) => {
          currentStatus = message;
          setState({
            phase: "streaming",
            status: currentStatus,
            trace: [...traceEntries],
            offlineBanner,
            alarms: [...alarmList],
          });
        },
        onOffline: (message) => {
          offlineBanner = message;
        },
        onTrace: (entry) => {
          traceEntries.push(entry);
        },
        onAlarm: (alarm) => {
          alarmList.push(alarm);
        },
        onEscalation: (nextEscalation, nextRequestId) => {
          setState({
            phase: "escalation",
            escalation: nextEscalation,
            requestId: nextRequestId,
            trace: [...traceEntries],
            alarms: [...alarmList],
            answers: {},
          });
        },
        onComplete: (payload) => {
          setState({
            phase: "complete",
            diagnosis: payload.diagnosis,
            markdown: payload.markdown,
            trace: payload.trace,
            outcome: payload.outcome,
            offlineBanner,
            requestId: payload.requestId,
          });
        },
      });
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Continuation failed",
      });
    }
  }

  return (
    <div className="min-h-full bg-zinc-100">
      <header className="bg-zinc-900 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-lg font-bold tracking-tight">
            🏎️ Vroom Vroom
          </Link>
          <Link href="/" className="text-sm text-zinc-400 hover:text-white">
            New diagnosis
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {state.phase === "loading" && <p className="text-zinc-600">Loading…</p>}

        {state.phase === "streaming" && (
          <div className="space-y-6">
            <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
              <p className="text-zinc-700">{state.status}</p>
            </div>
            {state.offlineBanner && (
              <div className="rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-950">
                {state.offlineBanner}
              </div>
            )}
            {state.alarms.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <p className="font-semibold mb-1">Harness alarms</p>
                <ul className="space-y-1">
                  {state.alarms.map((alarm, i) => (
                    <li key={`${alarm.type}-${i}`}>
                      [{alarm.severity}] {alarm.recommendedAction}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {state.trace.length > 0 && (
              <details open className="rounded-lg border border-zinc-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-semibold text-zinc-700">
                  Live trace ({state.trace.length} events)
                </summary>
                <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto font-mono text-xs text-zinc-600">
                  {state.trace.map((entry, i) => (
                    <li key={`${entry.timestamp}-${i}`}>
                      [{entry.type}] {entry.name}: {entry.detail}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {state.phase === "escalation" && (
          <div className="space-y-6">
            <div className="rounded-lg border border-violet-300 bg-violet-50 px-4 py-3 text-sm text-violet-950">
              <p className="font-semibold">Harness needs your input</p>
              <p className="mt-1">{state.escalation.reason}</p>
            </div>
            <form
              className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
              onSubmit={(e) => {
                e.preventDefault();
                void submitEscalationAnswers(
                  state.requestId,
                  state.escalation,
                  state.answers,
                  state.trace,
                  state.alarms,
                );
              }}
            >
              {state.escalation.questions.map((question, i) => (
                <div key={question}>
                  <label className="block text-sm font-semibold text-zinc-800 mb-1">
                    {question}
                  </label>
                  <input
                    type="text"
                    value={state.answers[`q${i}`] ?? ""}
                    onChange={(e) =>
                      setState({
                        ...state,
                        answers: { ...state.answers, [`q${i}`]: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                  />
                </div>
              ))}
              <button
                type="submit"
                className="rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
              >
                Continue diagnosis
              </button>
            </form>
            <TracePanel
              trace={{
                requestId: state.requestId,
                agentId: "pending",
                agentName: "pending",
                entries: state.trace,
                toolCallCount: 0,
                webSearchCount: 0,
                guardrailHits: [],
                checkpointResults: [],
                alarms: state.alarms,
                loopIterations: 0,
                latencyMs: 0,
                modelId: "—",
                offlineMode: false,
              }}
            />
          </div>
        )}

        {state.phase === "complete" && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => downloadMarkdown(state.markdown)}
                className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-amber-400"
              >
                Download DIAGNOSIS.md
              </button>
              <Link
                href="/"
                className="rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
              >
                Start new diagnosis
              </Link>
            </div>
            <DiagnosisResults
              diagnosis={state.diagnosis}
              offlineBanner={state.offlineBanner}
              outcome={state.outcome}
            />
            <TracePanel trace={state.trace} outcome={state.outcome} />
          </div>
        )}

        {state.phase === "error" && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-900">
            <p className="font-semibold">Diagnosis could not complete</p>
            <p className="mt-2 text-sm">{state.message}</p>
            <Link
              href="/"
              className="mt-4 inline-block text-sm font-semibold text-amber-700 underline"
            >
              ← Back to form
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
