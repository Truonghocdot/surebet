import {
  BaseCollector,
  createBackendSettingsProvider,
  EightXBetRuntime,
  EightXBetSessionBootstrapper,
  FileSessionStateStore,
  type Collector
} from "@surebet/collector-shared";
import path from "node:path";

export class EightXBetCollector implements Collector {
  private readonly sessionBootstrapper = new EightXBetSessionBootstrapper({
    stateStore: new FileSessionStateStore(path.resolve("tmp/session"))
  });

  private readonly base = new BaseCollector(
    new EightXBetRuntime("8xbet"),
    {
      settings: createBackendSettingsProvider(),
      sessionBootstrapper: this.sessionBootstrapper
    },
    "8xbet",
    "default"
  );

  async collect() {
    return this.base.collect();
  }
}
