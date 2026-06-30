package calculator

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"math"
	"sort"
	"strings"
	"time"

	"surebet/backend/internal/models"
)

const (
	overUnderThreshold = 0.999
	handicapThreshold  = 0.999
)

type detector struct{}

func NewDetector() Detector {
	return detector{}
}

func (detector) Detect(_ context.Context, quotes []models.OddsQuote) ([]models.SurebetOpportunity, error) {
	eligible := filterQuotes(quotes)
	if len(eligible) == 0 {
		return nil, nil
	}

	grouped := groupQuotes(eligible)
	opportunities := make([]models.SurebetOpportunity, 0)

	for _, bucket := range grouped {
		if len(bucket.quotes) < 2 {
			continue
		}

		switch bucket.marketKind {
		case marketKindOverUnder:
			opportunities = append(opportunities, detectTwoWaySurebets(bucket, sideOver, sideUnder, overUnderThreshold)...)
		case marketKindHandicap:
			opportunities = append(opportunities, detectTwoWaySurebets(bucket, sideHome, sideAway, handicapThreshold)...)
		}
	}

	sort.Slice(opportunities, func(i, j int) bool {
		if opportunities[i].ProfitPercentage == opportunities[j].ProfitPercentage {
			return opportunities[i].ID < opportunities[j].ID
		}
		return opportunities[i].ProfitPercentage > opportunities[j].ProfitPercentage
	})

	return opportunities, nil
}

type marketKind string

const (
	marketKindUnknown   marketKind = ""
	marketKindOverUnder marketKind = "over_under"
	marketKindHandicap  marketKind = "handicap"
)

type outcomeSide string

const (
	sideUnknown outcomeSide = ""
	sideOver    outcomeSide = "over"
	sideUnder   outcomeSide = "under"
	sideHome    outcomeSide = "home"
	sideAway    outcomeSide = "away"
)

type normalizedQuote struct {
	quote      models.OddsQuote
	marketKind marketKind
	lineKey    string
	side       outcomeSide
}

type quoteBucket struct {
	fixtureID  string
	sport      string
	marketName string
	marketKind marketKind
	lineKey    string
	quotes     []normalizedQuote
}

func filterQuotes(quotes []models.OddsQuote) []models.OddsQuote {
	result := make([]models.OddsQuote, 0, len(quotes))
	for _, quote := range quotes {
		if quote.Suspended {
			continue
		}
		if quote.Odds <= 1 {
			continue
		}
		result = append(result, quote)
	}
	return result
}

func groupQuotes(quotes []models.OddsQuote) map[string]*quoteBucket {
	result := make(map[string]*quoteBucket)
	for _, quote := range quotes {
		marketKind, lineKey, side := normalizeQuote(quote)
		if marketKind == marketKindUnknown || side == sideUnknown {
			continue
		}

		key := strings.Join([]string{
			quote.FixtureID,
			string(marketKind),
			lineKey,
		}, "|")

		bucket, ok := result[key]
		if !ok {
			bucket = &quoteBucket{
				fixtureID:  quote.FixtureID,
				sport:      quote.Sport,
				marketName: chooseMarketName(quote, marketKind),
				marketKind: marketKind,
				lineKey:    lineKey,
			}
			result[key] = bucket
		}

		bucket.quotes = append(bucket.quotes, normalizedQuote{
			quote:      quote,
			marketKind: marketKind,
			lineKey:    lineKey,
			side:       side,
		})
	}

	return result
}

func detectTwoWaySurebets(bucket *quoteBucket, leftSide, rightSide outcomeSide, threshold float64) []models.SurebetOpportunity {
	leftQuotes := collectBestQuotes(bucket.quotes, leftSide)
	rightQuotes := collectBestQuotes(bucket.quotes, rightSide)

	opportunities := make([]models.SurebetOpportunity, 0)
	for bookmakerID, left := range leftQuotes {
		for opponentBookmakerID, right := range rightQuotes {
			if bookmakerID == opponentBookmakerID {
				continue
			}

			inv := (1 / left.quote.Odds) + (1 / right.quote.Odds)
			if inv >= threshold {
				continue
			}

			profit := (1 - inv) * 100
			if profit <= 0 {
				continue
			}

			legs := buildLegs(left.quote, right.quote, inv)
			detectedAt := maxTime(left.quote.CollectedAt, right.quote.CollectedAt)
			opportunities = append(opportunities, models.SurebetOpportunity{
				ID:               opportunityID(bucket.fixtureID, bucket.marketName, bucket.lineKey, left.quote.ID, right.quote.ID),
				FixtureID:        bucket.fixtureID,
				Sport:            bucket.sport,
				MarketName:       bucket.marketName,
				ProfitPercentage: round(profit),
				ExpectedReturn:   round(1 - inv),
				Currency:         "",
				DetectedAt:       detectedAt,
				ExpiresAt:        detectedAt.Add(30 * time.Second),
				Legs:             legs,
			})
		}
	}

	return opportunities
}

