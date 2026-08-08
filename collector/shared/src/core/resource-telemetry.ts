import { monitorEventLoopDelay } from "node:perf_hooks";

export type CollectorResourceTelemetry = {
  rssMb: number;
  heapUsedMb: number;
  externalMb: number;
  eventLoopP95Ms: number;
  observerScanMs: number;
  observerRowsScanned: number;
  reconcileParseMs: number;
};

type CollectorResourceDetails = Pick<
  CollectorResourceTelemetry,
  "observerScanMs" | "observerRowsScanned" | "reconcileParseMs"
>;

const detailsByCollector = new Map<string, CollectorResourceDetails>();

export function updateCollectorResourceTelemetry(
  collectorId: string,
  details: Partial<CollectorResourceDetails>
) {
  const current = detailsByCollector.get(collectorId) ?? {
    observerScanMs: 0,
    observerRowsScanned: 0,
    reconcileParseMs: 0
  };
  detailsByCollector.set(collectorId, { ...current, ...details });
}

export function startCollectorResourceTelemetry(
  collectorId: string,
  intervalMs = 60_000
) {
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();
  const timer = setInterval(() => {
    const memory = process.memoryUsage();
    const telemetry: CollectorResourceTelemetry = {
      rssMb: toMb(memory.rss),
      heapUsedMb: toMb(memory.heapUsed),
      externalMb: toMb(memory.external),
      eventLoopP95Ms: Number((eventLoop.percentile(95) / 1_000_000).toFixed(1)),
      ...(detailsByCollector.get(collectorId) ?? {
        observerScanMs: 0,
        observerRowsScanned: 0,
        reconcileParseMs: 0
      })
    };
    console.log(
      `[${collectorId}-worker] resources` +
        ` rss_mb=${telemetry.rssMb}` +
        ` heap_used_mb=${telemetry.heapUsedMb}` +
        ` external_mb=${telemetry.externalMb}` +
        ` event_loop_p95_ms=${telemetry.eventLoopP95Ms}` +
        ` observer_scan_ms=${telemetry.observerScanMs}` +
        ` observer_rows_scanned=${telemetry.observerRowsScanned}` +
        ` reconcile_parse_ms=${telemetry.reconcileParseMs}`
    );
    eventLoop.reset();
  }, Math.max(intervalMs, 10_000));
  timer.unref();

  return () => {
    clearInterval(timer);
    eventLoop.disable();
    detailsByCollector.delete(collectorId);
  };
}

function toMb(bytes: number) {
  return Number((bytes / 1024 / 1024).toFixed(1));
}
