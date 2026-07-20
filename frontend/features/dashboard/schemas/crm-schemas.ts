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

export const dashboardSnapshotSchema = z.object({
  stats: z.array(statCardSchema),
  opportunities: z.array(opportunitySchema)
});

export const matchedFixtureSourceSchema = z.object({
  source_id: z.string(),
  bookmaker_id: z.string(),
  lobby_id: z.string(),
  fixture_id: z.string(),
  home_team: z.string(),
  away_team: z.string(),
  match_state: z.string(),
  quote_count: z.number(),
  market_count: z.number(),
  latest_collected_at: z.string()
});

export const matchedFixtureSchema = z.object({
  id: z.string(),
  fixture_marker: z.string(),
  match_name: z.string(),
  league_names: z.array(z.string()),
  match_state: z.string(),
  source_count: z.number(),
  quote_count: z.number(),
  market_count: z.number(),
  latest_collected_at: z.string(),
  sources: z.array(matchedFixtureSourceSchema)
});

export const matchedFixturesSnapshotSchema = z.object({
  summary: z.object({
    matched_fixtures: z.number(),
    active_sources: z.number(),
    total_quotes: z.number(),
    latest_collected_at: z.string().nullable()
  }),
  items: z.array(matchedFixtureSchema)
});

export const opportunityBoardOutcomeSchema = z.object({
  fixture_id: z.string(),
  outcome_id: z.string(),
  outcome_name: z.string(),
  side: z.string(),
  odds: z.number(),
  collected_at: z.string(),
  is_surebet_leg: z.boolean(),
  is_candidate_leg: z.boolean()
});

export const opportunityBoardMarketSchema = z.object({
  id: z.string(),
  period: z.string(),
  line: z.string(),
  outcomes: z.array(opportunityBoardOutcomeSchema)
});

export const opportunityBoardSourceSchema = z.object({
  id: z.string(),
  bookmaker_id: z.string(),
  lobby_id: z.string(),
  latest_collected_at: z.string(),
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
export type Opportunity = z.infer<typeof opportunitySchema>;
export type MatchedFixture = z.infer<typeof matchedFixtureSchema>;
export type MatchedFixturesSnapshot = z.infer<typeof matchedFixturesSnapshotSchema>;
export type OpportunityBoard = z.infer<typeof opportunityBoardSchema>;
export type OpportunityBoardFixture = z.infer<typeof opportunityBoardFixtureSchema>;
export type OpportunityBoardSource = z.infer<typeof opportunityBoardSourceSchema>;
export type OpportunityBoardMarket = z.infer<typeof opportunityBoardMarketSchema>;
export type OpportunityBoardOutcome = z.infer<typeof opportunityBoardOutcomeSchema>;
