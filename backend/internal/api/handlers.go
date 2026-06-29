package api

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"

	"surebet/backend/internal/dto"
)

type OddsQueryService interface {
	ListCurrentOdds(ctx context.Context, filter dto.OddsFilter) ([]dto.OddsView, error)
}

type CollectorIngestService interface {
	IngestBootstrap(ctx context.Context, request dto.CollectorBootstrapRequest) error
	IngestDelta(ctx context.Context, request dto.CollectorDeltaRequest) error
	Heartbeat(ctx context.Context, request dto.CollectorHeartbeatRequest) error
}

type AuthLoginService interface {
	Login(ctx context.Context, request dto.LoginRequest) (dto.LoginResponse, error)
}

type SurebetQueryService interface {
	ListCurrentSurebets(ctx context.Context) ([]dto.SurebetView, error)
}

type BetCommandService interface {
	CreateManualBet(ctx context.Context, request dto.CreateManualBetRequest) (dto.BetOrderView, error)
}

type FeatureQueryService interface {
	ListFeatureFlags(ctx context.Context) ([]dto.FeatureFlagView, error)
}

type ConfigQueryService interface {
	ListBookmakers(ctx context.Context) ([]dto.BookmakerView, error)
	ListBookmakerAccounts(ctx context.Context) ([]dto.BookmakerAccountView, error)
	ListConfigurations(ctx context.Context, prefix string) ([]dto.ConfigurationView, error)
}

type ConfigWriteService interface {
	ListBookmakerSettings(ctx context.Context) ([]dto.BookmakerSettingView, error)
	UpdateBookmakerSetting(ctx context.Context, request dto.UpdateBookmakerSettingRequest) (dto.BookmakerSettingView, error)
}

func (s *Server) registerRoutes() {
	s.engine.GET("/healthz", s.handleHealth)

	v1 := s.engine.Group("/v1")
	v1.POST("/auth/login", s.handleLogin)
	v1.GET("/odds", s.handleOdds)
	v1.GET("/surebets", s.handleSurebets)
	v1.GET("/features", s.handleFeatures)
	v1.GET("/bookmakers", s.handleBookmakers)
	v1.GET("/bookmaker-accounts", s.handleBookmakerAccounts)
	v1.GET("/configurations", s.handleConfigurations)
	v1.GET("/bookmaker-settings", s.handleBookmakerSettings)
	v1.PUT("/bookmaker-settings", s.handleUpdateBookmakerSetting)
	v1.POST("/bets/manual", s.handleCreateManualBet)
	v1.POST("/collector/bootstrap", s.handleCollectorBootstrap)
	v1.POST("/collector/delta", s.handleCollectorDelta)
	v1.POST("/collector/heartbeat", s.handleCollectorHeartbeat)
}

func (s *Server) handleHealth(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, s.deps.Health.Snapshot(ctx.Request.Context()))
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
		BookmakerID: ctx.Query("bookmaker_id"),
		LobbyID:     ctx.Query("lobby_id"),
		FixtureID:   ctx.Query("fixture_id"),
	}

	items, err := s.deps.OddsQuery.ListCurrentOdds(ctx.Request.Context(), filter)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"data": items})
}

func (s *Server) handleSurebets(ctx *gin.Context) {
	if s.deps.SurebetQuery == nil {
		placeholder(ctx, "surebet query service is not wired yet")
		return
	}

	items, err := s.deps.SurebetQuery.ListCurrentSurebets(ctx.Request.Context())
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"data": items})
}

func (s *Server) handleFeatures(ctx *gin.Context) {
	if s.deps.FeatureQuery == nil {
		placeholder(ctx, "feature query service is not wired yet")
		return
	}

	items, err := s.deps.FeatureQuery.ListFeatureFlags(ctx.Request.Context())
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"data": items})
}

func (s *Server) handleBookmakers(ctx *gin.Context) {
	if s.deps.ConfigQuery == nil {
		placeholder(ctx, "configuration query service is not wired yet")
		return
	}

	items, err := s.deps.ConfigQuery.ListBookmakers(ctx.Request.Context())
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"data": items})
}

func (s *Server) handleBookmakerAccounts(ctx *gin.Context) {
	if s.deps.ConfigQuery == nil {
		placeholder(ctx, "configuration query service is not wired yet")
		return
	}

	items, err := s.deps.ConfigQuery.ListBookmakerAccounts(ctx.Request.Context())
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"data": items})
}

func (s *Server) handleConfigurations(ctx *gin.Context) {
	if s.deps.ConfigQuery == nil {
		placeholder(ctx, "configuration query service is not wired yet")
		return
	}

	items, err := s.deps.ConfigQuery.ListConfigurations(ctx.Request.Context(), ctx.Query("prefix"))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"data": items})
}

func (s *Server) handleCreateManualBet(ctx *gin.Context) {
	if s.deps.BetCommand == nil {
		placeholder(ctx, "bet command service is not wired yet")
		return
	}

	var request dto.CreateManualBetRequest
	if err := ctx.ShouldBindJSON(&request); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	order, err := s.deps.BetCommand.CreateManualBet(ctx.Request.Context(), request)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusAccepted, gin.H{"data": order})
}

func (s *Server) handleBookmakerSettings(ctx *gin.Context) {
	if s.deps.ConfigWrite == nil {
		placeholder(ctx, "configuration write service is not wired yet")
		return
	}

	items, err := s.deps.ConfigWrite.ListBookmakerSettings(ctx.Request.Context())
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"data": items})
}

func (s *Server) handleUpdateBookmakerSetting(ctx *gin.Context) {
	if s.deps.ConfigWrite == nil {
		placeholder(ctx, "configuration write service is not wired yet")
		return
	}

	var request dto.UpdateBookmakerSettingRequest
	if err := ctx.ShouldBindJSON(&request); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	item, err := s.deps.ConfigWrite.UpdateBookmakerSetting(ctx.Request.Context(), request)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"data": item})
}

func (s *Server) handleCollectorBootstrap(ctx *gin.Context) {
	if s.deps.CollectorIngest == nil {
		placeholder(ctx, "collector ingest service is not wired yet")
		return
	}

	var request dto.CollectorBootstrapRequest
	if err := ctx.ShouldBindJSON(&request); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := s.deps.CollectorIngest.IngestBootstrap(ctx.Request.Context(), request); err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusAccepted, gin.H{"status": "accepted"})
}

func (s *Server) handleCollectorDelta(ctx *gin.Context) {
	if s.deps.CollectorIngest == nil {
		placeholder(ctx, "collector ingest service is not wired yet")
		return
	}

	var request dto.CollectorDeltaRequest
	if err := ctx.ShouldBindJSON(&request); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := s.deps.CollectorIngest.IngestDelta(ctx.Request.Context(), request); err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusAccepted, gin.H{"status": "accepted"})
}

func (s *Server) handleCollectorHeartbeat(ctx *gin.Context) {
	if s.deps.CollectorIngest == nil {
		placeholder(ctx, "collector ingest service is not wired yet")
		return
	}

	var request dto.CollectorHeartbeatRequest
	if err := ctx.ShouldBindJSON(&request); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := s.deps.CollectorIngest.Heartbeat(ctx.Request.Context(), request); err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusAccepted, gin.H{"status": "accepted"})
}

func placeholder(ctx *gin.Context, message string) {
	ctx.JSON(http.StatusNotImplemented, gin.H{
		"message": message,
		"status":  "architecture-scaffold",
	})
}
