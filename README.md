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

## Architecture

Vroom Vroom is organized around four pillars — the core requirements of a production AI harness:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    LOOP     │ →  │    TOOLS    │ →  │ GUARDRAILS  │ →  │ OBSERVABILITY│
│ Agent w/    │    │ Domain-     │    │ Safety      │    │ Structured  │
│ tool calls  │    │ locked      │    │ validation  │    │ logs + trace│
└─────────────┘    │ search      │    └─────────────┘    └─────────────┘
                   └─────────────┘
```


| Pillar            | What it does                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------- |
| **Loop**          | Constrained agent loop — max 5 tool rounds, 60s timeout, 2 web searches per diagnosis         |
| **Tools**         | Three-layer search: bundled DTC KB → NHTSA VIN decode → Tavily live search (domain allowlist) |
| **Guardrails**    | System prompt rules · Zod schema · regex blocklist · safe-rewrite fallback                    |
| **Observability** | JSON logs to Vercel + collapsible trace panel in the UI                                       |


**Full request pipeline**

```
User Input (symptoms, VIN, DTCs)
        │
        ▼
  Input Validation
        │
        ▼
  Domain-Locked Search Core
   ├── NHTSA VIN decode
   ├── Bundled DTC / symptom KB
   └── Tavily web search (trusted domains only)
        │
        ▼
  AI Processing Loop (Gemini Flash)
        │
        ▼
  Guardrail Validator ──→ fail? ──→ safe rewrite
        │
        ▼
  DIAGNOSIS.md  (download)
```



> 📄 Architecture defense and UI mockups live in `docs/` (coming soon).

---

## Tech stack


| Layer      | Choice                                                                           | Cost      |
| ---------- | -------------------------------------------------------------------------------- | --------- |
| Hosting    | [Vercel Hobby](https://vercel.com)                                               | Free      |
| Framework  | [Next.js 15](https://nextjs.org) + TypeScript                                    | Free      |
| LLM        | [Gemini Flash](https://ai.google.dev) via [Vercel AI SDK](https://sdk.vercel.ai) | Free tier |
| VIN decode | [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/)                                | Free      |
| Knowledge  | Bundled OBD-II DTC + symptom JSON                                                | Free      |
| Web search | [Tavily](https://tavily.com) with domain allowlist                               | Free tier |
| Export     | Client-side `DIAGNOSIS.md` download                                              | Free      |




**Built with care for people who just want their car to vroom again.**

*Traditional ICE vehicles only · Guardrails always on · Zero budget by design*

