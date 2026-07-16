import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page, Response, WebSocket as PlaywrightWebSocket } from "playwright";
import { envBool, envInt, envString } from "../core/env.js";

type EightXBetTrafficKind = "http_response" | "websocket_received" | "websocket_sent";

type EightXBetTrafficRecord = {
  recorded_at: string;
  kind: EightXBetTrafficKind;
  url: string;
  resource_type?: string;
  status?: number;
  content_type?: string;
  payload_bytes: number;
  payload_sha256: string;
  payload_encoding: "utf8" | "binary";
  payload_sample?: string;
  sample_truncated: boolean;
};

const sensitiveKeyPattern = /authorization|bearer|cookie|credential|jwt|key|password|secret|session|signature|token/i;
const likelyTextContentPattern = /json|javascript|text|xml|html|event-stream|urlencoded/i;

export class EightXBetTrafficRecorder {
  private readonly enabled = envBool("EIGHTXBET_TRAFFIC_RECORDER", false);
  private readonly startedAt = Date.now();
  private readonly durationMs = Math.max(
    envInt("EIGHTXBET_TRAFFIC_DURATION_MS", 5 * 60 * 60_000),
    60_000
  );
  private readonly maxSampleBytes = Math.max(
    envInt("EIGHTXBET_TRAFFIC_SAMPLE_BYTES", 8 * 1024),
    0
  );
  private readonly outputPath = path.resolve(
    envString(
      "EIGHTXBET_TRAFFIC_FILE",
      `tmp/collector/traffic/eightxbet-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`
    )
  );
  private writeQueue = Promise.resolve();
  private announced = false;

  attach(page: Page) {
    if (!this.enabled) {
      return () => undefined;
    }

    this.announce();
    const onResponse = (response: Response) => {
      const resourceType = response.request().resourceType();
      if (
        (resourceType !== "xhr" && resourceType !== "fetch") ||
        !isSportsTrafficURL(response.url()) ||
        !this.isActive()
      ) {
        return;
      }
      void this.recordResponse(response);
    };
    const onWebSocket = (socket: PlaywrightWebSocket) => {
      if (!isSportsWebSocketURL(socket.url())) {
        return;
      }
      socket.on("framereceived", (event) => {
        if (this.isActive()) {
          this.enqueuePayload("websocket_received", socket.url(), event.payload);
        }
      });
      socket.on("framesent", (event) => {
        if (this.isActive()) {
          this.enqueuePayload("websocket_sent", socket.url(), event.payload);
        }
      });
    };

    page.on("response", onResponse);
    page.on("websocket", onWebSocket);

    return () => {
      page.off("response", onResponse);
      page.off("websocket", onWebSocket);
    };
  }

  async flush() {
    await this.writeQueue;
  }

  private async recordResponse(response: Response) {
    const contentType = response.headers()["content-type"] ?? "";
    const payload = await response.body().catch(() => Buffer.alloc(0));
    this.enqueuePayload("http_response", response.url(), payload, {
      resourceType: response.request().resourceType(),
      status: response.status(),
      contentType
    });
  }

  private enqueuePayload(
    kind: EightXBetTrafficKind,
    rawURL: string,
    rawPayload: string | Buffer,
    metadata: {
      resourceType?: string;
      status?: number;
      contentType?: string;
    } = {}
  ) {
    const payload = Buffer.isBuffer(rawPayload) ? rawPayload : Buffer.from(rawPayload);
    const textPayload = decodeTextPayload(payload, metadata.contentType ?? "");
    const sample = textPayload === null ? undefined : redactPayload(textPayload, this.maxSampleBytes);
    const record: EightXBetTrafficRecord = {
      recorded_at: new Date().toISOString(),
      kind,
      url: redactURL(rawURL),
      resource_type: metadata.resourceType,
      status: metadata.status,
      content_type: metadata.contentType,
      payload_bytes: payload.byteLength,
      payload_sha256: createHash("sha256").update(payload).digest("hex"),
      payload_encoding: textPayload === null ? "binary" : "utf8",
      payload_sample: sample?.value,
      sample_truncated: sample?.truncated ?? false
    };

    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(path.dirname(this.outputPath), { recursive: true });
        await appendFile(this.outputPath, `${JSON.stringify(record)}\n`, "utf8");
      })
      .catch((error) => {
        console.warn("[8xbet-traffic] recorder write failed:", error);
      });
  }

  private announce() {
    if (this.announced) {
      return;
    }
    this.announced = true;
    console.log(`[8xbet-traffic] recording redacted traffic to ${this.outputPath}`);
  }

  private isActive() {
    return this.enabled && Date.now() - this.startedAt <= this.durationMs;
  }
}

function decodeTextPayload(payload: Buffer, contentType: string) {
  if (payload.length === 0) {
    return "";
  }
  if (likelyTextContentPattern.test(contentType)) {
    return payload.toString("utf8");
  }

  const sample = payload.subarray(0, Math.min(payload.length, 512));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
      printable += 1;
    }
  }
  return printable / sample.length >= 0.85 ? payload.toString("utf8") : null;
}

function redactPayload(value: string, maxBytes: number) {
  let redacted: string;
  try {
    redacted = JSON.stringify(redactJSONValue(JSON.parse(value)));
  } catch {
    redacted = redactText(value);
  }

  const buffer = Buffer.from(redacted);
  if (buffer.length <= maxBytes) {
    return { value: redacted, truncated: false };
  }
  return {
    value: buffer.subarray(0, maxBytes).toString("utf8"),
    truncated: true
  };
}

function redactJSONValue(value: unknown, key = ""): unknown {
  if (sensitiveKeyPattern.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJSONValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactJSONValue(childValue, childKey)
      ])
    );
  }
  if (typeof value === "string") {
    return redactText(value);
  }
  return value;
}

function redactText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(
      /(["']?(?:authorization|cookie|credential|jwt|key|password|secret|session|signature|token)["']?\s*[:=]\s*["']?)[^"'&,\s}]+/gi,
      "$1[REDACTED]"
    );
}

function redactURL(value: string) {
  try {
    const parsed = new URL(value);
    for (const [key, queryValue] of parsed.searchParams.entries()) {
      if (sensitiveKeyPattern.test(key) || isOpaqueValue(queryValue)) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }
    return parsed.toString();
  } catch {
    return redactText(value);
  }
}

function isOpaqueValue(value: string) {
  return value.length > 32 && !/^\d+$/.test(value);
}

function isSportsTrafficURL(value: string) {
  const url = value.toLowerCase();
  return (
    url.includes("/product/business/sport/") ||
    url.includes("/topic/odds-diff/") ||
    url.includes("/websocket/ws")
  );
}

function isSportsWebSocketURL(value: string) {
  return /gw-nwwss/i.test(value) && value.includes("/websocket/ws");
}
