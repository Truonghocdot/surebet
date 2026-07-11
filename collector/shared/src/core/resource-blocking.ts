import type { BrowserContext } from "playwright";
import { envBool, envString } from "./env.js";

const DEFAULT_BLOCKED_RESOURCE_TYPES = "image,media,font";

export async function installCollectorResourceBlocking(context: BrowserContext) {
  if (!envBool("COLLECTOR_BLOCK_HEAVY_RESOURCES", true)) {
    return;
  }

  const blockedTypes = new Set(
    envString("COLLECTOR_BLOCK_RESOURCE_TYPES", DEFAULT_BLOCKED_RESOURCE_TYPES)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );

  if (blockedTypes.size === 0) {
    return;
  }

  await context.route("**/*", async (route) => {
    if (blockedTypes.has(route.request().resourceType())) {
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }

    await route.continue().catch(() => undefined);
  });
}
