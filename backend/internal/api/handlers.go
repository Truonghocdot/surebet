package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/repository"
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

type RealtimeService interface {
	ServeHTTP(w http.ResponseWriter, r *http.Request)
}

type CollectorConfigService interface {
	GetCollectorConfig(ctx context.Context) (dto.CollectorRuntimeConfigView, error)
	UpdateCollectorConfig(ctx context.Context, request dto.UpdateCollectorRuntimeConfigRequest) (dto.CollectorRuntimeConfigView, error)
}

type TelegramWebhookService interface {
	ValidateSecret(provided string) bool
	HandleUpdate(ctx context.Context, update dto.TelegramWebhookUpdate) (dto.TelegramWebhookResult, error)
}

type TelegramAdminService interface {
	ListRecipients(ctx context.Context) ([]dto.TelegramRecipientView, error)
	CreateRecipient(ctx context.Context, request dto.UpsertTelegramRecipientRequest) (dto.TelegramRecipientView, error)
	UpdateRecipient(ctx context.Context, id uint64, request dto.UpsertTelegramRecipientRequest) (dto.TelegramRecipientView, error)
	DeleteRecipient(ctx context.Context, id uint64) error
}

func (s *Server) registerRoutes() {
	s.engine.GET("/healthz", s.handleHealth)
	s.engine.POST("/api/telegram/webhook", s.handleTelegramWebhook)

	v1 := s.engine.Group("/v1")
	v1.POST("/auth/login", s.handleLogin)
	v1.GET("/ws", s.handleRealtimeWebSocket)
	v1.GET("/odds", s.handleOdds)
	v1.GET("/surebets", s.handleSurebets)
	v1.POST("/collector/bootstrap", s.handleCollectorBootstrap)
	v1.POST("/collector/delta", s.handleCollectorDelta)
	v1.POST("/collector/heartbeat", s.handleCollectorHeartbeat)
	v1.GET("/collector/runtime-config", s.handleCollectorRuntimeConfig)
	v1.GET("/admin/telegram-recipients", s.handleAdminTelegramRecipients)
	v1.POST("/admin/telegram-recipients", s.handleAdminTelegramRecipients)
	v1.PUT("/admin/telegram-recipients/:id", s.handleAdminTelegramRecipientByID)
	v1.DELETE("/admin/telegram-recipients/:id", s.handleAdminTelegramRecipientByID)
	v1.GET("/admin/collector-config", s.handleAdminCollectorConfig)
	v1.PUT("/admin/collector-config", s.handleAdminCollectorConfig)
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

func (s *Server) handleCollectorRuntimeConfig(ctx *gin.Context) {
	if s.deps.CollectorConfig == nil {
		placeholder(ctx, "collector config service is not wired yet")
		return
	}

	configValue, err := s.deps.CollectorConfig.GetCollectorConfig(ctx.Request.Context())
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"data": configValue})
}

func placeholder(ctx *gin.Context, message string) {
	ctx.JSON(http.StatusNotImplemented, gin.H{
		"message": message,
		"status":  "architecture-scaffold",
	})
}

func (s *Server) handleTelegramWebhook(ctx *gin.Context) {
	if s.deps.TelegramWebhook == nil {
		placeholder(ctx, "telegram webhook service is not wired yet")
		return
	}

	if !s.deps.TelegramWebhook.ValidateSecret(
		ctx.GetHeader("X-Telegram-Bot-Api-Secret-Token"),
	) {
		ctx.JSON(http.StatusForbidden, gin.H{
			"ok":      false,
			"message": "Webhook secret khong hop le.",
		})
		return
	}

	var update dto.TelegramWebhookUpdate
	if err := ctx.ShouldBindJSON(&update); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := s.deps.TelegramWebhook.HandleUpdate(ctx.Request.Context(), update)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"ok":     true,
		"result": result,
	})
}

func (s *Server) handleAdminTelegramRecipients(ctx *gin.Context) {
	if !s.requireRole(ctx, "super_admin") {
		return
	}

	if s.deps.TelegramAdmin == nil {
		placeholder(ctx, "telegram admin service is not wired yet")
		return
	}

	switch ctx.Request.Method {
	case http.MethodGet:
		items, err := s.deps.TelegramAdmin.ListRecipients(ctx.Request.Context())
		if err != nil {
			ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		ctx.JSON(http.StatusOK, gin.H{"data": items})
	case http.MethodPost:
		var request dto.UpsertTelegramRecipientRequest
		if err := ctx.ShouldBindJSON(&request); err != nil {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		item, err := s.deps.TelegramAdmin.CreateRecipient(ctx.Request.Context(), request)
		if err != nil {
			ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		ctx.JSON(http.StatusCreated, gin.H{"data": item})
	default:
		ctx.JSON(http.StatusMethodNotAllowed, gin.H{"error": "method not allowed"})
	}
}

func (s *Server) handleAdminTelegramRecipientByID(ctx *gin.Context) {
	if !s.requireRole(ctx, "super_admin") {
		return
	}

	if s.deps.TelegramAdmin == nil {
		placeholder(ctx, "telegram admin service is not wired yet")
		return
	}

	id, err := strconv.ParseUint(ctx.Param("id"), 10, 64)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "id không hợp lệ"})
		return
	}

	switch ctx.Request.Method {
	case http.MethodPut:
		var request dto.UpsertTelegramRecipientRequest
		if err := ctx.ShouldBindJSON(&request); err != nil {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		item, err := s.deps.TelegramAdmin.UpdateRecipient(ctx.Request.Context(), id, request)
		if err != nil {
			status := http.StatusInternalServerError
			if err == repository.ErrNotFound {
				status = http.StatusNotFound
			}
			ctx.JSON(status, gin.H{"error": err.Error()})
			return
		}
		ctx.JSON(http.StatusOK, gin.H{"data": item})
	case http.MethodDelete:
		if err := s.deps.TelegramAdmin.DeleteRecipient(ctx.Request.Context(), id); err != nil {
			status := http.StatusInternalServerError
			if err == repository.ErrNotFound {
				status = http.StatusNotFound
			}
			ctx.JSON(status, gin.H{"error": err.Error()})
			return
		}
		ctx.JSON(http.StatusOK, gin.H{"status": "deleted"})
	default:
		ctx.JSON(http.StatusMethodNotAllowed, gin.H{"error": "method not allowed"})
	}
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
