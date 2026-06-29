import type {
  CollectContext,
  CollectorRuntime,
  LobbyCode
} from "../contracts.js";
import { createEmptySnapshot } from "../core/create-empty-snapshot.js";

export class Jun88LobbyRuntime implements CollectorRuntime {
  constructor(
    private readonly collectorId: string,
    private readonly lobbyId: Exclude<LobbyCode, "default">
  ) {}

  async collect(context: CollectContext) {
    if (!context.session) {
      throw new Error(`Jun88 collector ${this.collectorId} requires a shared session.`);
    }

    if (!context.session.accessibleLobbies.includes(this.lobbyId)) {
      throw new Error(
        `Jun88 lobby ${this.lobbyId} is not available in the prepared shared session.`
      );
    }

    return createEmptySnapshot(this.collectorId, "jun88", this.lobbyId);
  }
}

