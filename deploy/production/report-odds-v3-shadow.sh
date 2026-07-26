#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-${SCRIPT_DIR}/.env}"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"

read -r -d '' LUA_SCRIPT <<'LUA' || true
local function number_field(values, name)
  return tonumber(values[name] or "0") or 0
end

local function hash_values(key)
  local raw = redis.call("HGETALL", key)
  local values = {}
  for index = 1, #raw, 2 do
    values[raw[index]] = raw[index + 1]
  end
  return values
end

local function rounded(value, digits)
  local factor = 10 ^ digits
  return math.floor(value * factor + 0.5) / factor
end

local cursor = "0"
local keys = {}
local seen_keys = {}
repeat
  local scan = redis.call("SCAN", cursor, "MATCH", "odds:v3:shadow:metrics:*", "COUNT", 100)
  cursor = scan[1]
  for _, key in ipairs(scan[2]) do
    if not seen_keys[key] then
      seen_keys[key] = true
      table.insert(keys, key)
    end
  end
until cursor == "0"
for _, source in ipairs({"8xbet:default", "jun88:cmd"}) do
  local key = "odds:v3:shadow:metrics:" .. source
  if not seen_keys[key] then
    table.insert(keys, key)
  end
end
table.sort(keys)

local now_ms = tonumber(redis.call("TIME")[1]) * 1000
local reports = {}
for _, key in ipairs(keys) do
  local values = hash_values(key)
  local source = string.sub(key, string.len("odds:v3:shadow:metrics:") + 1)
  local window_key = "odds:v3:shadow:window:" .. source
  local samples = redis.call("ZRANGE", window_key, 0, -1)
  local latencies = {}
  for _, encoded in ipairs(samples) do
    local ok, sample = pcall(cjson.decode, encoded)
    if ok and sample and tonumber(sample.latency_ms) then
      table.insert(latencies, tonumber(sample.latency_ms))
    end
  end
  table.sort(latencies)
  local p95 = 0
  if #latencies > 0 then
    p95 = latencies[math.max(1, math.ceil(#latencies * 0.95))]
  end

  local accepted = number_field(values, "accepted_batches")
  local complete = number_field(values, "complete_batches")
  local compared = number_field(values, "compared_outcomes")
  local mismatched = number_field(values, "mismatched_outcomes")
  local missing_legacy = number_field(values, "missing_legacy_outcomes")
  local missing_coherent = number_field(values, "missing_coherent_outcomes")
  local first_ms = number_field(values, "first_recorded_at_ms")
  local monitoring_days = first_ms > 0 and (now_ms - first_ms) / 86400000 or 0
  local complete_rate = accepted > 0 and complete / accepted * 100 or 0
  local comparison_total = compared + missing_legacy + missing_coherent
  local divergent = mismatched + missing_legacy + missing_coherent
  local mismatch_rate = comparison_total > 0 and divergent / comparison_total * 100 or 100
  local blockers = {}
  if monitoring_days < 7 then table.insert(blockers, "monitoring_under_7_days") end
  if accepted < 20 then table.insert(blockers, "accepted_batches_under_20") end
  if complete_rate < 100 then table.insert(blockers, "incomplete_batches") end
  if mismatch_rate >= 0.1 then table.insert(blockers, "mismatch_rate_not_below_0.1_percent") end
  if #latencies < 20 then table.insert(blockers, "latency_samples_under_20_in_30m") end
  if p95 > 500 then table.insert(blockers, "p95_latency_over_500ms") end

  table.insert(reports, {
    source = source,
    monitoring_days = rounded(monitoring_days, 2),
    accepted_batches = accepted,
    complete_rate_pct = rounded(complete_rate, 4),
    compared_outcomes = compared,
    mismatched_outcomes = mismatched,
    mismatch_rate_pct = rounded(mismatch_rate, 4),
    missing_legacy_outcomes = missing_legacy,
    missing_coherent_outcomes = missing_coherent,
    p95_latency_ms_30m = p95,
    latency_samples_30m = #latencies,
    accepted_observations = number_field(values, "accepted_observations"),
    rejected_observations = number_field(values, "rejected_observations"),
    legacy_bridge_quotes = number_field(values, "legacy_bridge_quotes"),
    ready_for_v2 = #blockers == 0,
    blockers = blockers
  })
end

return cjson.encode(reports)
LUA

REPORT="$({
  docker compose \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    exec -T redis redis-cli --raw EVAL "${LUA_SCRIPT}" 0
})"

if command -v jq >/dev/null 2>&1; then
  printf '%s\n' "${REPORT}" | jq .
else
  printf '%s\n' "${REPORT}"
fi
