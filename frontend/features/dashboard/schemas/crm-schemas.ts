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

export const dashboardSnapshotSchema = z.object({
  stats: z.array(statCardSchema),
  opportunities: z.array(opportunitySchema)
});

export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
