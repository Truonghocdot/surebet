package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"surebet/backend/internal/autobet"
	"surebet/backend/internal/dto"
	"surebet/backend/internal/repository"
)

func TestHandleAutoBetControlRoundTrip(t *testing.T) {
	gin.SetMode(gin.TestMode)
	control := autobet.NewControl(false, 100_000)
	server := &Server{deps: Dependencies{AutoBetControl: control, InternalToken: "internal-token"}}

	getRecorder := httptest.NewRecorder()
	getCtx, _ := gin.CreateTestContext(getRecorder)
	getCtx.Request = httptest.NewRequest(http.MethodGet, "/v2/internal/auto-bet/control", nil)
	getCtx.Request.Header.Set("X-Surebet-Internal-Token", "internal-token")
	server.handleGetAutoBetControl(getCtx)
	if getRecorder.Code != http.StatusOK || !bytes.Contains(getRecorder.Body.Bytes(), []byte(`"total_stake_vnd":100000`)) {
		t.Fatalf("unexpected control GET: %d %s", getRecorder.Code, getRecorder.Body.String())
	}

	putRecorder := httptest.NewRecorder()
	putCtx, _ := gin.CreateTestContext(putRecorder)
	putCtx.Request = httptest.NewRequest(http.MethodPut, "/v2/internal/auto-bet/control", bytes.NewBufferString(`{"enabled":true,"total_stake_vnd":250000}`))
	putCtx.Request.Header.Set("Content-Type", "application/json")
	putCtx.Request.Header.Set("X-Surebet-Internal-Token", "internal-token")
	server.handleUpdateAutoBetControl(putCtx)
	if putRecorder.Code != http.StatusOK || !control.Snapshot().Enabled || control.Snapshot().TotalStakeVND != 250_000 {
		t.Fatalf("unexpected control PUT: %d %s state=%+v", putRecorder.Code, putRecorder.Body.String(), control.Snapshot())
	}
}

func TestHandleListBetExposuresRequiresInternalToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v2/internal/bet-exposures", nil)
	server := &Server{deps: Dependencies{
		LiveBetQueries: liveBetQueryStub{},
		InternalToken:  "internal-token",
	}}

	server.handleListBetExposures(ctx)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestHandleListBetExposuresReturnsMonitorContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v2/internal/bet-exposures?status=exposure_open&limit=25", nil)
	ctx.Request.Header.Set("X-Surebet-Internal-Token", "internal-token")
	server := &Server{deps: Dependencies{
		LiveBetQueries: liveBetQueryStub{exposures: []dto.BetExposureView{{
			ExposureID: "exposure-1", ActionID: "action-1", Status: "exposure_open",
			Jun88TicketID: "JUN-1",
		}}},
		InternalToken: "internal-token",
	}}

	server.handleListBetExposures(ctx)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected success, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Data []dto.BetExposureView `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Data) != 1 || payload.Data[0].Jun88TicketID != "JUN-1" {
		t.Fatalf("unexpected exposure payload: %+v", payload.Data)
	}
}

func TestHandleListBetAttemptsRequiresBoundedOwnerQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v2/internal/bet-attempts?limit=501", nil)
	ctx.Request.Header.Set("X-Surebet-Internal-Token", "internal-token")
	server := &Server{deps: Dependencies{
		LiveBetQueries: liveBetQueryStub{},
		InternalToken:  "internal-token",
	}}

	server.handleListBetAttempts(ctx)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected bounded limit error, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestHandleReconcileBetActionRequiresTokenBeforeOperation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodPost, "/v2/internal/bet-actions/action-1/reconcile",
		bytes.NewBufferString(`{"expected_version":3}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	operations := &liveBetOperationStub{}
	server := &Server{deps: Dependencies{
		LiveBetOperations: operations,
		InternalToken:     "internal-token",
	}}

	server.handleReconcileBetAction(ctx)
	if recorder.Code != http.StatusUnauthorized || operations.reconcileCalls != 0 {
		t.Fatalf("unauthorized request reached operation service: code=%d calls=%d", recorder.Code, operations.reconcileCalls)
	}
}

