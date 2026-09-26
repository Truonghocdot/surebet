import type { LaunchOptions } from "playwright";
import { envBool, envInt } from "./env.js";

export function collectorLaunchOptions(defaultHeadless = true): LaunchOptions {
  const headless = envBool("COLLECTOR_HEADLESS", defaultHeadless);
  const slowMo = envInt("COLLECTOR_SLOWMO", headless ? 0 : 150);
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--disable-gpu",
    "--start-maximized",
  ];
  if (envBool("COLLECTOR_SINGLE_PROCESS", false)) {
    args.push("--single-process");
  }

  return {
    headless,
    slowMo,
    args
  };
}
