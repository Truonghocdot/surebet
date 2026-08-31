package collector

import (
	"context"
	"crypto/subtle"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"surebet/backend/internal/config"
	"surebet/backend/internal/dto"
)

const (
	CapabilityBetPrepare   = "bet_prepare_v1"
	CapabilityBetCommit    = "bet_commit_v1"
	CapabilityBetReconcile = "bet_reconcile_v1"
)

type collectorStreamCredential struct {
	source    dto.CollectorSource
	accountID string
	token     string
}

type authorizedCollectorIdentity struct {
	source    dto.CollectorSource
	accountID string
}

// SetCollectorStreamAuth installs source-bound credentials used before the
// websocket upgrade. Protocol v4 is never accepted without one of these.
func (s *StreamService) SetCollectorStreamAuth(cfg config.CollectorStreamAuthConfig) {
	credentials := make(map[string]collectorStreamCredential, len(cfg.Credentials))
	for _, item := range cfg.Credentials {
		credential := collectorStreamCredential{
			source: dto.CollectorSource{
				CollectorID: strings.TrimSpace(item.CollectorID),
				BookmakerID: strings.TrimSpace(item.BookmakerID),
				LobbyID:     strings.TrimSpace(item.LobbyID),
			},
			accountID: strings.TrimSpace(item.AccountID),
			token:     strings.TrimSpace(item.Token),
		}
		if credential.source.CollectorID == "" || credential.source.BookmakerID == "" ||
			credential.source.LobbyID == "" || credential.accountID == "" || credential.token == "" {
			continue
		}
		credentials[liveCredentialKey(credential.source, credential.accountID)] = credential
	}

	s.authMu.Lock()
	s.authRequired = cfg.Required
	s.credentials = credentials
	s.authMu.Unlock()
}

func (s *StreamService) authorizeUpgrade(r *http.Request) (*authorizedCollectorIdentity, int, error) {
	query := r.URL.Query()
	return s.authorizeIdentity(dto.CollectorSource{
		CollectorID: strings.TrimSpace(query.Get("collector_id")),
		BookmakerID: strings.TrimSpace(query.Get("bookmaker_id")),
		LobbyID:     strings.TrimSpace(query.Get("lobby_id")),
	}, strings.TrimSpace(query.Get("account_id")), strings.TrimSpace(query.Get("access_token")))
}

func (s *StreamService) AuthenticateCollectorRequest(r *http.Request) (int, error) {
	_, status, err := s.authorizeIdentity(dto.CollectorSource{
		CollectorID: strings.TrimSpace(r.Header.Get("X-Surebet-Collector-ID")),
		BookmakerID: strings.TrimSpace(r.Header.Get("X-Surebet-Bookmaker-ID")),
		LobbyID:     strings.TrimSpace(r.Header.Get("X-Surebet-Lobby-ID")),
	}, strings.TrimSpace(r.Header.Get("X-Surebet-Account-ID")), strings.TrimSpace(r.Header.Get("X-Surebet-Collector-Token")))
	return status, err
}

func (s *StreamService) authorizeIdentity(
	source dto.CollectorSource,
	accountID string,
	token string,
) (*authorizedCollectorIdentity, int, error) {
	hasIdentity := source.CollectorID != "" || source.BookmakerID != "" || source.LobbyID != "" ||
		accountID != "" || token != ""

	s.authMu.RLock()
	required := s.authRequired
	configured := len(s.credentials)
	credential, found := s.credentials[liveCredentialKey(source, accountID)]
	s.authMu.RUnlock()

	if !hasIdentity && !required {
		return nil, http.StatusOK, nil
	}
	if required && configured == 0 {
		return nil, http.StatusServiceUnavailable, errors.New("collector stream authentication is required but no credentials are configured")
	}
	if source.CollectorID == "" || source.BookmakerID == "" || source.LobbyID == "" ||
		accountID == "" || token == "" || !found || !constantTimeEqual(token, credential.token) {
		return nil, http.StatusUnauthorized, errors.New("invalid collector stream credential")
	}

	return &authorizedCollectorIdentity{source: source, accountID: accountID}, http.StatusOK, nil
}

