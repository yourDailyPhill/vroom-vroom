# 🏎️ Vroom Vroom

### Your car is talking. We're listening.

**AI-powered diagnosis for traditional vehicles — grounded in real data, guarded for DIYers, free to host.**

Built for [Gauntlet AI's Fire Festival](https://gauntletai.com) — *Build an AI harness.*

[TypeScript](https://www.typescriptlang.org/)  
[Next.js](https://nextjs.org/)  
[Vercel](https://vercel.com/)  
[Gemini](https://ai.google.dev/)

---

## The problem

Check engine light on. Rough idle. Weird noise you can't place.

You Google it. You get ten conflicting forum threads, a YouTube guy yelling about fuel rails, and a chatbot that *sounds* confident but made up the TSB number.

**Vroom Vroom is not a chatbot.** It's an AI **harness** — a controlled system that grounds every answer in verifiable automotive data and refuses to suggest procedures that could hurt you.

---

## What it does

Describe your symptoms. Optionally add your VIN and trouble codes. Vroom Vroom returns a `**DIAGNOSIS.md`** report with:

- **Most likely cause** (with confidence level)
- **Step-by-step DIY diagnostics** (code scanner, basic tools, multimeter)
- **When to stop and see a pro**
- **Cited sources** from trusted automotive domains

Built for **non-professionals** working on **traditional ICE vehicles** (gasoline and diesel).

---

## Run locally

### Prerequisites

- [Node.js](https://nodejs.org/) **20+**
- npm (bundled with Node)
- A clone of this repo

### Install

```bash
git clone https://github.com/yourDailyPhill/vroom-vroom.git
cd vroom-vroom
npm install
```

### Environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and set your API keys:


| Variable         | Required | Notes                                                          |
| ---------------- | -------- | -------------------------------------------------------------- |
| `GEMINI_API_KEY` | Yes      | [Google AI Studio](https://aistudio.google.com/apikey)         |
| `TAVILY_API_KEY` | No       | [Tavily](https://tavily.com) — omit for offline knowledge only |
| `GEMINI_MODEL`   | No       | Defaults to `gemini-2.5-flash-lite`                            |
| `DIAGNOSTIC_AGENT` | No     | `tool-calling` (default) or `single-pass` — see [HARNESS.md](HARNESS.md) |


Restart the dev server after editing `.env.local`.

### Start dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Try it

1. Enter symptoms (and optionally VIN / DTC codes) on the home page
2. Submit to run the harness
3. View the trace panel on `/diagnose` and download `DIAGNOSIS.md`

### Other scripts

- `npm run build` — production build
- `npm run start` — serve production build locally (run `build` first)
- `npm run lint` — ESLint

### Troubleshooting

- **Missing `GEMINI_API_KEY`** — diagnosis will fail; check `.env.local` and restart `npm run dev`
- **No `TAVILY_API_KEY`** — app still works; live web search is disabled and offline knowledge is used instead

---

## Architecture

Vroom Vroom is an **AI harness** — not a chatbot. It follows the [Fired Festival four-pillar model](https://fired-festival.com/harness): **Loop**, **Tools**, **Guardrails**, and **Observability**. A pluggable diagnostic agent (worker) runs inside the loop. Full design: **[HARNESS.md](HARNESS.md)**.

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    LOOP     │ →  │    TOOLS    │ →  │ GUARDRAILS  │ →  │OBSERVABILITY│
│ Orchestrator│    │ Domain-     │    │ Declared    │    │ Trace, logs,│
│ + checkpoints│   │ locked      │    │ safety rules│    │ alarms      │
└─────────────┘    │ search      │    └─────────────┘    └─────────────┘
                   └─────────────┘
                            │
                            ▼
                 Swappable DiagnosticAgent
                (tool-calling · single-pass · …)
```

| Pillar | What it does |
|--------|--------------|
| **Loop** | Orchestrates the run — checkpoints, material handoff, agent feedback, swappable workers |
| **Tools** | Bundled DTC KB → NHTSA VIN → Tavily search (trusted domains only) |
| **Guardrails** | Declared input/output rules — blocklist, Zod schema, confidence floor, safe rewrite |
| **Observability** | JSON logs, live trace panel, structured alarms, checkpoint pass/fail in UI |

**Swappable agents:** set `DIAGNOSTIC_AGENT=single-pass` or pass `?agent=single-pass` on `/diagnose` — the loop and other pillars do not change.

**Full request pipeline**

```
User Input (symptoms, VIN, DTCs)
        │
        ▼
  Loop: input_valid checkpoint + Guardrails
        │
        ▼
  Tools: prefetch (NHTSA · DTC KB · symptoms)
        │
        ▼
  Loop: material_ready checkpoint ──→ HITL if insufficient context
        │
        ▼
  DiagnosticAgent.execute()  ← swappable worker
        │
        ▼
  Loop: output_safe + Guardrails ──→ feedback.rewrite to agent
        │
        ▼
  Observability: trace + alarms ──► DIAGNOSIS.md (download)
```

---

## Tech stack


| Layer      | Choice                                             | Cost      |
| ---------- | -------------------------------------------------- | --------- |
| Hosting    | [Vercel Hobby](https://vercel.com)                 | Free      |
| Framework  | [Next.js 15](https://nextjs.org) + TypeScript      | Free      |
| LLM        | [Gemini Flash](https://ai.google.dev)              | Free tier |
| VIN decode | [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/)  | Free      |
| Knowledge  | Bundled OBD-II DTC + symptom JSON                  | Free      |
| Web search | [Tavily](https://tavily.com) with domain allowlist | Free tier |
| Export     | Client-side `DIAGNOSIS.md` download                | Free      |


**Built with care for people who just want their car to vroom again.**

*Traditional ICE vehicles only · Guardrails always on · Zero budget by design*