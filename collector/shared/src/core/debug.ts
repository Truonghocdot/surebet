import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";

const debugDir = path.resolve("tmp/collector/debug");

type DebugArtifactOptions = {
  silent?: boolean;
};

export async function writeDebugArtifacts(page: Page, tag: string, options: DebugArtifactOptions = {}) {
  await mkdir(debugDir, { recursive: true });
  const safeTag = tag.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();

  if (page.isClosed()) {
    return;
  }

  const screenshotPath = path.join(debugDir, `${safeTag}.png`);
  await page.screenshot({
    path: screenshotPath,
    fullPage: true
  }).catch(() => undefined);

  let htmlPath: string | null = null;
  const html = await page.content().catch(() => "");
  if (html) {
    htmlPath = path.join(debugDir, `${safeTag}.html`);
    await writeFile(htmlPath, html, "utf8").catch(() => undefined);
  }

  if (!options.silent) {
    console.warn(
      `[collector-debug] saved artifacts for ${safeTag}: screenshot=${screenshotPath}${htmlPath ? ` html=${htmlPath}` : ""}`
    );
  }
}

export async function writeContextDebugArtifacts(context: BrowserContext, tag: string) {
  await mkdir(debugDir, { recursive: true });
  const safeTag = tag.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();

  const pages = context.pages();
  if (pages.length === 0) {
    return;
  }

  const indexPath = path.join(debugDir, `${safeTag}.json`);
  await writeFile(
    indexPath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        pages: pages.map((page, index) => ({
          index,
          closed: page.isClosed(),
          url: safePageURL(page)
        }))
      },
      null,
      2
    ),
    "utf8"
  ).catch(() => undefined);

  await Promise.all(
    pages.map((page, index) =>
      writeDebugArtifacts(page, `${safeTag}-page-${index}`, { silent: true })
    )
  );

  console.warn(
    `[collector-debug] saved context artifacts for ${safeTag}: index=${indexPath} pages=${pages.length} dir=${debugDir}`
  );
}

export function formatError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

function safePageURL(page: Page) {
  try {
    return page.url();
  } catch {
    return "about:blank";
  }
}
