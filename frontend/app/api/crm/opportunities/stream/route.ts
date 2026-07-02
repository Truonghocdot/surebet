import { fetchBackendOpportunities } from "@/lib/server-dashboard-data";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const pollMs = 2_000;
const heartbeatMs = 15_000;

export async function GET(request: Request) {
  let closed = false;
  let lastPayload = "";
  let lastHeartbeatAt = 0;
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let interval: ReturnType<typeof setInterval> | null = null;
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        controller.close();
      };
      cleanup = close;

      const tick = async () => {
        if (closed) {
          return;
        }

        try {
          const opportunities = await fetchBackendOpportunities();
          const payload = JSON.stringify(opportunities);
          if (payload !== lastPayload) {
            lastPayload = payload;
            send("opportunities", opportunities);
          } else if (Date.now() - lastHeartbeatAt >= heartbeatMs) {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
            lastHeartbeatAt = Date.now();
          }
        } catch (error) {
          send("stream-error", {
            message:
              error instanceof Error
                ? error.message
                : "Không stream được dữ liệu surebet."
          });
        }
      };

      void tick();
      interval = setInterval(() => {
        void tick();
      }, pollMs);

      request.signal.addEventListener("abort", close);
    },
    cancel() {
      cleanup();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
