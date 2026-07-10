import { runJun88LobbyWorker } from "./run-jun88-lobby-worker.js";

runJun88LobbyWorker("ibc").catch((error) => {
  console.error("[jun88-ibc-worker] fatal:", error);
  process.exit(1);
});
