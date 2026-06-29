import type { CollectContext, CollectorRuntime } from "../contracts.js";
import { createEmptySnapshot } from "../core/create-empty-snapshot.js";

export class EightXBetRuntime implements CollectorRuntime {
  constructor(private readonly collectorId: string) {}

  async collect(_context: CollectContext) {
    return createEmptySnapshot(this.collectorId, "8xbet", "default");
  }
}

