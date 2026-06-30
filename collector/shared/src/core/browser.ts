import type { LaunchOptions } from "playwright";
import { envBool, envInt } from "./env.js";

export function collectorLaunchOptions(defaultHeadless = true): LaunchOptions {
  const headless = envBool("COLLECTOR_HEADLESS", defaultHeadless);
  const slowMo = envInt("COLLECTOR_SLOWMO", headless ? 0 : 150);

  return {
    headless,
    slowMo
  };
}
