package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var ErrInvalidToken = errors.New("invalid token")

type HMACTokenManager struct {
	secret []byte
	ttl    time.Duration
}

func NewHMACTokenManager(secret string, ttl time.Duration) HMACTokenManager {
	return HMACTokenManager{
		secret: []byte(secret),
		ttl:    ttl,
	}
}

func (m HMACTokenManager) IssueAccessToken(_ context.Context, claims Claims) (string, error) {
	if claims.ExpiresAt.IsZero() {
		claims.ExpiresAt = time.Now().UTC().Add(m.ttl)
	}

	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}

	payloadEncoded := base64.RawURLEncoding.EncodeToString(payload)
	signatureEncoded := base64.RawURLEncoding.EncodeToString(m.sign(payloadEncoded))

	return payloadEncoded + "." + signatureEncoded, nil
}

func (m HMACTokenManager) ParseAccessToken(_ context.Context, token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return Claims{}, ErrInvalidToken
	}

	expectedSignature := m.sign(parts[0])
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}

	if !hmac.Equal(signature, expectedSignature) {
		return Claims{}, ErrInvalidToken
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}

	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return Claims{}, ErrInvalidToken
	}

	if time.Now().UTC().After(claims.ExpiresAt) {
		return Claims{}, ErrInvalidToken
	}

	return claims, nil
}

func (m HMACTokenManager) sign(payload string) []byte {
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write([]byte(payload))
	return mac.Sum(nil)
}
