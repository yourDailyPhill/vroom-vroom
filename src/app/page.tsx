import Link from "next/link";
import { DiagnosisForm } from "@/components/DiagnosisForm";

export default function HomePage() {
  return (
    <div className="min-h-full bg-zinc-100">
      <header className="bg-zinc-900 text-white">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-sm font-medium uppercase tracking-widest text-amber-400">
            Automotive AI Diagnostic Harness
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            🏎️ Vroom Vroom
          </h1>
          <p className="mt-3 max-w-xl text-lg text-zinc-300">
            Your car is talking. We&apos;re listening. Grounded diagnosis for DIYers — not a
            chatbot.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold text-zinc-900 mb-1">Start a diagnosis</h2>
          <p className="text-sm text-zinc-600 mb-6">
            Traditional ICE vehicles only · Guardrails always on · Free tier by design
          </p>
          <DiagnosisForm />
        </div>

        <section className="mt-10 grid gap-4 sm:grid-cols-2">
          {[
            {
              title: "Loop",
              body: "Constrained agent — max 5 tool rounds, 60s timeout, 2 web searches.",
            },
            {
              title: "Tools",
              body: "Bundled DTC KB → NHTSA VIN → Tavily search on trusted domains only.",
            },
            {
              title: "Guardrails",
              body: "System rules, Zod schema, regex blocklist, safe-rewrite fallback.",
            },
            {
              title: "Observability",
              body: "Structured JSON logs + collapsible trace panel for every diagnosis.",
            },
          ].map((pillar) => (
            <div
              key={pillar.title}
              className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <h3 className="font-bold text-amber-700">{pillar.title}</h3>
              <p className="mt-1 text-sm text-zinc-600">{pillar.body}</p>
            </div>
          ))}
        </section>

        <p className="mt-8 text-center text-xs text-zinc-500">
          Built for Gauntlet AI Fire Festival ·{" "}
          <Link href="https://github.com/yourDailyPhill/vroom-vroom" className="underline hover:text-zinc-700">
            GitHub
          </Link>
        </p>
      </main>
    </div>
  );
}
