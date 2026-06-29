import {
  BaseCollector,
  createBackendSettingsProvider,
  EightXBetRuntime,
  type Collector
} from "@surebet/collector-shared";

export class EightXBetCollector implements Collector {
  private readonly base = new BaseCollector(
    new EightXBetRuntime("8xbet"),
    {
      settings: createBackendSettingsProvider()
    },
    "8xbet",
    "default"
  );

  async collect() {
    return this.base.collect();
  }
}
