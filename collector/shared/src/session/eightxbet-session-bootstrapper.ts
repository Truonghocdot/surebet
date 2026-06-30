import { access } from "node:fs/promises";
import type {
  BookmakerSetting,
  SessionBootstrapper,
  SessionState,
  SessionStateStore
} from "../contracts.js";

type EightXBetBootstrapOptions = {
  stateStore: SessionStateStore;
};

export class EightXBetSessionBootstrapper implements SessionBootstrapper {
  constructor(private readonly options: EightXBetBootstrapOptions) {}

  async prepare(setting: BookmakerSetting): Promise<SessionState> {
    const existing = await this.options.stateStore.read("8xbet");
    if (existing) {
      await access(existing.storageStatePath);
      if (existing.sessionStoragePath) {
        await access(existing.sessionStoragePath);
      }
      return existing;
    }

    throw new Error(
      [
        `8xbet session is missing for ${setting.bookmakerName}.`,
        'Run "npm run bootstrap:8xbet" first to create a storage state file.'
      ].join(" ")
    );
  }
}
