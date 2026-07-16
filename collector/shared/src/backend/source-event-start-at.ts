import type { CollectorSource } from "../contracts.js";

const MINUTES_PER_HOUR = 60;

export function normalizeSourceEventStartAt(
  source: CollectorSource,
  rawValue: string | undefined,
  collectedAt: string
) {
  const raw = rawValue?.trim() ?? "";
  if (raw === "") {
    return "";
  }

  const absolute = parseAbsoluteDate(raw);
  if (absolute) {
    return absolute.toISOString();
  }

  const offsetMinutes = sourceTimeZoneOffsetMinutes(source);
  if (offsetMinutes === null) {
    return raw;
  }

  const collectedAtDate = new Date(collectedAt);
  if (Number.isNaN(collectedAtDate.getTime())) {
    return raw;
  }

  const normalized = normalizeSourceLocalDateTime(raw);
  const localCollectedAt = new Date(collectedAtDate.getTime() + offsetMinutes * 60_000);

  const fullDateTime =
    parseDayMonthDateTime(normalized, localCollectedAt, offsetMinutes) ??
    parseTimeOnlyDateTime(normalized, localCollectedAt, offsetMinutes);

  return fullDateTime ? fullDateTime.toISOString() : raw;
}

function parseAbsoluteDate(value: string) {
  if (!/[zZ]|[+-]\d{2}:\d{2}/.test(value) && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sourceTimeZoneOffsetMinutes(source: CollectorSource) {
  if (source.bookmakerId === "8xbet" && source.lobbyId === "default") {
    return 7 * MINUTES_PER_HOUR;
  }

  if (source.bookmakerId === "jun88" && source.lobbyId === "cmd") {
    return 8 * MINUTES_PER_HOUR;
  }

  return null;
}

function normalizeSourceLocalDateTime(value: string) {
  return value
    .replace(/(\d{1,2}[-/]\d{1,2})(\d{1,2}:\d{2}(?::\d{2})?)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDayMonthDateTime(
  value: string,
  localCollectedAt: Date,
  offsetMinutes: number
) {
  const match = value.match(
    /^(\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?$/i
  );
  if (!match) {
    return null;
  }

  const [, dayText, monthText, hourText, minuteText, secondText, ampm] = match;
  const day = Number.parseInt(dayText, 10);
  const month = Number.parseInt(monthText, 10);
  let hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  const second = Number.parseInt(secondText || "0", 10);

  if (ampm) {
    const marker = ampm.toLowerCase();
    if (marker === "pm" && hour < 12) {
      hour += 12;
    } else if (marker === "am" && hour === 12) {
      hour = 0;
    }
  }

  let year = localCollectedAt.getUTCFullYear();
  let candidate = buildUTCFromLocalParts(year, month, day, hour, minute, second, offsetMinutes);
  const halfYearMs = 183 * 24 * 60 * 60 * 1000;
  const diffMs = candidate.getTime() - localCollectedAt.getTime();

  if (diffMs > halfYearMs) {
    year -= 1;
    candidate = buildUTCFromLocalParts(year, month, day, hour, minute, second, offsetMinutes);
  } else if (diffMs < -halfYearMs) {
    year += 1;
    candidate = buildUTCFromLocalParts(year, month, day, hour, minute, second, offsetMinutes);
  }

  return candidate;
}

function parseTimeOnlyDateTime(
  value: string,
  localCollectedAt: Date,
  offsetMinutes: number
) {
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?$/i);
  if (!match) {
    return null;
  }

  const [, hourText, minuteText, secondText, ampm] = match;
  let hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  const second = Number.parseInt(secondText || "0", 10);

  if (ampm) {
    const marker = ampm.toLowerCase();
    if (marker === "pm" && hour < 12) {
      hour += 12;
    } else if (marker === "am" && hour === 12) {
      hour = 0;
    }
  }

  return buildUTCFromLocalParts(
    localCollectedAt.getUTCFullYear(),
    localCollectedAt.getUTCMonth() + 1,
    localCollectedAt.getUTCDate(),
    hour,
    minute,
    second,
    offsetMinutes
  );
}

function buildUTCFromLocalParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  offsetMinutes: number
) {
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000
  );
}
