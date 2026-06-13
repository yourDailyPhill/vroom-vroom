import { parseDtcList } from "@/harness/tools/dtc";
import { runDiagnosis } from "@/harness/loop/diagnostic-agent";
import type { DiagnosisInput } from "@/harness/types";
import { v4 as uuidv4 } from "uuid";

export const maxDuration = 300;

interface DiagnoseRequestBody {
  symptoms?: string;
  vin?: string;
  dtcs?: string;
  mileage?: string;
}

function parseBody(body: DiagnoseRequestBody): DiagnosisInput {
  const symptoms = body.symptoms?.trim() ?? "";
  const vin = body.vin?.trim() || undefined;
  const dtcsFromField = body.dtcs ? parseDtcList(body.dtcs) : [];
  const dtcsFromSymptoms = parseDtcList(symptoms);
  const dtcs = [...new Set([...dtcsFromField, ...dtcsFromSymptoms])];

  return {
    symptoms,
    vin,
    dtcs: dtcs.length > 0 ? dtcs : undefined,
    mileage: body.mileage?.trim() || undefined,
  };
}

export async function POST(request: Request) {
  let body: DiagnoseRequestBody;
  try {
    body = (await request.json()) as DiagnoseRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = parseBody(body);
  if (!input.symptoms) {
    return Response.json({ error: "Symptoms description is required" }, { status: 400 });
  }

  const requestId = uuidv4();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const result = await runDiagnosis(
          input,
          (event) => {
            send(event);
          },
          requestId,
        );

        send({
          type: "complete",
          diagnosis: result.diagnosis,
          markdown: result.markdown,
          trace: result.trace,
          outcome: result.outcome,
        });
      } catch (error) {
        send({
          type: "error",
          message:
            error instanceof Error ? error.message : "Diagnosis failed unexpectedly",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
