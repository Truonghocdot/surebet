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

type BackendVerifiedSurebetReader struct {
	confirmationBase string
	internalToken    string
	client           *http.Client
}

func NewBackendVerifiedSurebetReader(
	baseURL,
	internalToken string,
	timeout time.Duration,
) *BackendVerifiedSurebetReader {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	base, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || base.Scheme == "" || base.Host == "" || strings.TrimSpace(internalToken) == "" {
		return nil
	}
	base.Path = "/v2/internal/surebets/"
	base.RawQuery = ""
	base.Fragment = ""
	return &BackendVerifiedSurebetReader{
		confirmationBase: base.String(),
		internalToken:    internalToken,
		client:           &http.Client{Timeout: timeout},
	}
}

func (r *BackendVerifiedSurebetReader) GetVerifiedSurebet(
	ctx context.Context,
	opportunityID string,
) (dto.SurebetView, bool, error) {
	if r == nil || r.confirmationBase == "" || r.internalToken == "" {
		return dto.SurebetView{}, false, fmt.Errorf("backend verified surebet reader is not configured")
	}

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		r.confirmationBase+url.PathEscape(opportunityID)+"/verified",
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
		return dto.SurebetView{}, false, fmt.Errorf("backend verified surebet API returned %s", response.Status)
	}

	var payload struct {
		Data dto.SurebetView `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return dto.SurebetView{}, false, err
	}
	return payload.Data, true, nil
}
