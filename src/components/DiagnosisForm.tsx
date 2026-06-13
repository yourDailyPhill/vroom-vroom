"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export interface DiagnosisFormData {
  symptoms: string;
  vin: string;
  dtcs: string;
  mileage: string;
}

export const STORAGE_KEY = "vroom-vroom-diagnosis-input";

export function DiagnosisForm() {
  const router = useRouter();
  const [symptoms, setSymptoms] = useState("");
  const [vin, setVin] = useState("");
  const [dtcs, setDtcs] = useState("");
  const [mileage, setMileage] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!symptoms.trim()) return;

    const data: DiagnosisFormData = {
      symptoms: symptoms.trim(),
      vin: vin.trim(),
      dtcs: dtcs.trim(),
      mileage: mileage.trim(),
    };

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    router.push("/diagnose");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="symptoms" className="block text-sm font-semibold text-zinc-800 mb-2">
          Describe your symptoms <span className="text-amber-600">*</span>
        </label>
        <textarea
          id="symptoms"
          required
          rows={5}
          value={symptoms}
          onChange={(e) => setSymptoms(e.target.value)}
          placeholder="e.g. Rough idle at stoplights, check engine light on, noticed after filling up…"
          className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="vin" className="block text-sm font-semibold text-zinc-800 mb-2">
            VIN <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <input
            id="vin"
            type="text"
            maxLength={17}
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            placeholder="17-character VIN"
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 font-mono text-sm uppercase focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          />
        </div>
        <div>
          <label htmlFor="dtcs" className="block text-sm font-semibold text-zinc-800 mb-2">
            Trouble codes <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <input
            id="dtcs"
            type="text"
            value={dtcs}
            onChange={(e) => setDtcs(e.target.value.toUpperCase())}
            placeholder="P0301, P0420"
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 font-mono text-sm uppercase focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          />
        </div>
      </div>

      <div>
        <label htmlFor="mileage" className="block text-sm font-semibold text-zinc-800 mb-2">
          Mileage <span className="font-normal text-zinc-500">(optional)</span>
        </label>
        <input
          id="mileage"
          type="text"
          value={mileage}
          onChange={(e) => setMileage(e.target.value)}
          placeholder="e.g. 142,000"
          className="w-full max-w-xs rounded-lg border border-zinc-300 bg-white px-4 py-2.5 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        />
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <strong className="font-semibold">Safety notice:</strong> Vroom Vroom provides DIY-safe
        diagnostic guidance for traditional gasoline/diesel vehicles only. Never work under a
        running engine, on unsupported vehicles, or on airbag/fuel/brake/high-voltage systems
        without professional help.
      </div>

      <button
        type="submit"
        className="w-full rounded-lg bg-amber-500 px-6 py-3 text-base font-semibold text-zinc-900 shadow-sm transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 sm:w-auto"
      >
        Run diagnosis →
      </button>
    </form>
  );
}
