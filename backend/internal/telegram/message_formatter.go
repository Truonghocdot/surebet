package telegram

import (
	"fmt"
	"html"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"surebet/backend/internal/dto"
)

const (
	telegramMarketKindUnknown   = "unknown"
	telegramMarketKindOverUnder = "over_under"
	telegramMarketKindHandicap  = "handicap"
	telegramMarketKindOneXTwo   = "one_x_two"
)

var (
	telegramLinePattern                 = regexp.MustCompile(`([+-]?\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)?)$`)
	telegramWhitespacePattern           = regexp.MustCompile(`\s+`)
	telegramAwayGoalNoisePattern        = regexp.MustCompile(`(?i)Away Goal O/UAway Goal O/U ov\s+`)
	telegramHomeGoalNoisePattern        = regexp.MustCompile(`(?i)Home Goal O/UHome Goal O/U ov\s+`)
	telegramNonASCIIAlphaNumericPattern = regexp.MustCompile(`[^a-z0-9]+`)
	telegramOverUnderPatterns           = []string{"over under", "over", "under", "tai", "xiu", "o u"}
	telegramHandicapPatterns            = []string{"handicap", "chap"}
	telegramOneXTwoPatterns             = []string{"1x2", "draw", "hoa"}
)

type formattedOpportunityPresentation struct {
	MarketLabel string
	MoneyGap    float64
	Legs        []formattedSurebetLeg
}

type formattedSurebetLeg struct {
	dto.SurebetLegView
	DisplayOutcome string
}

func formatSurebetMessage(item dto.SurebetView) string {
	return formatSurebetMessageAt(item, time.Now().UTC(), time.Local)
}

func formatSurebetMessageAt(item dto.SurebetView, now time.Time, location *time.Location) string {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if location == nil {
		location = time.UTC
	}

	presentation := deriveTelegramOpportunityPresentation(item)

	var builder strings.Builder
	builder.WriteString("<b>Kèo mới</b> | ")
	builder.WriteString(html.EscapeString(formatTelegramFreshness(item.DetectedAt, now)))
	builder.WriteString("\n")
	builder.WriteString("Lệch tiền <b>")
	builder.WriteString(formatTelegramFixed(presentation.MoneyGap))
	builder.WriteString("</b> | Lãi surebet <b>")
	builder.WriteString(formatTelegramPercent(item.ProfitPercentage))
	builder.WriteString("</b>\n\n")

	builder.WriteString("<b>")
	builder.WriteString(html.EscapeString(strings.TrimSpace(item.FixtureID)))
	builder.WriteString("</b>\n")
	builder.WriteString(html.EscapeString(presentation.MarketLabel))
	builder.WriteString("\n")
	builder.WriteString("Hết hạn ")
	builder.WriteString(html.EscapeString(formatTelegramClock(item.ExpiresAt, location)))

	for index, leg := range presentation.Legs {
		builder.WriteString("\n\n")
		builder.WriteString("<b>Cửa ")
		builder.WriteString(fmt.Sprintf("%d", index+1))
		builder.WriteString(" | ")
		builder.WriteString(html.EscapeString(formatTelegramSourceLabel(leg.BookmakerID, leg.LobbyID)))
		builder.WriteString("</b> ")
		builder.WriteString("<code>")
		builder.WriteString(html.EscapeString(fmt.Sprint(leg.Odds)))
		builder.WriteString("</code>\n")
		builder.WriteString("Cửa đối ứng: <b>")
		builder.WriteString(html.EscapeString(leg.DisplayOutcome))
		builder.WriteString("</b>\n")
		builder.WriteString("Tỷ trọng vốn: <b>")
		builder.WriteString(formatTelegramPercent(leg.Stake * 100))
		builder.WriteString("</b>\n")
		builder.WriteString("Odds gốc: ")
		builder.WriteString(fmt.Sprint(leg.Odds))
	}

	return builder.String()
}

func deriveTelegramOpportunityPresentation(item dto.SurebetView) formattedOpportunityPresentation {
	legs := make([]formattedSurebetLeg, 0, min(len(item.Legs), 2))
	for index, leg := range item.Legs {
		if index >= 2 {
			break
		}

		legs = append(legs, formattedSurebetLeg{
			SurebetLegView: leg,
			DisplayOutcome: deriveTelegramOutcomeDisplayLabel(leg, item),
		})
	}

	moneyGap := 0.0
	if len(legs) >= 2 {
		moneyGap = math.Abs(math.Abs(legs[0].Odds) - math.Abs(legs[1].Odds))
	}

	return formattedOpportunityPresentation{
		MarketLabel: deriveTelegramMarketDisplayLabel(item),
		MoneyGap:    moneyGap,
		Legs:        legs,
	}
}

func deriveTelegramMarketDisplayLabel(item dto.SurebetView) string {
	marketKind := detectTelegramMarketKind(item)
	line := resolveTelegramPrimaryLine(item)

	switch {
	case marketKind == telegramMarketKindOverUnder && line != "":
		return "Tài/Xỉu " + normalizeTelegramLineForDisplay(line)
	case marketKind == telegramMarketKindHandicap && line != "":
		return "Kèo chấp " + normalizeTelegramHandicapLineForDisplay(line)
	case marketKind == telegramMarketKindOneXTwo:
		return "1X2"
	default:
		return beautifyTelegramRawText(item.MarketName)
	}
}

