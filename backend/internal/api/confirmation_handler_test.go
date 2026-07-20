package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"surebet/backend/internal/dto"
)

func TestHandleConfirmSurebetRequiresInternalToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v2/internal/surebets/opportunity-a/confirm", nil)
	ctx.Params = gin.Params{{Key: "id", Value: "opportunity-a"}}

	server := &Server{deps: Dependencies{
		SurebetConfirm: confirmationServiceStub{confirmed: true},
		InternalToken:  "internal-token",
	}}
	server.handleConfirmSurebet(ctx)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized response, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestHandleConfirmSurebetReturnsFreshResult(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v2/internal/surebets/opportunity-a/confirm", nil)
	ctx.Request.Header.Set("X-Surebet-Internal-Token", "internal-token")
	ctx.Params = gin.Params{{Key: "id", Value: "opportunity-a"}}

	expected := dto.SurebetView{ID: "opportunity-a"}
	server := &Server{deps: Dependencies{
		SurebetConfirm: confirmationServiceStub{item: expected, confirmed: true},
		InternalToken:  "internal-token",
	}}
	server.handleConfirmSurebet(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected successful response, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Data dto.SurebetView `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Data.ID != expected.ID {
		t.Fatalf("unexpected confirmed opportunity: %+v", payload.Data)
	}
}

func TestHandleListConfirmedSurebetsReturnsOnlyConfirmedResults(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v2/internal/surebets/confirmed", nil)
	ctx.Request.Header.Set("X-Surebet-Internal-Token", "internal-token")

	expected := dto.SurebetView{ID: "opportunity-confirmed"}
	server := &Server{deps: Dependencies{
		SurebetConfirm: confirmationServiceStub{items: []dto.SurebetView{expected}},
		InternalToken:  "internal-token",
	}}
	server.handleListConfirmedSurebets(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected successful response, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Data []dto.SurebetView `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Data) != 1 || payload.Data[0].ID != expected.ID {
		t.Fatalf("unexpected confirmed opportunities: %+v", payload.Data)
	}
}

type confirmationServiceStub struct {
	item      dto.SurebetView
	items     []dto.SurebetView
	confirmed bool
	err       error
}

func (s confirmationServiceStub) ConfirmCurrentSurebet(
	context.Context,
	string,
) (dto.SurebetView, bool, error) {
	return s.item, s.confirmed, s.err
}

func (s confirmationServiceStub) GetVerifiedSurebet(
	context.Context,
	string,
) (dto.SurebetView, bool, error) {
	return s.item, s.confirmed, s.err
}

func (s confirmationServiceStub) ListConfirmedSurebets(context.Context) ([]dto.SurebetView, error) {
	return append([]dto.SurebetView(nil), s.items...), s.err
}
