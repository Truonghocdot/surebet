import type { LaunchOptions } from "playwright";
import { envBool, envInt } from "./env.js";
import { resolveCollectorProxy } from "./proxy.js";

export async function collectorLaunchOptions(defaultHeadless = true): Promise<LaunchOptions> {
  const headless = envBool("COLLECTOR_HEADLESS", defaultHeadless);
  const slowMo = envInt("COLLECTOR_SLOWMO", headless ? 0 : 150);
  const proxy = await resolveCollectorProxy();
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--disable-gpu"
  ];
  if (envBool("COLLECTOR_SINGLE_PROCESS", false)) {
    args.push("--single-process");
  }

  return {
    headless,
    slowMo,
    proxy,
    args
  };
}
