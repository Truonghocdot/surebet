import { runJun88LobbyWorker } from "./run-jun88-lobby-worker.js";

runJun88LobbyWorker("m9bet").catch((error) => {
  console.error("[jun88-m9bet-worker] fatal:", error);
  process.exit(1);
});
