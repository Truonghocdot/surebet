package collector

import (
	"context"
	"errors"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/realtime"
)

const (
	CapabilityAccountBalance = "account_balance_v1"
	accountBalanceEventType  = "collector_account_balance_updated"
)

// SetAccountBalanceBroadcaster enables realtime updates for accepted balance
// telemetry. The current-value registry remains available when no broadcaster
// is configured.
func (s *StreamService) SetAccountBalanceBroadcaster(broadcaster RealtimeBroadcaster) {
	s.balanceMu.Lock()
	s.balanceBroadcaster = broadcaster
	s.balanceMu.Unlock()
}

// ListAccountBalances returns current volatile telemetry. Staleness is based on
// when this backend last received a valid frame, so collector clock skew does
// not make an old connection appear healthy.
func (s *StreamService) ListAccountBalances(
	ctx context.Context,
) (dto.CollectorAccountBalanceListView, error) {
	if err := ctx.Err(); err != nil {
		return dto.CollectorAccountBalanceListView{}, err
	}

	now := time.Now().UTC()
	s.balanceMu.RLock()
	items := make([]dto.CollectorAccountBalanceView, 0, len(s.accountBalances))
	for _, item := range s.accountBalances {
		item.Stale = now.Sub(item.ReceivedAt) > s.balanceStaleAfter
		items = append(items, item)
	}
	staleAfter := s.balanceStaleAfter
	s.balanceMu.RUnlock()

	sort.Slice(items, func(i, j int) bool {
		left := accountBalanceKey(items[i].Source, items[i].AccountID)
		right := accountBalanceKey(items[j].Source, items[j].AccountID)
		return left < right
	})

	return dto.CollectorAccountBalanceListView{
		Items:             items,
		ServerTime:        now,
		StaleAfterSeconds: int64(staleAfter / time.Second),
	}, nil
}

func (s *StreamService) handleAccountBalance(
	conn *websocket.Conn,
	state *collectorStreamConnectionState,
	event dto.CollectorStreamAccountBalance,
) error {
	if state.hello == nil || state.hello.ProtocolVersion != 4 || event.ProtocolVersion != 4 ||
		state.authorized == nil {
		return s.writeFrame(conn, dto.CollectorStreamError{
			Type:      "error",
			SessionID: state.sessionID(),
			Code:      "protocol_mismatch",
			Message:   "account_balance requires authenticated protocol v4",
		})
	}
	if err := s.requireEventSource(conn, state, event.SessionID, event.Source); err != nil {
		return err
	}
	connection, connected := s.connections.Get(event.Source)
	if !connected || connection.sessionID != event.SessionID || !connection.supports(CapabilityAccountBalance) {
		return s.writeFrame(conn, dto.CollectorStreamError{
			Type:      "error",
			SessionID: state.sessionID(),
			Code:      "capability_required",
			Message:   "account_balance requires the account_balance_v1 capability",
		})
	}
	accountID := strings.TrimSpace(event.AccountID)
	if accountID == "" || accountID != strings.TrimSpace(state.hello.AccountID) ||
		accountID != state.authorized.accountID {
		return s.writeFrame(conn, dto.CollectorStreamError{
			Type:      "error",
			SessionID: state.sessionID(),
			Code:      "account_mismatch",
			Message:   "account_balance account does not match the authenticated connection",
		})
	}
	if err := validateAccountBalance(event); err != nil {
		return s.writeFrame(conn, dto.CollectorStreamError{
			Type:      "error",
			SessionID: state.sessionID(),
			Code:      "invalid_account_balance",
			Message:   err.Error(),
		})
	}

	now := time.Now().UTC()
	value := event.Balance
	value.Currency = strings.ToUpper(strings.TrimSpace(value.Currency))
	value.DisplayText = strings.TrimSpace(value.DisplayText)
	if value.AmountVND != nil {
		normalized := *value.AmountVND
		value.AmountVND = &normalized
	}
	view := dto.CollectorAccountBalanceView{
		AccountID:  accountID,
		Source:     event.Source,
		Balance:    value,
		ObservedAt: event.ObservedAt.UTC(),
		ReceivedAt: now,
		Stale:      false,
	}

	s.balanceMu.Lock()
	if s.accountBalances == nil {
		s.accountBalances = make(map[string]dto.CollectorAccountBalanceView)
	}
	s.accountBalances[accountBalanceKey(event.Source, accountID)] = view
	broadcaster := s.balanceBroadcaster
	s.balanceMu.Unlock()

	if broadcaster != nil {
		broadcaster.Broadcast(realtime.Event{
			Type:    accountBalanceEventType,
			SentAt:  now,
			Payload: view,
		})
	}
	return nil
}

func validateAccountBalance(event dto.CollectorStreamAccountBalance) error {
	if event.Type != "account_balance" || event.Seq <= 0 || event.ObservedAt.IsZero() {
		return errors.New("account_balance is missing type, sequence, or observed_at")
	}
	if !finiteNonNegative(event.Balance.Amount) {
		return errors.New("account_balance amount must be finite and non-negative")
	}
	if event.Balance.AmountVND != nil && !finiteNonNegative(*event.Balance.AmountVND) {
		return errors.New("account_balance amount_vnd must be finite and non-negative")
	}
	currency := strings.TrimSpace(event.Balance.Currency)
	if len(currency) < 1 || len(currency) > 12 || !validBalanceCurrency(currency) {
		return errors.New("account_balance currency must contain 1-12 letters, digits, underscores, or hyphens")
	}
	if len(strings.TrimSpace(event.Balance.DisplayText)) > 128 {
		return errors.New("account_balance display_text exceeds 128 bytes")
	}
	return nil
}

func finiteNonNegative(value float64) bool {
	return value >= 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func validBalanceCurrency(value string) bool {
	for _, character := range value {
		if (character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') ||
			character == '_' || character == '-' {
			continue
		}
		return false
	}
	return true
}

func accountBalanceKey(source dto.CollectorSource, accountID string) string {
	return liveCredentialKey(source, strings.TrimSpace(accountID))
}