func collectBestQuotes(quotes []normalizedQuote, targetSide outcomeSide) map[string]normalizedQuote {
	result := make(map[string]normalizedQuote)
	for _, item := range quotes {
		if item.side != targetSide {
			continue
		}

		existing, ok := result[item.quote.BookmakerID]
		if !ok || item.quote.Odds > existing.quote.Odds {
			result[item.quote.BookmakerID] = item
		}
	}
	return result
}

func buildLegs(left, right models.OddsQuote, inv float64) []models.SurebetLeg {
	leftStake := (1 / left.Odds) / inv
	rightStake := (1 / right.Odds) / inv

	return []models.SurebetLeg{
		{
			BookmakerID: left.BookmakerID,
			LobbyID:     left.LobbyID,
			MarketID:    left.MarketID,
			OutcomeID:   left.OutcomeID,
			OutcomeName: left.OutcomeName,
			Odds:        left.Odds,
			Stake:       round(leftStake),
		},
		{
			BookmakerID: right.BookmakerID,
			LobbyID:     right.LobbyID,
			MarketID:    right.MarketID,
			OutcomeID:   right.OutcomeID,
			OutcomeName: right.OutcomeName,
			Odds:        right.Odds,
			Stake:       round(rightStake),
		},
	}
}

func normalizeQuote(quote models.OddsQuote) (marketKind, string, outcomeSide) {
	name := strings.ToLower(strings.TrimSpace(quote.OutcomeName))
	marketID := strings.ToLower(strings.TrimSpace(quote.MarketID))
	marketName := strings.ToLower(strings.TrimSpace(quote.MarketName))

	switch {
	case strings.Contains(marketID, "over-under"),
		strings.Contains(marketID, "ta-i-xi-u"),
		strings.Contains(marketName, "over/under"),
		strings.Contains(marketName, "tài xỉu"),
		strings.Contains(marketName, "tài/xỉu"),
		strings.Contains(marketName, "tài xỉu"):
		return marketKindOverUnder, normalizeLine(extractLine(quote.OutcomeName)), detectOverUnderSide(name)

	case strings.Contains(marketID, "handicap"),
		strings.Contains(marketID, "cu-o-c-cha-p"),
		strings.Contains(marketName, "handicap"),
		strings.Contains(marketName, "cược chấp"),
		strings.Contains(marketName, "chấp châu á"):
		return marketKindHandicap, normalizeHandicapGroupLine(extractLine(quote.OutcomeName)), detectHandicapSide(name)
	default:
		return marketKindUnknown, "", sideUnknown
	}
}

func detectOverUnderSide(name string) outcomeSide {
	switch {
	case strings.Contains(name, "over"), strings.Contains(name, "tài"), strings.Contains(name, "tài"):
		return sideOver
	case strings.Contains(name, "under"), strings.Contains(name, "xỉu"), strings.Contains(name, "xỉu"):
		return sideUnder
	default:
		return sideUnknown
	}
}

func detectHandicapSide(name string) outcomeSide {
	switch {
	case strings.HasPrefix(name, "home "), strings.HasPrefix(name, "đội nhà "), strings.Contains(name, "(h)"):
		return sideHome
	case strings.HasPrefix(name, "away "), strings.HasPrefix(name, "đội khách "), strings.Contains(name, "(a)"):
		return sideAway
	default:
		line := extractLine(name)
		if line == "" {
			return sideUnknown
		}
		if strings.Contains(line, "-") {
			return sideHome
		}
		return sideAway
	}
}

func extractLine(value string) string {
	var line strings.Builder
	for _, r := range value {
		if (r >= '0' && r <= '9') || r == '.' || r == '/' || r == '+' || r == '-' {
			line.WriteRune(r)
		}
	}
	return strings.TrimSpace(line.String())
}

func normalizeLine(value string) string {
	if value == "" {
		return ""
	}
	return strings.TrimPrefix(strings.TrimSpace(value), "+")
}

func normalizeHandicapGroupLine(value string) string {
	line := normalizeLine(value)
	return strings.TrimPrefix(line, "-")
}

func chooseMarketName(quote models.OddsQuote, kind marketKind) string {
	if strings.TrimSpace(quote.MarketName) != "" {
		return quote.MarketName
	}
	switch kind {
	case marketKindOverUnder:
		return "Over/Under"
	case marketKindHandicap:
		return "Handicap"
	default:
		return quote.MarketID
	}
}

func opportunityID(fixtureID, marketName, lineKey, leftID, rightID string) string {
	parts := []string{fixtureID, marketName, lineKey, leftID, rightID}
	sort.Strings(parts[3:])
	hash := sha1.Sum([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(hash[:])
}

func round(value float64) float64 {
	return math.Round(value*10000) / 10000
}

func maxTime(left, right time.Time) time.Time {
	if right.After(left) {
		return right
	}
	return left
}

var _ Detector = detector{}
