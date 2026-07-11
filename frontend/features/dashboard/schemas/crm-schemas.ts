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

export const matchedFixtureSourceSchema = z.object({
  source_id: z.string(),
  bookmaker_id: z.string(),
  lobby_id: z.string(),
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

export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
export type MatchedFixture = z.infer<typeof matchedFixtureSchema>;
export type MatchedFixturesSnapshot = z.infer<typeof matchedFixturesSnapshotSchema>;
