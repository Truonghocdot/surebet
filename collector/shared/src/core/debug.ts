import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";

const debugDir = path.resolve("tmp/session/debug");

export async function writeDebugArtifacts(page: Page, tag: string) {
  await mkdir(debugDir, { recursive: true });
  const safeTag = tag.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();

  if (page.isClosed()) {
    return;
  }

  await page.screenshot({
    path: path.join(debugDir, `${safeTag}.png`),
    fullPage: true
  }).catch(() => undefined);

  await writeFile(path.join(debugDir, `${safeTag}.html`), await page.content(), "utf8").catch(
    () => undefined
  );
}

export function formatError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}
