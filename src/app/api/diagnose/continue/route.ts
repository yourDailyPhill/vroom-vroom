import { CheckpointStore } from "@/harness/checkpoints/store";
import { resolveAgent } from "@/harness/agents/registry";
import { runHarness } from "@/harness/core/harness";
import { v4 as uuidv4 } from "uuid";

export const maxDuration = 300;

interface ContinueRequestBody {
  requestId?: string;
  answers?: Record<string, string>;
  agent?: string;
}

function createSseStream(
  run: (
    send: (data: Record<string, unknown>) => void,
  ) => Promise<void>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        await run(send);
      } catch (error) {
        send({
          type: "error",
          message:
            error instanceof Error ? error.message : "Continuation failed unexpectedly",
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

export async function POST(request: Request) {
  let body: ContinueRequestBody;
  try {
    body = (await request.json()) as ContinueRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.requestId) {
    return Response.json({ error: "requestId is required" }, { status: 400 });
  }

  if (!body.answers || Object.keys(body.answers).length === 0) {
    return Response.json({ error: "answers are required" }, { status: 400 });
  }

  const runState = CheckpointStore.getRun(body.requestId);
  if (!runState) {
    return Response.json(
      { error: "No checkpoint state found for this requestId" },
      { status: 404 },
    );
  }

  let agent;
  try {
    agent = resolveAgent(body.agent ?? runState.agentId);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid agent" },
      { status: 400 },
    );
  }

  const continuationId = uuidv4();

  return createSseStream(async (send) => {
    const result = await runHarness(
      runState.input,
      agent,
      (event) => {
        send(event);
      },
      continuationId,
      {
        replayRequestId: body.requestId,
        replayFromCheckpoint: "material_ready",
        humanAnswers: body.answers,
        skipStages: ["input_valid"],
      },
    );

    send({
      type: "complete",
      diagnosis: result.diagnosis,
      markdown: result.markdown,
      trace: result.trace,
      outcome: result.outcome,
      escalation: result.escalation,
      requestId: continuationId,
      continuedFrom: body.requestId,
    });
  });
}
