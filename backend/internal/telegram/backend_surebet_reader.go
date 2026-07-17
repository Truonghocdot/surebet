package telegram

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"surebet/backend/internal/dto"
)

type BackendSurebetReader struct {
	endpoint         string
	confirmationBase string
	internalToken    string
	client           *http.Client
}

func NewBackendSurebetReader(baseURL string, timeout time.Duration) *BackendSurebetReader {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	base, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil
	}
	base.Path = "/v1/surebets"
	base.RawQuery = ""
	base.Fragment = ""
	return &BackendSurebetReader{
		endpoint: base.String(),
		client:   &http.Client{Timeout: timeout},
	}
}

func NewBackendSurebetConfirmer(baseURL, internalToken string, timeout time.Duration) *BackendSurebetReader {
	reader := NewBackendSurebetReader(baseURL, timeout)
	if reader == nil || strings.TrimSpace(internalToken) == "" {
		return nil
	}
	base, _ := url.Parse(strings.TrimSpace(baseURL))
	base.Path = "/v2/internal/surebets/"
	base.RawQuery = ""
	base.Fragment = ""
	reader.confirmationBase = base.String()
	reader.internalToken = internalToken
	return reader
}

func (r *BackendSurebetReader) ListCurrentSurebets(ctx context.Context) ([]dto.SurebetView, error) {
	if r == nil || r.endpoint == "" {
		return nil, fmt.Errorf("backend surebet reader is not configured")
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, r.endpoint, nil)
	if err != nil {
		return nil, err
	}
	response, err := r.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("backend surebet API returned %s", response.Status)
	}

	var payload struct {
		Data []dto.SurebetView `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, err
	}
	return payload.Data, nil
}

func (r *BackendSurebetReader) ConfirmSurebet(
	ctx context.Context,
	opportunityID string,
) (dto.SurebetView, bool, error) {
	if r == nil || r.confirmationBase == "" || r.internalToken == "" {
		return dto.SurebetView{}, false, fmt.Errorf("backend surebet confirmer is not configured")
	}

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		r.confirmationBase+url.PathEscape(opportunityID)+"/confirm",
		nil,
	)
	if err != nil {
		return dto.SurebetView{}, false, err
	}
	request.Header.Set("X-Surebet-Internal-Token", r.internalToken)

	response, err := r.client.Do(request)
	if err != nil {
		return dto.SurebetView{}, false, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return dto.SurebetView{}, false, nil
	}
	if response.StatusCode >= http.StatusBadRequest {
		return dto.SurebetView{}, false, fmt.Errorf("backend surebet confirmation API returned %s", response.Status)
	}

	var payload struct {
		Data dto.SurebetView `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return dto.SurebetView{}, false, err
	}
	return payload.Data, true, nil
}