func constantTimeEqual(left, right string) bool {
	return len(left) == len(right) && subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func liveCredentialKey(source dto.CollectorSource, accountID string) string {
	return strings.Join([]string{
		strings.TrimSpace(source.CollectorID),
		strings.TrimSpace(source.BookmakerID),
		strings.TrimSpace(source.LobbyID),
		strings.TrimSpace(accountID),
	}, "\x00")
}

func capabilitySet(items []string) map[string]struct{} {
	result := make(map[string]struct{}, len(items))
	for _, item := range items {
		if item = strings.TrimSpace(item); item != "" {
			result[item] = struct{}{}
		}
	}
	return result
}

func (c activeCollectorConnection) supports(capability string) bool {
	_, ok := c.capabilities[capability]
	return ok
}

// ExecuteLiveBet sends one correlated protocol-v4 command. The sent return
// value becomes true as soon as a websocket write is attempted; callers must
// reconcile rather than retry when an error follows that boundary.
func (s *StreamService) ExecuteLiveBet(
	ctx context.Context,
	source dto.CollectorSource,
	command dto.CollectorLiveBetRequest,
) (dto.CollectorLiveBetResponse, bool, error) {
	capability, responseType, err := liveCommandContract(command.Type)
	if err != nil {
		return dto.CollectorLiveBetResponse{}, false, err
	}
	if err := validateLiveCommand(command); err != nil {
		return dto.CollectorLiveBetResponse{}, false, err
	}
	if command.Source != (dto.CollectorSource{}) && command.Source != source {
		return dto.CollectorLiveBetResponse{}, false, errors.New("live bet command source mismatch")
	}

	connection, ok := s.connections.Get(source)
	if !ok || !s.sessions.IsActive(source, connection.sessionID) {
		return dto.CollectorLiveBetResponse{}, false, errors.New("collector source is not connected")
	}
	if connection.protocolVersion < 4 || !connection.authenticated || strings.TrimSpace(connection.accountID) == "" {
		return dto.CollectorLiveBetResponse{}, false, errors.New("collector source is not authenticated for live betting")
	}
	if connection.accountID != strings.TrimSpace(command.AccountID) {
		return dto.CollectorLiveBetResponse{}, false, errors.New("collector account does not match live bet command")
	}
	if !connection.supports(capability) {
		return dto.CollectorLiveBetResponse{}, false, errors.New("collector does not advertise the required live betting capability")
	}

	requestID := uuid.NewString()
	responseChannel := make(chan dto.CollectorLiveBetResponse, 1)
	s.liveMu.Lock()
	s.liveRequests[requestID] = pendingLiveBetRequest{
		responses: responseChannel, source: source, sessionID: connection.sessionID,
		responseType: responseType, actionID: command.ActionID, attemptID: command.AttemptID,
		opportunityID: command.OpportunityID, legID: command.LegID, accountID: command.AccountID,
		prepareID: command.PrepareID, idempotencyKey: command.IdempotencyKey,
	}
	s.liveMu.Unlock()
	defer func() {
		s.liveMu.Lock()
		delete(s.liveRequests, requestID)
		s.liveMu.Unlock()
	}()

	command.ProtocolVersion = 4
	command.SessionID = connection.sessionID
	command.RequestID = requestID
	command.Source = source
	command.RequestedAt = time.Now().UTC()
	if command.TimeoutMS <= 0 {
		command.TimeoutMS = 5_000
	}
	if err := s.writeFrame(connection.conn, command); err != nil {
		return dto.CollectorLiveBetResponse{}, true, err
	}

	select {
	case <-ctx.Done():
		return dto.CollectorLiveBetResponse{}, true, ctx.Err()
	case response := <-responseChannel:
		if !validLiveResult(command.Type, response.Result) {
			return response, true, errors.New("collector returned an unsupported live bet result")
		}
		return response, true, nil
	}
}

func liveCommandContract(commandType string) (string, string, error) {
	switch commandType {
	case "prepare_bet":
		return CapabilityBetPrepare, "bet_prepared", nil
	case "commit_bet":
		return CapabilityBetCommit, "bet_result", nil
	case "cancel_prepared_bet":
		return CapabilityBetPrepare, "bet_cancelled", nil
	case "reconcile_bet":
		return CapabilityBetReconcile, "bet_reconciled", nil
	default:
		return "", "", errors.New("unsupported live bet command")
	}
}

func validateLiveCommand(command dto.CollectorLiveBetRequest) error {
	if strings.TrimSpace(command.ActionID) == "" || strings.TrimSpace(command.AttemptID) == "" ||
		strings.TrimSpace(command.OpportunityID) == "" || strings.TrimSpace(command.LegID) == "" ||
		strings.TrimSpace(command.AccountID) == "" || command.ExpiresAt.IsZero() ||
		!command.ExpiresAt.After(time.Now().UTC()) {
		return errors.New("live bet command is invalid or expired")
	}
	switch command.Type {
	case "prepare_bet":
		if strings.TrimSpace(command.FixtureID) == "" || strings.TrimSpace(command.MarketID) == "" ||
			strings.TrimSpace(command.OutcomeID) == "" || strings.TrimSpace(command.ProviderRef) == "" ||
			!finiteLiveOdds(command.ExpectedOdds) ||
			(command.OddsFormat != "malay" && command.OddsFormat != "indonesian") {
			return errors.New("live prepare command is incomplete")
		}
	case "commit_bet":
		if strings.TrimSpace(command.PrepareID) == "" || strings.TrimSpace(command.IdempotencyKey) == "" ||
			command.StakeVND <= 0 || !finiteLiveOdds(command.ExpectedOdds) {
			return errors.New("live commit command is incomplete")
		}
	case "cancel_prepared_bet":
		if strings.TrimSpace(command.PrepareID) == "" {
			return errors.New("live cancel command is incomplete")
		}
	case "reconcile_bet":
		if strings.TrimSpace(command.IdempotencyKey) == "" {
			return errors.New("live reconciliation command is incomplete")
		}
	}
	return nil
}

func finiteLiveOdds(value float64) bool {
	return value != 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func validLiveResult(commandType, result string) bool {
	switch commandType {
	case "prepare_bet":
		return result == "prepared" || result == "rejected"
	case "commit_bet", "reconcile_bet":
		return result == "ticket_accepted" || result == "odds_changed" || result == "rejected" ||
			result == "submission_unknown"
	case "cancel_prepared_bet":
		return result == "cancelled" || result == "rejected"
	default:
		return false
	}
}

func (s *StreamService) deliverLiveBetResponse(
	source dto.CollectorSource,
	response dto.CollectorLiveBetResponse,
) {
	s.liveMu.Lock()
	pending, ok := s.liveRequests[response.RequestID]
	s.liveMu.Unlock()
	if !ok {
		return
	}
	if pending.source != source || pending.source != response.Source ||
		pending.sessionID != response.SessionID || response.ProtocolVersion != 4 ||
		pending.responseType != response.Type || pending.actionID != response.ActionID ||
		pending.attemptID != response.AttemptID || pending.opportunityID != response.OpportunityID ||
		pending.legID != response.LegID || pending.accountID != response.AccountID ||
		(pending.prepareID != "" && pending.prepareID != response.PrepareID) ||
		(pending.idempotencyKey != "" && pending.idempotencyKey != response.IdempotencyKey) {
		response.Result = "rejected"
		response.Error = "collector live bet response correlation mismatch"
	}
	select {
	case pending.responses <- response:
	default:
	}
}
