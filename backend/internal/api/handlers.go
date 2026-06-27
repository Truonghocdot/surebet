package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"surebet/backend/internal/dto"
)

type OddsQueryService interface {
	ListCurrentOdds(ctx *gin.Context, filter dto.OddsFilter) ([]dto.OddsView, error)
}

type SurebetQueryService interface {
	ListCurrentSurebets(ctx *gin.Context) ([]dto.SurebetView, error)
}

type BetCommandService interface {
	CreateManualBet(ctx *gin.Context, request dto.CreateManualBetRequest) (dto.BetOrderView, error)
}

type FeatureQueryService interface {
	ListFeatureFlags(ctx *gin.Context) ([]dto.FeatureFlagView, error)
}

func (s *Server) registerRoutes() {
	s.engine.GET("/healthz", s.handleHealth)

	v1 := s.engine.Group("/v1")
	v1.GET("/odds", s.handleOdds)
	v1.GET("/surebets", s.handleSurebets)
	v1.GET("/features", s.handleFeatures)
	v1.POST("/bets/manual", s.handleCreateManualBet)
}

func (s *Server) handleHealth(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, s.deps.Health.Snapshot(ctx.Request.Context()))
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

	items, err := s.deps.OddsQuery.ListCurrentOdds(ctx, filter)
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

	items, err := s.deps.SurebetQuery.ListCurrentSurebets(ctx)
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

	items, err := s.deps.FeatureQuery.ListFeatureFlags(ctx)
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

	order, err := s.deps.BetCommand.CreateManualBet(ctx, request)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusAccepted, gin.H{"data": order})
}

func placeholder(ctx *gin.Context, message string) {
	ctx.JSON(http.StatusNotImplemented, gin.H{
		"message": message,
		"status":  "architecture-scaffold",
	})
}
