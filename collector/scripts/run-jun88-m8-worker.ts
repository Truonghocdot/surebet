import { runJun88LobbyWorker } from "./run-jun88-lobby-worker.js";

runJun88LobbyWorker("m8").catch((error) => {
  console.error("[jun88-m8-worker] fatal:", error);
  process.exit(1);
});
