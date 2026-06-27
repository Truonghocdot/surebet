import { z } from "zod";

export const statCardSchema = z.object({
  title: z.string(),
  value: z.string(),
  delta: z.string(),
  tone: z.enum(["positive", "warning", "neutral"])
});

export const opportunitySchema = z.object({
  fixture: z.string(),
  market: z.string(),
  profit: z.string(),
  spread: z.string(),
  freshness: z.string()
});

export const orderSchema = z.object({
  id: z.string(),
  state: z.string(),
  operator: z.string(),
  updatedAt: z.string()
});

export const accountSchema = z.object({
  bookmaker: z.string(),
  account: z.string(),
  balance: z.string(),
  status: z.string()
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
  flags: z.array(featureFlagSchema)
});

export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
export type Order = z.infer<typeof orderSchema>;
export type Account = z.infer<typeof accountSchema>;
export type FeatureFlag = z.infer<typeof featureFlagSchema>;
export type RiskCheckpoint = z.infer<typeof riskCheckpointSchema>;

