package api

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"surebet/backend/internal/autobet"
	"surebet/backend/internal/betaction"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/repository"
)

type OddsQueryService interface {
	ListCurrentOdds(ctx context.Context, filter dto.OddsFilter) ([]dto.OddsView, error)
}

type CollectorStreamService interface {
	ServeHTTP(w http.ResponseWriter, r *http.Request)
	AuthenticateCollectorRequest(r *http.Request) (int, error)
	ListAccountBalances(ctx context.Context) (dto.CollectorAccountBalanceListView, error)
}

type AuthLoginService interface {
	Login(ctx context.Context, request dto.LoginRequest) (dto.LoginResponse, error)
}

type SurebetQueryService interface {
	ListCurrentSurebets(ctx context.Context) ([]dto.SurebetView, error)
}

type SurebetConfirmationService interface {
	ConfirmCurrentSurebet(ctx context.Context, opportunityID string) (dto.SurebetView, bool, error)
	GetVerifiedSurebet(ctx context.Context, opportunityID string) (dto.SurebetView, bool, error)
	ListConfirmedSurebets(ctx context.Context) ([]dto.SurebetView, error)
}

type RealtimeService interface {
	ServeHTTP(w http.ResponseWriter, r *http.Request)
}

type CollectorConfigService interface {
	GetCollectorConfig(ctx context.Context) (dto.CollectorRuntimeConfigView, error)
	UpdateCollectorConfig(ctx context.Context, request dto.UpdateCollectorRuntimeConfigRequest) (dto.CollectorRuntimeConfigView, error)
}

type BetActionService interface {
	Get(ctx context.Context, id string) (dto.BetActionView, error)
	List(ctx context.Context, status string, limit int) ([]dto.BetActionView, error)
}

type LiveBetQueryService interface {
	GetExposure(ctx context.Context, id string) (dto.BetExposureView, error)
	ListExposures(ctx context.Context, status string, limit int) ([]dto.BetExposureView, error)
	ListAttempts(ctx context.Context, actionID, exposureID string, limit int) ([]dto.BetAttemptView, error)
	ListEvents(ctx context.Context, actionID string, afterSequence int64, limit int) ([]dto.BetActionJournalEventView, error)
}

type LiveBetOperationService interface {
	ReconcileAction(ctx context.Context, actionID string, expectedVersion int64) (dto.BetActionView, error)
	ResolveExposure(ctx context.Context, exposureID string, request dto.ManualExposureResolutionRequest) (dto.BetExposureView, error)
}

func (s *Server) registerRoutes() {
	s.engine.GET("/healthz", s.handleHealth)

	v1 := s.engine.Group("/v1")
	v1.POST("/auth/login", s.handleLogin)
	v1.GET("/ws", s.handleRealtimeWebSocket)
	v1.GET("/odds", s.handleOdds)
	v1.GET("/surebets", s.handleSurebets)
	v1.GET("/collector/runtime-config", s.handleCollectorRuntimeConfig)
	v1.GET("/admin/collector-config", s.handleAdminCollectorConfig)
	v1.PUT("/admin/collector-config", s.handleAdminCollectorConfig)

	v2 := s.engine.Group("/v2")
	v2.GET("/collector/stream", s.handleCollectorStream)
	v2.GET("/internal/account-balances", s.handleListAccountBalances)
	v2.GET("/internal/auto-bet/control", s.handleGetAutoBetControl)
	v2.PUT("/internal/auto-bet/control", s.handleUpdateAutoBetControl)
	v2.GET("/internal/bet-actions", s.handleListBetActions)
	v2.GET("/internal/bet-actions/:id", s.handleGetBetAction)
	v2.GET("/internal/bet-actions/:id/events", s.handleListBetActionEvents)
	v2.POST("/internal/bet-actions/:id/reconcile", s.handleReconcileBetAction)
	v2.GET("/internal/bet-attempts", s.handleListBetAttempts)
	v2.GET("/internal/bet-exposures", s.handleListBetExposures)
	v2.GET("/internal/bet-exposures/:id", s.handleGetBetExposure)
	v2.POST("/internal/bet-exposures/:id/resolve", s.handleResolveBetExposure)
	v2.POST("/internal/surebets/:id/confirm", s.handleConfirmSurebet)
	v2.GET("/internal/surebets/:id/verified", s.handleGetVerifiedSurebet)
	v2.GET("/internal/surebets/confirmed", s.handleListConfirmedSurebets)
}

type autoBetControlUpdateRequest struct {
	Enabled       bool  `json:"enabled"`
	TotalStakeVND int64 `json:"total_stake_vnd"`
}

func (s *Server) handleGetAutoBetControl(ctx *gin.Context) {
	if !s.requireInternalToken(ctx) {
		return
	}
	if s.deps.AutoBetControl == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "auto-bet control is not configured"})
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"data": s.deps.AutoBetControl.Snapshot()})
}

