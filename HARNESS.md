# Vroom Vroom — AI Harness Architecture

This document describes the **harness** that governs diagnostic agents in Vroom Vroom. The harness is separate from any specific worker (agent) implementation. Swapping agents requires no changes to harness code.

For product overview and local setup, see [README.md](README.md).

---

## Four Pillars

Vroom Vroom follows the [Fired Festival harness model](https://fired-festival.com/harness): **Loop**, **Tools**, **Guardrails**, and **Observability**. Each pillar is a distinct, identifiable layer in the code — separate from swappable workers in `agents/`.

```
┌────────────-─┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────-┐
│    LOOP      │ →  │    TOOLS    │ →  │ GUARDRAILS  │ →  │OBSERVABILITY │
│ Orchestrator │    │ Domain-     │    │ Declared    │    │ Trace, logs, │
│ + checkpoints│    │ locked      │    │ safety rules│    │ alarms       │
│ + material   │    │ search      │    │ + validation│    │ + checkpoints│
└─────────────-┘    └─────────────┘    └─────────────┘    └─────────────-┘
         │                  │                  │                  │
         └──────────────────┴──────────────────┴──────────────────┘
                                    │
                                    ▼
                         Swappable DiagnosticAgent
                    (tool-calling · single-pass · …)
```

| Pillar | Module(s) | Responsibility |
|--------|-----------|----------------|
| **Loop** | [`core/harness.ts`](src/harness/core/harness.ts), [`checkpoints/`](src/harness/checkpoints/), [`material/`](src/harness/material/), [`agents/interface.ts`](src/harness/agents/interface.ts) | Govern the agent: stage gates, context handoff, feedback on failure, swappable workers |
| **Tools** | [`tools/`](src/harness/tools/), [`tools/harness-tools.ts`](src/harness/tools/harness-tools.ts) | Domain-locked capabilities — DTC KB, NHTSA VIN, Tavily web search — provided to agents by the harness |
| **Guardrails** | [`guardrails/`](src/harness/guardrails/) | Declared input/output rules with explicit pass/fail criteria |
| **Observability** | [`observability/`](src/harness/observability/), [`alarms/`](src/harness/alarms/) | Structured logs, live trace, checkpoint results, and typed alarms |

**Workers** ([`agents/`](src/harness/agents/)) implement `DiagnosticAgent` and are invoked *by* the loop. They never run guardrails, checkpoints, or logging themselves.

---

## Request Pipeline

```
User Input
    │
    ▼
Checkpoint: input_valid ──► Guardrails (input-scope)
    │ fail ──► Alarm + safe fallback (STOP)
    ▼
MaterialStore.prefetch() ──► NHTSA VIN, DTC KB, symptom index
    │
    ▼
Checkpoint: material_ready
    │ fail ──► Alarm + human escalation (HITL)
    ▼
Agent.execute(ctx) ──► Worker produces draft (tools optional)
    │
    ▼
Checkpoint: agent_produced_draft
    │ fail ──► Alarm + service failure (STOP)
    ▼
Guardrails (output-schema, output-safety, confidence-floor)
    │
    ▼
Checkpoint: output_safe
    │ fail ──► Agent.execute(ctx + feedback.rewrite) ──► re-validate
    │ still fail ──► HITL or safe fallback
    ▼
DIAGNOSIS.md
```

---

## Swappable Agent Interface

Workers implement [`DiagnosticAgent`](src/harness/agents/interface.ts):

```typescript
interface DiagnosticAgent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  execute(ctx: AgentExecutionContext): Promise<AgentExecutionResult>;
}
```

The harness provides:

- `material` — read-only snapshot (context pack, notes, draft)
- `tools` — domain-locked VIN/DTC/symptom/web-search tools
- `feedback` — injected after guardrail or checkpoint failure
- `signal` — abort/timeout control

Workers **must not** run guardrails, emit checkpoints, or decide final outcomes.

### Registered Agents

| ID | File | Strategy |
|----|------|----------|
| `tool-calling` | [`tool-calling-agent.ts`](src/harness/agents/tool-calling-agent.ts) | Tool loop → structured synthesis → rewrite on feedback |
| `single-pass` | [`single-pass-agent.ts`](src/harness/agents/single-pass-agent.ts) | One-shot structured output from pre-fetched material |

Resolve via [`registry.ts`](src/harness/agents/registry.ts):

```typescript
resolveAgent(id?) // id from body.agent, ?agent= URL param, or DIAGNOSTIC_AGENT env
```

### Demo: Swap Agents

1. Run a diagnosis with the default agent (`tool-calling`)
2. Re-run the same input with `?agent=single-pass` on `/diagnose`, or set `DIAGNOSTIC_AGENT=single-pass`
3. Compare trace panels — harness checkpoints and guardrails are identical; only `agentName` and loop behavior differ

### Adding a Third Agent

1. Create `src/harness/agents/my-agent.ts` implementing `DiagnosticAgent`
2. Register in `src/harness/agents/registry.ts`
3. No changes to `harness.ts`, the loop, guardrails, tools, or observability layers

---

## Loop

The loop is the harness orchestrator — it governs agent behavior and changes what the worker does based on guardrail or checkpoint feedback.

**Orchestrator:** [`core/harness.ts`](src/harness/core/harness.ts) — `runHarness(input, agent, …)`

**Checkpoints** ([`checkpoints/`](src/harness/checkpoints/)) — explicit pass/fail gates inside the loop:

| Checkpoint | After | Pass | Fail action |
|------------|-------|------|-------------|
| `input_valid` | input received | Input guardrails pass | Alarm + stop |
| `material_ready` | prefetch | VIN valid if given; KB match or sufficient symptoms | HITL escalation |
| `agent_produced_draft` | agent returns | Draft parses against schema | Service failure |
| `output_safe` | guardrails | All output rules pass | Rewrite feedback to agent |

**Material handling** ([`material/store.ts`](src/harness/material/store.ts)) — typed context the loop passes between stages:

```typescript
interface MaterialSnapshot {
  input: DiagnosisInput;
  contextPack: ContextPack;
  investigationNotes?: string;
  draft?: DiagnosisOutput;
  suggestedSearchQuery?: string;
}
```

Agents receive a read-only snapshot. Only the loop mutates material via `setNotes()` / `setDraft()`.

**Checkpoint persistence & replay:** [`checkpoints/store.ts`](src/harness/checkpoints/store.ts) stores snapshots per `requestId`. Continue via `POST /api/diagnose/continue` to replay from `material_ready` without re-running prior loop stages.

**Feedback loop:** when `output_safe` fails, the loop re-invokes the agent with `feedback: { kind: "rewrite", … }` — agent behavior changes meaningfully without changing harness code.

---

## Tools

Domain tools live in [`tools/`](src/harness/tools/) — bundled DTC KB, NHTSA VIN decode, symptom index, Tavily web search (domain allowlist).

The loop builds a [`HarnessToolRegistry`](src/harness/tools/harness-tools.ts) and passes it to agents. Tools are infrastructure the loop controls (shared 2-search budget per diagnosis, offline fallback); agents call them during investigation but do not define or configure them.

Prefetch ([`prefetch.ts`](src/harness/prefetch.ts)) runs before the agent loop to warm the material store with KB hits.

**Missing DTC resolution:** The bundled KB is curated, not exhaustive (e.g. P0303 may be absent). When prefetch finds DTC codes not in the KB, the loop automatically runs one combined web search via [`resolve-missing-dtcs.ts`](src/harness/tools/resolve-missing-dtcs.ts) before the agent executes. Results are stored in `missingDtcWebResults` on the material snapshot and included in agent context. This uses 1 slot of the shared 2-search-per-diagnosis budget.

**Trusted domains** ([`trusted-domains.json`](src/knowledge/trusted-domains.json)) include repair sites, OBD code references, and other trusted knowledge sites.

---

## Guardrails

Defined in [`guardrails/registry.ts`](src/harness/guardrails/registry.ts):

| Rule ID | Stage | Criteria |
|---------|-------|----------|
| `input-scope` | pre-agent | No bypass/EV keywords; symptoms required |
| `output-schema` | post-agent | Zod `diagnosisSchema` pass |
| `output-safety` | post-agent | Blocklist regex; safety notes on risky steps |
| `confidence-floor` | post-agent | Low confidence requires at least one cited source |

On output failure, the harness re-invokes the agent with:

```typescript
feedback: { kind: "rewrite", issues: string[], previousDraft: DiagnosisOutput }
```

The agent's behavior **changes meaningfully** — it runs a rewrite pass instead of a fresh investigation.

---

## Observability

Structured visibility into every diagnosis run:

| Component | Module | What it records |
|-----------|--------|-----------------|
| **Logger** | [`observability/logger.ts`](src/harness/observability/logger.ts) | Tool calls, guardrail hits, loop iterations, agent ID, JSON logs |
| **Trace panel** | UI [`DiagnosisResults.tsx`](src/components/DiagnosisResults.tsx) | Live SSE trace, checkpoints, alarms |
| **Alarms** | [`alarms/`](src/harness/alarms/) | Typed events with severity, context, and recommended action |

Each alarm:

```typescript
interface HarnessAlarm {
  type: string;           // guardrail_violation | checkpoint_failed | service_error | human_escalation | material_incomplete
  severity: "info" | "warning" | "critical";
  context: Record<string, unknown>;
  recommendedAction: string;
}
```

Alarms and checkpoint results stream over SSE (`alarm`, `checkpoint` events) and appear in the final trace.

---

## Human-in-the-Loop Escalation

The harness stops and asks rather than guessing when:

- Symptoms are too vague and no KB matches exist (`material_ready` checkpoint)
- Output has low confidence with zero sources after rewrite (`output_safe` checkpoint)

Flow:

1. Harness emits `human_escalation` alarm + `escalation` SSE event with questions
2. UI collects answers
3. `POST /api/diagnose/continue` replays from checkpoint with `feedback: { kind: "human_answers", answers }`

---

## API

| Endpoint | Purpose |
|----------|---------|
| `POST /api/diagnose` | Start diagnosis. Body: `{ symptoms, vin?, dtcs?, mileage?, agent? }` |
| `POST /api/diagnose/continue` | HITL continuation. Body: `{ requestId, answers, agent? }` |

Both return Server-Sent Events: `status`, `trace`, `checkpoint`, `alarm`, `escalation`, `complete`, `error`.

---

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `GEMINI_API_KEY` | — | Required for workers (LLM) |
| `DIAGNOSTIC_AGENT` | `tool-calling` | Default worker ID |
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` | Model for workers |
| `TAVILY_API_KEY` | — | Optional live web search |

---

## Design Decisions

- **Loop governs workers** — agents propose drafts; the loop + guardrails decide outcomes
- **Feedback loop** — failed guardrails change agent input via `AgentFeedback`, not loop logic
- **Zero loop changes to swap workers** — registry pattern + stable `AgentExecutionContext`
- **Observability is first-class** — checkpoints and alarms are structured, not ad-hoc strings
- **In-memory checkpoint store** — sufficient for demo replay; no database required
