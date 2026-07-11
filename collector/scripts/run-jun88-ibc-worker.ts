import { runJun88LobbyWorker } from "./run-jun88-lobby-worker.js";

runJun88LobbyWorker("saba").catch((error) => {
  console.error("[jun88-saba-worker] fatal:", error);
  process.exit(1);
});