func (s *Server) handleUpdateAutoBetControl(ctx *gin.Context) {
	if !s.requireInternalToken(ctx) {
		return
	}
	if s.deps.AutoBetControl == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "auto-bet control is not configured"})
		return
	}
	var request autoBetControlUpdateRequest
	if err := ctx.ShouldBindJSON(&request); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	state, err := s.deps.AutoBetControl.Update(request.Enabled, request.TotalStakeVND)
	if err != nil {
		if errors.Is(err, autobet.ErrInvalidTotalStake) {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"data": state})
}

func (s *Server) handleListAccountBalances(ctx *gin.Context) {
	if !s.requireInternalToken(ctx) {
		return
	}
	if s.deps.CollectorStream == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "collector stream service is not configured"})
		return
	}
	balances, err := s.deps.CollectorStream.ListAccountBalances(ctx.Request.Context())
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"data": balances})
}

func (s *Server) handleReconcileBetAction(ctx *gin.Context) {
	if !s.requireInternalToken(ctx) {
		return
	}
	if s.deps.LiveBetOperations == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "live bet operation service is not configured"})
		return
	}
	var request dto.ReconcileBetActionRequest
	if err := ctx.ShouldBindJSON(&request); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	action, err := s.deps.LiveBetOperations.ReconcileAction(
		ctx.Request.Context(), strings.TrimSpace(ctx.Param("id")), request.ExpectedVersion,
	)
	if err != nil {
		writeBetActionError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"data": action})
}

func (s *Server) handleResolveBetExposure(ctx *gin.Context) {
	if !s.requireInternalToken(ctx) {
		return
	}
	if s.deps.LiveBetOperations == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "live bet operation service is not configured"})
		return
	}
	var request dto.ManualExposureResolutionRequest
	if err := ctx.ShouldBindJSON(&request); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	exposure, err := s.deps.LiveBetOperations.ResolveExposure(
		ctx.Request.Context(), strings.TrimSpace(ctx.Param("id")), request,
	)
	if err != nil {
		writeBetActionError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"data": exposure})
}

func (s *Server) handleGetBetExposure(ctx *gin.Context) {
	if s.deps.LiveBetQueries == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "live bet query service is not configured"})
		return
	}
	if !s.requireInternalToken(ctx) {
		return
	}
	exposure, err := s.deps.LiveBetQueries.GetExposure(ctx.Request.Context(), ctx.Param("id"))
	if err != nil {
		writeBetActionError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"data": exposure})
}

func (s *Server) handleListBetExposures(ctx *gin.Context) {
	if s.deps.LiveBetQueries == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "live bet query service is not configured"})
		return
	}
	if !s.requireInternalToken(ctx) {
		return
	}
	limit, ok := parseBoundedLimit(ctx)
	if !ok {
		return
	}
	cacheKey := fmt.Sprintf("bet-exposures:%s:%d", ctx.Query("status"), limit)
	if cached, hit := s.cache.get(cacheKey, time.Now()); hit {
		ctx.JSON(http.StatusOK, gin.H{"data": cached})
		return
	}
	exposures, err := s.deps.LiveBetQueries.ListExposures(
		ctx.Request.Context(),
		ctx.Query("status"),
		limit,
	)
	if err != nil {
		writeBetActionError(ctx, err)
		return
	}
	s.cache.set(cacheKey, exposures, 750*time.Millisecond, time.Now())
	ctx.JSON(http.StatusOK, gin.H{"data": exposures})
}

func (s *Server) handleListBetAttempts(ctx *gin.Context) {
	if s.deps.LiveBetQueries == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "live bet query service is not configured"})
		return
	}
	if !s.requireInternalToken(ctx) {
		return
	}
	limit, ok := parseBoundedLimit(ctx)
	if !ok {
		return
	}
	attempts, err := s.deps.LiveBetQueries.ListAttempts(
		ctx.Request.Context(),
		ctx.Query("action_id"),
		ctx.Query("exposure_id"),
		limit,
	)
	if err != nil {
		writeBetActionError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"data": attempts})
}

func (s *Server) handleListBetActionEvents(ctx *gin.Context) {
	if s.deps.LiveBetQueries == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "live bet query service is not configured"})
		return
	}
	if !s.requireInternalToken(ctx) {
		return
	}
	limit, ok := parseBoundedLimit(ctx)
	if !ok {
		return
	}
	afterSequence := int64(0)
	if raw := strings.TrimSpace(ctx.Query("after_sequence")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "after_sequence must be a non-negative integer"})
			return
		}
		afterSequence = parsed
	}
	events, err := s.deps.LiveBetQueries.ListEvents(
		ctx.Request.Context(),
		ctx.Param("id"),
		afterSequence,
		limit,
	)
	if err != nil {
		writeBetActionError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"data": events})
}

