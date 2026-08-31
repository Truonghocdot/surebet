package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"surebet/backend/internal/dto"
)

func TestHandleListAccountBalancesRequiresInternalToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v2/internal/account-balances", nil)
	server := &Server{deps: Dependencies{
		CollectorStream: &accountBalanceStreamStub{},
		InternalToken:   "internal-token",
	}}

	server.handleListAccountBalances(ctx)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestHandleListAccountBalancesReturnsCurrentTelemetry(t *testing.T) {
	gin.SetMode(gin.TestMode)
	now := time.Now().UTC()
	stub := &accountBalanceStreamStub{result: dto.CollectorAccountBalanceListView{
		Items: []dto.CollectorAccountBalanceView{{
			AccountID: "account-1",
			Source: dto.CollectorSource{
				CollectorID: "jun88-cmd", BookmakerID: "jun88", LobbyID: "cmd",
			},
			Balance:    dto.CollectorAccountBalanceValue{Amount: 1200, Currency: "VD"},
			ObservedAt: now,
			ReceivedAt: now,
			Stale:      false,
		}},
		ServerTime:        now,
		StaleAfterSeconds: 45,
	}}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v2/internal/account-balances", nil)
	ctx.Request.Header.Set("X-Surebet-Internal-Token", "internal-token")
	server := &Server{deps: Dependencies{CollectorStream: stub, InternalToken: "internal-token"}}

	server.handleListAccountBalances(ctx)
	if recorder.Code != http.StatusOK || stub.calls != 1 {
		t.Fatalf("expected current telemetry, code=%d calls=%d body=%s", recorder.Code, stub.calls, recorder.Body.String())
	}
	var payload struct {
		Data dto.CollectorAccountBalanceListView `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode account balance response: %v", err)
	}
	if len(payload.Data.Items) != 1 || payload.Data.Items[0].Balance.Currency != "VD" ||
		payload.Data.StaleAfterSeconds != 45 {
		t.Fatalf("unexpected account balance response: %+v", payload.Data)
	}
}

type accountBalanceStreamStub struct {
	result dto.CollectorAccountBalanceListView
	err    error
	calls  int
}

func (s *accountBalanceStreamStub) ServeHTTP(http.ResponseWriter, *http.Request) {}

func (s *accountBalanceStreamStub) AuthenticateCollectorRequest(*http.Request) (int, error) {
	return http.StatusOK, nil
}

func (s *accountBalanceStreamStub) ListAccountBalances(
	context.Context,
) (dto.CollectorAccountBalanceListView, error) {
	s.calls++
	return s.result, s.err
}
