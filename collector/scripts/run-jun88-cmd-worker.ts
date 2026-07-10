import { runJun88LobbyWorker } from "./run-jun88-lobby-worker.js";

runJun88LobbyWorker("cmd").catch((error) => {
  console.error("[jun88-cmd-worker] fatal:", error);
  process.exit(1);
});