func TestHandleReconcileBetActionPassesCASVersion(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Params = gin.Params{{Key: "id", Value: "action-1"}}
	ctx.Request = httptest.NewRequest(
		http.MethodPost, "/v2/internal/bet-actions/action-1/reconcile",
		bytes.NewBufferString(`{"expected_version":3}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Request.Header.Set("X-Surebet-Internal-Token", "internal-token")
	operations := &liveBetOperationStub{action: dto.BetActionView{ActionID: "action-1", Version: 4}}
	server := &Server{deps: Dependencies{
		LiveBetOperations: operations,
		InternalToken:     "internal-token",
	}}

	server.handleReconcileBetAction(ctx)
	if recorder.Code != http.StatusOK || operations.actionID != "action-1" || operations.expectedVersion != 3 {
		t.Fatalf("unexpected reconcile request: code=%d id=%q version=%d body=%s", recorder.Code, operations.actionID, operations.expectedVersion, recorder.Body.String())
	}
}

func TestHandleResolveBetExposureMapsVersionConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Params = gin.Params{{Key: "id", Value: "exposure-1"}}
	ctx.Request = httptest.NewRequest(
		http.MethodPost, "/v2/internal/bet-exposures/exposure-1/resolve",
		bytes.NewBufferString(`{"resolution":"manual_review","expected_version":7,"reason":"inspect the unknown ticket"}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Request.Header.Set("X-Surebet-Internal-Token", "internal-token")
	operations := &liveBetOperationStub{err: repository.ErrVersionConflict}
	server := &Server{deps: Dependencies{
		LiveBetOperations: operations,
		InternalToken:     "internal-token",
	}}

	server.handleResolveBetExposure(ctx)
	if recorder.Code != http.StatusConflict || operations.exposureID != "exposure-1" ||
		operations.resolution.ExpectedVersion != 7 {
		t.Fatalf("unexpected manual resolution response: code=%d request=%+v body=%s", recorder.Code, operations.resolution, recorder.Body.String())
	}
}

type liveBetQueryStub struct {
	exposures []dto.BetExposureView
	attempts  []dto.BetAttemptView
	events    []dto.BetActionJournalEventView
	err       error
}

type liveBetOperationStub struct {
	reconcileCalls  int
	actionID        string
	exposureID      string
	expectedVersion int64
	resolution      dto.ManualExposureResolutionRequest
	action          dto.BetActionView
	exposure        dto.BetExposureView
	err             error
}

func (s *liveBetOperationStub) ReconcileAction(
	_ context.Context,
	actionID string,
	expectedVersion int64,
) (dto.BetActionView, error) {
	s.reconcileCalls++
	s.actionID = actionID
	s.expectedVersion = expectedVersion
	return s.action, s.err
}

func (s *liveBetOperationStub) ResolveExposure(
	_ context.Context,
	exposureID string,
	request dto.ManualExposureResolutionRequest,
) (dto.BetExposureView, error) {
	s.exposureID = exposureID
	s.resolution = request
	return s.exposure, s.err
}

func (s liveBetQueryStub) GetExposure(context.Context, string) (dto.BetExposureView, error) {
	if len(s.exposures) == 0 {
		return dto.BetExposureView{}, s.err
	}
	return s.exposures[0], s.err
}

func (s liveBetQueryStub) ListExposures(context.Context, string, int) ([]dto.BetExposureView, error) {
	return append([]dto.BetExposureView(nil), s.exposures...), s.err
}

func (s liveBetQueryStub) ListAttempts(context.Context, string, string, int) ([]dto.BetAttemptView, error) {
	return append([]dto.BetAttemptView(nil), s.attempts...), s.err
}

func (s liveBetQueryStub) ListEvents(context.Context, string, int64, int) ([]dto.BetActionJournalEventView, error) {
	return append([]dto.BetActionJournalEventView(nil), s.events...), s.err
}
