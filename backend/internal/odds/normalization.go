package odds

import (
	"math"
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
	"surebet/backend/internal/models"
)

const (
	viewMarketOverUnder = "over_under"
	viewMarketHandicap  = "handicap"
	viewMarketOneXTwo   = "1x2"
)

var (
	viewLinePattern         = regexp.MustCompile(`([+-]?\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)?)$`)
	viewRoleTagPattern      = regexp.MustCompile(`(?i)\s+\((h|a)\)\s*$`)
	viewWhitespacePattern   = regexp.MustCompile(`\s+`)
	viewSeparatorNormalizer = regexp.MustCompile(`[^\p{L}\p{N}]+`)
)

type normalizedQuoteView struct {
	MatchName   string
	Period      string
	MarketType  string
	Line        string
	Side        string
	DecimalOdds float64
}

func normalizeQuoteView(quote models.OddsQuote) normalizedQuoteView {
	marketType := normalizeViewMarketType(quote.MarketID, quote.MarketName)

	return normalizedQuoteView{
		MatchName:   normalizeMatchName(quote),
		Period:      normalizeViewPeriod(quote.MarketID, quote.MarketName),
		MarketType:  marketType,
		Line:        normalizeViewLine(extractViewLine(quote.OutcomeName), marketType),
		Side:        normalizeViewSide(quote, marketType),
		DecimalOdds: normalizeViewOdds(quote.Odds, marketType),
	}
}

func normalizeMatchName(quote models.OddsQuote) string {
	homeTeam := strings.TrimSpace(quote.HomeTeam)
	awayTeam := strings.TrimSpace(quote.AwayTeam)
	if homeTeam != "" && awayTeam != "" {
		return homeTeam + " vs " + awayTeam
	}
	return quote.FixtureID
}

func normalizeViewPeriod(marketID, marketName string) string {
	combined := canonicalViewText(marketID + " " + marketName)
	switch {
	case strings.Contains(combined, "1h"),
		strings.Contains(combined, "1st half"),
		strings.Contains(combined, "first half"),
		strings.Contains(combined, "hiep 1"):
		return "1H"
	default:
		return "FT"
	}
}

func normalizeViewMarketType(marketID, marketName string) string {
	combined := canonicalViewText(marketID + " " + marketName)
	switch {
	case strings.Contains(combined, "over under"),
		strings.Contains(combined, "ta i xi u"),
		strings.Contains(combined, "tai xiu"):
		return viewMarketOverUnder
	case strings.Contains(combined, "handicap"),
		strings.Contains(combined, "cu o c cha p"),
		strings.Contains(combined, "run line"):
		return viewMarketHandicap
	case strings.Contains(combined, "1x2"),
		strings.Contains(combined, "winner"),
		strings.Contains(combined, "ngu o i tha ng"):
		return viewMarketOneXTwo
	default:
		return ""
	}
}

func normalizeViewSide(quote models.OddsQuote, marketType string) string {
	outcome := canonicalViewText(quote.OutcomeName)
	switch marketType {
	case viewMarketOverUnder:
		switch {
		case strings.Contains(outcome, "over"), strings.Contains(outcome, "tai"):
			return "over"
		case strings.Contains(outcome, "under"), strings.Contains(outcome, "xiu"):
			return "under"
		default:
			return ""
		}
	case viewMarketHandicap:
		return normalizeViewParticipantSide(quote)
	case viewMarketOneXTwo:
		side := normalizeViewParticipantSide(quote)
		if side != "" {
			return side
		}
		if isDrawOutcome(outcome) {
			return "draw"
		}
		return ""
	default:
		return ""
	}
}

func normalizeViewParticipantSide(quote models.OddsQuote) string {
	homeTeam := canonicalViewText(quote.HomeTeam)
	awayTeam := canonicalViewText(quote.AwayTeam)
	if homeTeam == "" || awayTeam == "" {
		return normalizeViewHandicapSideByLine(quote.OutcomeName)
	}

	participant := viewParticipantCandidate(quote.OutcomeName)
	switch participant {
	case homeTeam:
		return "home"
	case awayTeam:
		return "away"
	default:
		return normalizeViewHandicapSideByLine(quote.OutcomeName)
	}
}

func normalizeViewHandicapSideByLine(outcomeName string) string {
	line := extractViewLine(outcomeName)
	if line == "" {
		return ""
	}
	if strings.HasPrefix(line, "-") {
		return "home"
	}
	return "away"
}

func isDrawOutcome(value string) bool {
	switch value {
	case "draw", "hoa", "hoa a", "ho a":
		return true
	default:
		return false
	}
}

func normalizeViewOdds(value float64, marketType string) float64 {
	if marketType == viewMarketOverUnder || marketType == viewMarketHandicap {
		decimal, ok := normalizeViewAsianOdds(value)
		if ok {
			return decimal
		}
		return 0
	}
	if value > 0 {
		return value
	}
	return 0
}

func normalizeViewAsianOdds(value float64) (float64, bool) {
	switch {
	case value > 0:
		return value + 1, true
	case value < 0:
		return 1 + (1 / math.Abs(value)), true
	default:
		return 0, false
	}
}

func viewParticipantCandidate(outcomeName string) string {
	cleaned := strings.TrimSpace(viewLinePattern.ReplaceAllString(outcomeName, ""))
	cleaned = strings.TrimSpace(viewRoleTagPattern.ReplaceAllString(cleaned, ""))
	return canonicalViewText(cleaned)
}

func extractViewLine(value string) string {
	match := viewLinePattern.FindStringSubmatch(strings.TrimSpace(value))
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func normalizeViewLine(value string, marketType string) string {
	line := strings.TrimPrefix(strings.TrimSpace(value), "+")
	if marketType == viewMarketHandicap {
		return strings.TrimPrefix(line, "-")
	}
	return line
}

func canonicalViewText(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(norm.NFKD.String(value)))
	normalized = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Mn, r) {
			return -1
		}
		return r
	}, normalized)
	normalized = viewWhitespacePattern.ReplaceAllString(normalized, " ")
	normalized = viewSeparatorNormalizer.ReplaceAllString(normalized, " ")
	normalized = viewWhitespacePattern.ReplaceAllString(normalized, " ")
	return strings.TrimSpace(normalized)
}
