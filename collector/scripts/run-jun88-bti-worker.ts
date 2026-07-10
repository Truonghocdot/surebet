import { runJun88LobbyWorker } from "./run-jun88-lobby-worker.js";

runJun88LobbyWorker("bti").catch((error) => {
  console.error("[jun88-bti-worker] fatal:", error);
  process.exit(1);
});
