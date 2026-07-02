import { z } from "zod";

export const statCardSchema = z.object({
  title: z.string(),
  value: z.string(),
  delta: z.string(),
  tone: z.enum(["positive", "warning", "neutral"])
});

export const opportunitySchema = z.object({
  id: z.string(),
  fixture_id: z.string(),
  market_name: z.string(),
  profit_percentage: z.number(),
  expected_return: z.number(),
  detected_at: z.string(),
  expires_at: z.string(),
  legs: z.array(
    z.object({
      bookmaker_id: z.string(),
      lobby_id: z.string(),
      market_id: z.string(),
      outcome_id: z.string(),
      outcome_name: z.string(),
      odds: z.number(),
      stake: z.number()
    })
  )
});

export const orderSchema = z.object({
  id: z.string(),
  state: z.string(),
  operator: z.string(),
  updatedAt: z.string()
});

export const accountSchema = z.object({
  bookmaker: z.string(),
  bookmaker_code: z.string().optional(),
  account: z.string(),
  balance: z.string(),
  available_stake: z.string().optional(),
  status: z.string(),
  session_status: z.string().optional(),
  readiness: z.string().optional(),
  live_odds: z.number().optional(),
  latest_seen_at: z.string().nullable().optional(),
  lobbies: z.array(z.string()).optional()
});

export const featureFlagSchema = z.object({
  name: z.string(),
  scope: z.string(),
  value: z.enum(["ON", "OFF"])
});

export const riskCheckpointSchema = z.object({
  label: z.string(),
  status: z.enum(["active", "watch", "blocked"])
});

export const dashboardSnapshotSchema = z.object({
  stats: z.array(statCardSchema),
  opportunities: z.array(opportunitySchema),
  orders: z.array(orderSchema),
  accounts: z.array(accountSchema),
  flags: z.array(featureFlagSchema),
  bookmakers: z.array(z.unknown()).optional(),
  configurations: z.array(z.unknown()).optional(),
  risk: z.array(z.unknown()).optional()
});

export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
export type Order = z.infer<typeof orderSchema>;
export type Account = z.infer<typeof accountSchema>;
export type FeatureFlag = z.infer<typeof featureFlagSchema>;
export type RiskCheckpoint = z.infer<typeof riskCheckpointSchema>;

export const bookmakerSettingSchema = z.object({
  bookmaker_code: z.string(),
  bookmaker_name: z.string(),
  url: z.string(),
  username: z.string(),
  password: z.string()
});

export const bookmakerSettingsResponseSchema = z.object({
  data: z.array(bookmakerSettingSchema)
});

export const updateBookmakerSettingSchema = z.object({
  bookmaker_code: z.string().min(1),
  url: z.string().url("URL không hợp lệ."),
  username: z.string().min(1, "Vui lòng nhập tên đăng nhập."),
  password: z.string().min(1, "Vui lòng nhập mật khẩu.")
});

export type BookmakerSetting = z.infer<typeof bookmakerSettingSchema>;
export type UpdateBookmakerSettingInput = z.infer<
  typeof updateBookmakerSettingSchema
>;
