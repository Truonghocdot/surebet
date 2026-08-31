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
  verification_status: z.enum(["candidate", "confirmed"]),
  confirmed_at: z.string().optional(),
  valid_until: z.string().optional(),
  confirmation_latency_ms: z.number().optional(),
  match_confidence: z.number().optional(),
  match_ambiguous: z.boolean().optional(),
  legs: z.array(
    z.object({
      bookmaker_id: z.string(),
      lobby_id: z.string(),
      fixture_id: z.string(),
      market_id: z.string(),
      outcome_id: z.string(),
      outcome_name: z.string(),
      odds: z.number(),
      observed_at: z.string().optional()
    })
  )
});

export const dashboardOpportunitySchema = opportunitySchema.extend({
  match_name: z.string(),
  market_label: z.string(),
  legs: z.array(
    opportunitySchema.shape.legs.element.extend({
      selection_label: z.string(),
      source_label: z.string()
    })
  )
});

export const fixtureMatchingMonitorSchema = z.object({
  state: z.enum(["matching", "waiting", "source_missing"]),
  matched_fixtures: z.number().int().nonnegative(),
  checked_at: z.string(),
  sources: z.array(
    z.object({
      id: z.enum(["jun88/cmd", "8xbet/default"]),
      bookmaker_id: z.string(),
      lobby_id: z.string(),
      label: z.string(),
      active_fixtures: z.number().int().nonnegative(),
      latest_observed_at: z.string().optional(),
      has_data: z.boolean()
    })
  ).length(2)
});

export const dashboardSnapshotSchema = z.object({
  stats: z.array(statCardSchema),
  matching: fixtureMatchingMonitorSchema,
  opportunities: z.array(dashboardOpportunitySchema)
});

export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;
export type DashboardOpportunity = z.infer<typeof dashboardOpportunitySchema>;
export type FixtureMatchingMonitor = z.infer<typeof fixtureMatchingMonitorSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
