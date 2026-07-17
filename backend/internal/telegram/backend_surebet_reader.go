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
	endpoint string
	client   *http.Client
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
