package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"surebet/backend/internal/auth"
	"surebet/backend/internal/config"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/middleware"
	"surebet/backend/pkg/health"
)

type Dependencies struct {
	Health          health.Reporter
	Logger          logger.Logger
	AuthLogin       AuthLoginService
	AuthTokens      auth.TokenManager
	CollectorConfig CollectorConfigService
	OddsQuery       OddsQueryService
	CollectorIngest CollectorIngestService
	CollectorStream CollectorStreamService
	TelegramAdmin   TelegramAdminService
	TelegramWebhook TelegramWebhookService
	Realtime        RealtimeService
	SurebetQuery    SurebetQueryService
}

type Server struct {
	cfg    config.HTTPConfig
	deps   Dependencies
	engine *gin.Engine
}

func NewServer(cfg config.HTTPConfig, deps Dependencies) *Server {
	if deps.Logger == nil {
		panic("api logger is required")
	}

	if deps.Health == nil {
		deps.Health = health.NewStaticReporter("surebet-platform")
	}

	engine := gin.New()
	engine.Use(gin.Recovery())
	engine.Use(middleware.RequestLogging(deps.Logger))

	server := &Server{
		cfg:    cfg,
		deps:   deps,
		engine: engine,
	}
	server.registerRoutes()

	return server
}

func (s *Server) Addr() string {
	return s.cfg.Address
}

func (s *Server) Handler() http.Handler {
	return s.engine
}

func (s *Server) Run() error {
	httpServer := &http.Server{
		Addr:              s.cfg.Address,
		Handler:           s.engine,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       s.cfg.ReadTimeout,
		WriteTimeout:      s.cfg.WriteTimeout,
	}

	return httpServer.ListenAndServe()
}
