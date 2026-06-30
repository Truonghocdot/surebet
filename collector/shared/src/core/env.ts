import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let loaded = false;

export function loadCollectorEnv() {
  if (loaded) {
    return;
  }

  loaded = true;

  for (const candidate of envCandidates(process.cwd())) {
    if (!existsSync(candidate)) {
      continue;
    }

    const content = readFileSync(candidate, "utf8");
    applyEnvFile(content);
    return;
  }
}

export function envString(key: string, fallback: string) {
  loadCollectorEnv();
  return process.env[key] || fallback;
}

export function envBool(key: string, fallback: boolean) {
  loadCollectorEnv();
  const raw = process.env[key];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(raw);
}

export function envInt(key: string, fallback: number) {
  loadCollectorEnv();
  const raw = process.env[key];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function envCandidates(start: string) {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (let current = start; ; current = path.dirname(current)) {
    for (const candidate of [
      path.join(current, ".env"),
      path.join(current, "collector", ".env")
    ]) {
      if (seen.has(candidate)) {
        continue;
      }

      seen.add(candidate);
      candidates.push(candidate);
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
  }

  return candidates;
}

function applyEnvFile(content: string) {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = stripQuotes(rawValue);
  }
}

function stripQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
