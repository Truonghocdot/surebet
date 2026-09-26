import { z } from "zod";

const optionalTimestampSchema = z.string().nullish();

export const autoBetActionStatusSchema = z.enum([
  "selecting",
  "ready",
  "placing_jun88",
  "jun88_ticket_received",
  "placing_8xbet",
  "completed",
  "awaiting_odds_confirmation",
  "exposure_open",
  "submission_unknown",
  "selection_rejected",
  "failed",
  "aborted_no_exposure",
  "unhedged_closed",
  "dry_run_completed"
]);

export const betExposureStatusSchema = z.enum([
  "exposure_open",
  "hedging",
  "submission_unknown",
  "completed",
  "unhedged_closed",
  "manual_review"
]);

export const betAttemptStatusSchema = z.enum([
  "before_send",
  "submit_started",
  "response_received",
  "awaiting_reconcile"
]);

export const autoBetActionLegSchema = z.object({
  leg_id: z.string(),
  sequence: z.number().int(),
  bookmaker_id: z.string(),
  lobby_id: z.string(),
  fixture_id: z.string(),
  market_id: z.string(),
  outcome_id: z.string(),
  outcome_name: z.string(),
  provider_reference: z.string().optional(),
  confirmed_odds: z.number(),
  selected_odds: z.number().optional(),
  stake_vnd: z.number().int().nonnegative(),
  status: z.string(),
  ticket_id: z.string().optional(),
  accepted_odds: z.number().optional(),
  offered_odds: z.number().optional(),
  error: z.string().optional()
});

export const autoBetActionSchema = z.object({
  action_id: z.string(),
  idempotency_key: z.string().optional(),
  opportunity_id: z.string(),
  account_id: z.string().optional(),
  confirmation_revision: z.string().optional(),
  mode: z.string(),
  status: autoBetActionStatusSchema,
  currency: z.string().default("VND"),
  total_stake_vnd: z.number().int().nonnegative(),
  expected_return: z.number().optional().default(0),
  legs: z.array(autoBetActionLegSchema).optional().default([]),
  exposure_open: z.boolean().optional().default(false),
  exposure_id: z.string().optional(),
  reprice_revision: z.number().int().nonnegative().optional().default(0),
  reserved_stake_vnd: z.number().int().nonnegative().optional().default(0),
  version: z.number().int().nonnegative().optional().default(0),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: optionalTimestampSchema,
  error_code: z.string().optional(),
  error_message: z.string().optional()
});

export const betExposureSchema = z.object({
  exposure_id: z.string(),
  action_id: z.string(),
  account_id: z.string(),
  status: betExposureStatusSchema,
  currency: z.string().default("VND"),
  version: z.number().int().nonnegative().optional().default(0),
  jun88_ticket_id: z.string(),
  jun88_provider_reference: z.string().optional().default(""),
  jun88_accepted_odds: z.number(),
  jun88_stake_vnd: z.number().int().nonnegative(),
  jun88_accepted_at: z.string(),
  hedge_provider_reference: z.string().optional().default(""),
  current_hedge_odds: z.number().optional().default(0),
  required_hedge_stake_vnd: z.number().int().nonnegative().optional().default(0),
  projected_jun_profit_vnd: z.number().int().optional().default(0),
  projected_hedge_profit_vnd: z.number().int().optional().default(0),
  last_quote_observed_at: optionalTimestampSchema,
  hedge_attempt_id: z.string().optional(),
  hedge_ticket_id: z.string().optional(),
  opened_at: z.string(),
  completed_at: optionalTimestampSchema,
  closed_at: optionalTimestampSchema,
  market_closed_at: optionalTimestampSchema,
  last_failure_code: z.string().optional(),
  last_failure_message: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
});

export const autoBetRuntimeSchema = z.object({
  state: z.enum(["disabled", "simulation", "dry_run", "canary", "misconfigured", "unknown"]),
  live_enabled: z.boolean().nullable(),
  commit_enabled: z.boolean().nullable(),
  account_configured: z.boolean(),
  total_stake_vnd: z.number().int().nonnegative().nullable()
});

const flatCollectorAccountBalanceSchema = z.object({
  account_id: z.string(),
  collector_id: z.string(),
  bookmaker_id: z.string(),
  lobby_id: z.string(),
  amount: z.number().finite(),
  currency: z.string(),
  amount_vnd: z.number().finite().optional(),
  display_text: z.string().optional(),
  observed_at: z.string(),
  received_at: z.string(),
  stale: z.boolean()
});

const nestedCollectorAccountBalanceSchema = z.object({
  account_id: z.string(),
  source: z.object({
    collector_id: z.string(),
    bookmaker_id: z.string(),
    lobby_id: z.string()
  }),
  balance: z.object({
    amount: z.number().finite(),
    currency: z.string(),
    amount_vnd: z.number().finite().optional(),
    display_text: z.string().optional()
  }),
  observed_at: z.string(),
  received_at: z.string(),
  stale: z.boolean()
});

export const collectorAccountBalanceSchema = z.union([
  flatCollectorAccountBalanceSchema,
  nestedCollectorAccountBalanceSchema.transform((item) => ({
    account_id: item.account_id,
    collector_id: item.source.collector_id,
    bookmaker_id: item.source.bookmaker_id,
    lobby_id: item.source.lobby_id,
    amount: item.balance.amount,
    currency: item.balance.currency,
    ...(item.balance.amount_vnd !== undefined ? { amount_vnd: item.balance.amount_vnd } : {}),
    ...(item.balance.display_text !== undefined ? { display_text: item.balance.display_text } : {}),
    observed_at: item.observed_at,
    received_at: item.received_at,
    stale: item.stale
  }))
]);

function resourceSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    state: z.enum(["available", "unavailable"]),
    items: z.array(itemSchema),
    error: z.string().optional(),
    server_time: z.string().optional(),
    stale_after_seconds: z.number().int().positive().optional()
  });
}

const unavailableBalancesResource = {
  state: "unavailable" as const,
  items: [],
  error: "Frontend chưa nhận dữ liệu số dư tài khoản."
};

export const collectorAccountBalancesResourceSchema = resourceSchema(collectorAccountBalanceSchema);

export const autoBetMonitorSnapshotSchema = z.object({
  checked_at: z.string(),
  runtime: autoBetRuntimeSchema,
  actions: resourceSchema(autoBetActionSchema),
  exposures: resourceSchema(betExposureSchema),
  balances: resourceSchema(collectorAccountBalanceSchema)
    .optional()
    .default(unavailableBalancesResource)
});

export const autoBetControlSchema = z.object({
  enabled: z.boolean(),
  total_stake_vnd: z.number().int().positive(),
  updated_at: z.string()
});

export const autoBetControlSnapshotSchema = z.object({
  checked_at: z.string(),
  control: autoBetControlSchema,
  balances: collectorAccountBalancesResourceSchema
    .optional()
    .default(unavailableBalancesResource)
});

export type AutoBetAction = z.infer<typeof autoBetActionSchema>;
export type BetExposure = z.infer<typeof betExposureSchema>;
export type CollectorAccountBalance = z.infer<typeof collectorAccountBalanceSchema>;
export type AutoBetMonitorSnapshot = z.infer<typeof autoBetMonitorSnapshotSchema>;
export type AutoBetControlSnapshot = z.infer<typeof autoBetControlSnapshotSchema>;
