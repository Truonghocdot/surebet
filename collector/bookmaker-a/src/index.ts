import {
  BaseCollector,
  EightXBetRuntime,
  StaticSettingsProvider,
  type Collector
} from "@surebet/collector-shared";

export class EightXBetCollector implements Collector {
  private readonly base = new BaseCollector(
    new EightXBetRuntime("8xbet"),
    {
      settings: new StaticSettingsProvider({
        "8xbet": {
          bookmakerCode: "8xbet",
          bookmakerName: "8xbet",
          url: "https://8xbet.example.com",
          username: "8xbet.ops.primary",
          password: "Dev8xbet123!"
        },
        jun88: {
          bookmakerCode: "jun88",
          bookmakerName: "jun88",
          url: "https://jun88.example.com",
          username: "jun88.ops.primary",
          password: "DevJun88123!"
        }
      })
    },
    "8xbet",
    "default"
  );

  async collect() {
    return this.base.collect();
  }
}
