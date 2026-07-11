import type { LaunchOptions } from "playwright";
import { envBool, envInt } from "./env.js";
import { resolveCollectorProxy } from "./proxy.js";

export async function collectorLaunchOptions(defaultHeadless = true): Promise<LaunchOptions> {
  const headless = envBool("COLLECTOR_HEADLESS", defaultHeadless);
  const slowMo = envInt("COLLECTOR_SLOWMO", headless ? 0 : 150);
  const proxy = await resolveCollectorProxy();

  return {
    headless,
    slowMo,
    proxy
  };
}
