package api

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"surebet/backend/internal/auth"
	"surebet/backend/internal/autobet"
	"surebet/backend/internal/config"
	"surebet/backend/internal/logger"
	"surebet/backend/internal/middleware"
	"surebet/backend/pkg/health"
)

type Dependencies struct {
	Health            health.Reporter
	Logger            logger.Logger
	AuthLogin         AuthLoginService
	AuthTokens        auth.TokenManager
	CollectorConfig   CollectorConfigService
	OddsQuery         OddsQueryService
	CollectorStream   CollectorStreamService
	SurebetConfirm    SurebetConfirmationService
	InternalToken     string
	Realtime          RealtimeService
	SurebetQuery      SurebetQueryService
	BetActions        BetActionService
	LiveBetQueries    LiveBetQueryService
	LiveBetOperations LiveBetOperationService
	AutoBetControl    *autobet.Control
}

type Server struct {
	cfg    config.HTTPConfig
	deps   Dependencies
	engine *gin.Engine
	cache  *responseCache
}

type responseCache struct {
	mu      sync.Mutex
	entries map[string]responseCacheEntry
}

type responseCacheEntry struct {
	value     any
	expiresAt time.Time
}

func newResponseCache() *responseCache {
	return &responseCache{entries: make(map[string]responseCacheEntry)}
}

func (c *responseCache) get(key string, now time.Time) (any, bool) {
	if c == nil {
		return nil, false
	}
	c.mu.Lock()
	entry, ok := c.entries[key]
	if ok && !now.Before(entry.expiresAt) {
		delete(c.entries, key)
		ok = false
	}
	c.mu.Unlock()
	if !ok {
		return nil, false
	}
	return entry.value, true
}

func (c *responseCache) set(key string, value any, ttl time.Duration, now time.Time) {
	if c == nil || ttl <= 0 {
		return
	}
	c.mu.Lock()
	c.entries[key] = responseCacheEntry{value: value, expiresAt: now.Add(ttl)}
	if len(c.entries) > 256 {
		for cachedKey, entry := range c.entries {
			if !now.Before(entry.expiresAt) {
				delete(c.entries, cachedKey)
			}
		}
	}
	c.mu.Unlock()
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
		cache:  newResponseCache(),
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
