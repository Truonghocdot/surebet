package auth

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
)

var ErrInvalidPassword = errors.New("invalid password")

type SHA256Hasher struct{}

func NewSHA256Hasher() SHA256Hasher {
	return SHA256Hasher{}
}

func (SHA256Hasher) Hash(password string) (string, error) {
	sum := sha256.Sum256([]byte(password))
	return base64.StdEncoding.EncodeToString(sum[:]), nil
}

func (SHA256Hasher) Compare(hash, password string) error {
	expected, err := SHA256Hasher{}.Hash(password)
	if err != nil {
		return err
	}

	if subtle.ConstantTimeCompare([]byte(hash), []byte(expected)) != 1 {
		return ErrInvalidPassword
	}

	return nil
}