func parseBoundedLimit(ctx *gin.Context) (int, bool) {
	raw := strings.TrimSpace(ctx.Query("limit"))
	if raw == "" {
		return 100, true
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit <= 0 || limit > 500 {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "limit must be between 1 and 500"})
		return 0, false
	}
	return limit, true
}

func (s *Server) handleGetBetAction(ctx *gin.Context) {
	if s.deps.BetActions == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "bet action service is not configured"})
		return
	}
	if !s.requireInternalToken(ctx) {
		return
	}

	action, err := s.deps.BetActions.Get(ctx.Request.Context(), ctx.Param("id"))
	if err != nil {
		writeBetActionError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"data": action})
}

func (s *Server) handleListBetActions(ctx *gin.Context) {
	if s.deps.BetActions == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "bet action service is not configured"})
		return
	}
	if !s.requireInternalToken(ctx) {
		return
	}

	limit := 0
	if rawLimit := strings.TrimSpace(ctx.Query("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "limit must be an integer"})
			return
		}
		limit = parsed
	}
	cacheKey := fmt.Sprintf("bet-actions:%s:%d", ctx.Query("status"), limit)
	if cached, hit := s.cache.get(cacheKey, time.Now()); hit {
		ctx.JSON(http.StatusOK, gin.H{"data": cached})
		return
	}
	actions, err := s.deps.BetActions.List(ctx.Request.Context(), ctx.Query("status"), limit)
	if err != nil {
		writeBetActionError(ctx, err)
		return
	}
	s.cache.set(cacheKey, actions, 750*time.Millisecond, time.Now())
	ctx.JSON(http.StatusOK, gin.H{"data": actions})
}

func writeBetActionError(ctx *gin.Context, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, betaction.ErrInvalidRequest):
		status = http.StatusBadRequest
	case errors.Is(err, repository.ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, repository.ErrVersionConflict), errors.Is(err, betaction.ErrInvalidStateTransition):
		status = http.StatusConflict
	case errors.Is(err, betaction.ErrNoProfitableHedge), errors.Is(err, betaction.ErrInvalidHedgeTerms):
		status = http.StatusUnprocessableEntity
	case errors.Is(err, betaction.ErrLiveExecutionDisabled):
		status = http.StatusServiceUnavailable
	}
	ctx.JSON(status, gin.H{"error": err.Error()})
}

func (s *Server) handleGetVerifiedSurebet(ctx *gin.Context) {
	if s.deps.SurebetConfirm == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "surebet confirmation is not configured"})
		return
	}
	if !s.requireInternalToken(ctx) {
		return
	}
	item, found, err := s.deps.SurebetConfirm.GetVerifiedSurebet(
		ctx.Request.Context(),
		strings.TrimSpace(ctx.Param("id")),
	)
	if err != nil {
		ctx.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if !found {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "verified surebet expired"})
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"data": item})
}

func (s *Server) handleHealth(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, s.deps.Health.Snapshot(ctx.Request.Context()))
}

func (s *Server) handleRealtimeWebSocket(ctx *gin.Context) {
	if s.deps.Realtime == nil {
		placeholder(ctx, "realtime websocket service is not wired yet")
		return
	}

	s.deps.Realtime.ServeHTTP(ctx.Writer, ctx.Request)
}

func (s *Server) handleLogin(ctx *gin.Context) {
	if s.deps.AuthLogin == nil {
		placeholder(ctx, "auth login service is not wired yet")
		return
	}

	var request dto.LoginRequest
	if err := ctx.ShouldBindJSON(&request); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response, err := s.deps.AuthLogin.Login(ctx.Request.Context(), request)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"data": response})
}

func (s *Server) handleOdds(ctx *gin.Context) {
	if s.deps.OddsQuery == nil {
		placeholder(ctx, "odds query service is not wired yet")
		return
	}

	filter := dto.OddsFilter{
		BookmakerID:      ctx.Query("bookmaker_id"),
		LobbyID:          ctx.Query("lobby_id"),
		FixtureID:        ctx.Query("fixture_id"),
		IncludeSuspended: ctx.Query("include_suspended") == "true",
	}
	cacheKey := "odds:" + ctx.Request.URL.RawQuery
	if cached, hit := s.cache.get(cacheKey, time.Now()); hit {
		ctx.JSON(http.StatusOK, gin.H{"data": cached})
		return
	}

	items, err := s.deps.OddsQuery.ListCurrentOdds(ctx.Request.Context(), filter)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.cache.set(cacheKey, items, 300*time.Millisecond, time.Now())

	ctx.JSON(http.StatusOK, gin.H{"data": items})
}

