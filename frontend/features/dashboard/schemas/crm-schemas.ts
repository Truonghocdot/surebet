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
      stake: z.number(),
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

export const dashboardSnapshotSchema = z.object({
  stats: z.array(statCardSchema),
  opportunities: z.array(dashboardOpportunitySchema)
});

export const opportunityBoardOutcomeSchema = z.object({
  fixture_id: z.string(),
  outcome_id: z.string(),
  outcome_name: z.string(),
  side: z.string(),
  odds: z.number(),
  collected_at: z.string(),
  observed_at: z.string().optional(),
  price_changed_at: z.string().optional(),
  is_stale: z.boolean().optional(),
  is_surebet_leg: z.boolean(),
  is_candidate_leg: z.boolean()
});

export const opportunityBoardMarketSchema = z.object({
  id: z.string(),
  period: z.string(),
  line: z.string(),
  observed_at: z.string().optional(),
  price_changed_at: z.string().optional(),
  outcomes: z.array(opportunityBoardOutcomeSchema)
});

export const opportunityBoardSourceSchema = z.object({
  id: z.string(),
  bookmaker_id: z.string(),
  lobby_id: z.string(),
  latest_collected_at: z.string(),
  latest_observed_at: z.string().optional(),
  handicap: z.array(opportunityBoardMarketSchema),
  over_under: z.array(opportunityBoardMarketSchema)
});

export const opportunityBoardFixtureSchema = z.object({
  id: z.string(),
  opportunity_id: z.string(),
  match_name: z.string(),
  match_state: z.string(),
  market_name: z.string(),
  profit_percentage: z.number(),
  expected_return: z.number(),
  odds_profile: z.enum([
    "one_negative_one_positive",
    "two_negative",
    "unknown"
  ]),
  latest_collected_at: z.string(),
  latest_observed_at: z.string().optional(),
  confirmed_at: z.string(),
  expires_at: z.string(),
  league_names: z.array(z.string()),
  has_surebet: z.boolean(),
  verification_status: z.enum(["candidate", "confirmed", "none"]),
  valid_until: z.string(),
  match_confidence: z.number(),
  match_ambiguous: z.boolean(),
  sources: z.array(opportunityBoardSourceSchema)
});

export const opportunityBoardSchema = z.object({
  items: z.array(opportunityBoardFixtureSchema)
});

export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;
export type DashboardOpportunity = z.infer<typeof dashboardOpportunitySchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
export type OpportunityBoard = z.infer<typeof opportunityBoardSchema>;
export type OpportunityBoardFixture = z.infer<typeof opportunityBoardFixtureSchema>;
export type OpportunityBoardSource = z.infer<typeof opportunityBoardSourceSchema>;
export type OpportunityBoardMarket = z.infer<typeof opportunityBoardMarketSchema>;
export type OpportunityBoardOutcome = z.infer<typeof opportunityBoardOutcomeSchema>;
