package middleware

import (
	"time"

	"github.com/gin-gonic/gin"

	"surebet/backend/internal/logger"
)

func RequestLogging(log logger.Logger) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		startedAt := time.Now()
		ctx.Next()

		log.Info(
			"http request",
			"method", ctx.Request.Method,
			"path", ctx.Request.URL.Path,
			"status", ctx.Writer.Status(),
			"duration_ms", time.Since(startedAt).Milliseconds(),
		)
	}
}