func (s *Server) handleSurebets(ctx *gin.Context) {
	if s.deps.SurebetQuery == nil {
		placeholder(ctx, "surebet query service is not wired yet")
		return
	}
	if cached, hit := s.cache.get("surebets", time.Now()); hit {
		ctx.JSON(http.StatusOK, gin.H{"data": cached})
		return
	}

	items, err := s.deps.SurebetQuery.ListCurrentSurebets(ctx.Request.Context())
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.cache.set("surebets", items, 500*time.Millisecond, time.Now())

	ctx.JSON(http.StatusOK, gin.H{"data": items})
}

func (s *Server) handleCollectorRuntimeConfig(ctx *gin.Context) {
	if s.deps.CollectorConfig == nil {
		placeholder(ctx, "collector config service is not wired yet")
		return
	}
	if s.deps.CollectorStream == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "collector authentication is not configured"})
		return
	}
	if status, err := s.deps.CollectorStream.AuthenticateCollectorRequest(ctx.Request); err != nil {
		ctx.JSON(status, gin.H{"error": err.Error()})
		return
	}

	configValue, err := s.deps.CollectorConfig.GetCollectorConfig(ctx.Request.Context())
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"data": configValue})
}

func (s *Server) handleCollectorStream(ctx *gin.Context) {
	if s.deps.CollectorStream == nil {
		placeholder(ctx, "collector stream service is not wired yet")
		return
	}

	s.deps.CollectorStream.ServeHTTP(ctx.Writer, ctx.Request)
}

func (s *Server) handleConfirmSurebet(ctx *gin.Context) {
	if s.deps.SurebetConfirm == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "surebet confirmation is not configured"})
		return
	}
	if !s.requireInternalToken(ctx) {
		return
	}

	item, confirmed, err := s.deps.SurebetConfirm.ConfirmCurrentSurebet(
		ctx.Request.Context(),
		strings.TrimSpace(ctx.Param("id")),
	)
	if err != nil {
		ctx.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if !confirmed {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "surebet is no longer confirmed"})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"data": item})
}

func (s *Server) handleListConfirmedSurebets(ctx *gin.Context) {
	if s.deps.SurebetConfirm == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "surebet confirmation is not configured"})
		return
	}
	if !s.requireInternalToken(ctx) {
		return
	}

	items, err := s.deps.SurebetConfirm.ListConfirmedSurebets(ctx.Request.Context())
	if err != nil {
		ctx.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"data": items})
}

func (s *Server) requireInternalToken(ctx *gin.Context) bool {
	expected := strings.TrimSpace(s.deps.InternalToken)
	if expected == "" {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "internal token is not configured"})
		return false
	}
	provided := ctx.GetHeader("X-Surebet-Internal-Token")
	if len(provided) != len(expected) || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		ctx.JSON(http.StatusUnauthorized, gin.H{"error": "invalid internal token"})
		return false
	}
	return true
}

func placeholder(ctx *gin.Context, message string) {
	ctx.JSON(http.StatusNotImplemented, gin.H{
		"message": message,
		"status":  "architecture-scaffold",
	})
}

func (s *Server) handleAdminCollectorConfig(ctx *gin.Context) {
	if !s.requireRole(ctx, "super_admin") {
		return
	}

	if s.deps.CollectorConfig == nil {
		placeholder(ctx, "collector config service is not wired yet")
		return
	}

	switch ctx.Request.Method {
	case http.MethodGet:
		configValue, err := s.deps.CollectorConfig.GetCollectorConfig(ctx.Request.Context())
		if err != nil {
			ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		ctx.JSON(http.StatusOK, gin.H{"data": configValue})
	case http.MethodPut:
		var request dto.UpdateCollectorRuntimeConfigRequest
		if err := ctx.ShouldBindJSON(&request); err != nil {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		configValue, err := s.deps.CollectorConfig.UpdateCollectorConfig(
			ctx.Request.Context(),
			request,
		)
		if err != nil {
			ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		ctx.JSON(http.StatusOK, gin.H{"data": configValue})
	default:
		ctx.JSON(http.StatusMethodNotAllowed, gin.H{"error": "method not allowed"})
	}
}

func (s *Server) requireRole(ctx *gin.Context, expectedRole string) bool {
	if s.deps.AuthTokens == nil {
		ctx.JSON(http.StatusUnauthorized, gin.H{"error": "auth token service is not wired yet"})
		return false
	}

	header := strings.TrimSpace(ctx.GetHeader("Authorization"))
	if !strings.HasPrefix(header, "Bearer ") {
		ctx.JSON(http.StatusUnauthorized, gin.H{"error": "missing bearer token"})
		return false
	}

	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	claims, err := s.deps.AuthTokens.ParseAccessToken(ctx.Request.Context(), token)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return false
	}

	for _, role := range claims.Roles {
		if role == expectedRole {
			return true
		}
	}

	ctx.JSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
	return false
}