func deriveTelegramOutcomeDisplayLabel(leg dto.SurebetLegView, item dto.SurebetView) string {
	marketKind := detectTelegramMarketKind(item)
	line := resolveTelegramPrimaryLine(item)
	normalized := canonicalTelegramText(leg.OutcomeName)

	if marketKind == telegramMarketKindOverUnder {
		switch {
		case containsTelegramOneOf(normalized, []string{"over", "tai"}):
			if line != "" {
				return "Tài " + normalizeTelegramLineForDisplay(line)
			}
			return "Tài"
		case containsTelegramOneOf(normalized, []string{"under", "xiu"}):
			if line != "" {
				return "Xỉu " + normalizeTelegramLineForDisplay(line)
			}
			return "Xỉu"
		}
	}

	if marketKind == telegramMarketKindOneXTwo &&
		containsTelegramOneOf(normalized, []string{"draw", "hoa"}) {
		return "Hòa"
	}

	return beautifyTelegramOutcomeName(leg.OutcomeName)
}

func detectTelegramMarketKind(item dto.SurebetView) string {
	parts := make([]string, 0, len(item.Legs)+1)
	parts = append(parts, item.MarketName)
	for _, leg := range item.Legs {
		parts = append(parts, leg.OutcomeName)
	}

	combined := canonicalTelegramText(strings.Join(parts, " "))

	switch {
	case containsTelegramOneOf(combined, telegramOverUnderPatterns):
		return telegramMarketKindOverUnder
	case containsTelegramOneOf(combined, telegramHandicapPatterns):
		return telegramMarketKindHandicap
	case containsTelegramOneOf(combined, telegramOneXTwoPatterns):
		return telegramMarketKindOneXTwo
	}

	for _, leg := range item.Legs {
		if extractTelegramLine(leg.OutcomeName) != "" {
			return telegramMarketKindHandicap
		}
	}

	return telegramMarketKindUnknown
}

func resolveTelegramPrimaryLine(item dto.SurebetView) string {
	for _, leg := range item.Legs {
		if value := extractTelegramLine(leg.OutcomeName); value != "" {
			return value
		}
	}
	return ""
}

func extractTelegramLine(value string) string {
	match := telegramLinePattern.FindStringSubmatch(strings.TrimSpace(value))
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func normalizeTelegramLineForDisplay(value string) string {
	return strings.TrimPrefix(strings.TrimSpace(value), "+")
}

func normalizeTelegramHandicapLineForDisplay(value string) string {
	return strings.TrimPrefix(normalizeTelegramLineForDisplay(value), "-")
}

func beautifyTelegramOutcomeName(value string) string {
	cleaned := telegramAwayGoalNoisePattern.ReplaceAllString(value, "")
	cleaned = telegramHomeGoalNoisePattern.ReplaceAllString(cleaned, "")
	return strings.Join(strings.Fields(cleaned), " ")
}

func beautifyTelegramRawText(value string) string {
	cleaned := strings.ReplaceAll(value, "-", " ")
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	if cleaned == "" {
		return "Kèo đối ứng"
	}
	return cleaned
}

func canonicalTelegramText(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(norm.NFD.String(value)))
	normalized = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Mn, r) {
			return -1
		}
		return r
	}, normalized)
	normalized = telegramNonASCIIAlphaNumericPattern.ReplaceAllString(normalized, " ")
	normalized = telegramWhitespacePattern.ReplaceAllString(normalized, " ")
	return strings.TrimSpace(normalized)
}

func containsTelegramOneOf(value string, patterns []string) bool {
	for _, pattern := range patterns {
		if strings.Contains(value, pattern) {
			return true
		}
	}
	return false
}

func formatTelegramFreshness(value, now time.Time) string {
	seconds := 0
	if !value.IsZero() {
		seconds = int(now.Sub(value).Seconds())
	}
	if seconds < 0 {
		seconds = 0
	}
	if seconds < 60 {
		return fmt.Sprintf("%d giây trước", seconds)
	}
	return fmt.Sprintf("%d phút trước", seconds/60)
}

func formatTelegramClock(value time.Time, location *time.Location) string {
	if value.IsZero() {
		return "chưa rõ"
	}
	return value.In(location).Format("15:04:05")
}

func formatTelegramPercent(value float64) string {
	return fmt.Sprintf("%.2f%%", value)
}

func formatTelegramFixed(value float64) string {
	return fmt.Sprintf("%.2f", value)
}

func formatTelegramSourceLabel(bookmakerID, lobbyID string) string {
	bookmakerID = strings.TrimSpace(bookmakerID)
	lobbyID = strings.TrimSpace(lobbyID)
	if bookmakerID == "" {
		bookmakerID = "?"
	}
	if lobbyID == "" {
		lobbyID = "-"
	}
	return bookmakerID + " / " + lobbyID
}
