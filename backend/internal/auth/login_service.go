package auth

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"surebet/backend/internal/dto"
	"surebet/backend/internal/models"
	"surebet/backend/internal/repository"
)

var ErrInvalidCredentials = errors.New("invalid credentials")

type LoginService interface {
	Login(ctx context.Context, request dto.LoginRequest) (dto.LoginResponse, error)
}

type loginService struct {
	users        repository.UserRepository
	passwords    PasswordHasher
	tokenManager TokenManager
}

func NewLoginService(
	users repository.UserRepository,
	passwords PasswordHasher,
	tokenManager TokenManager,
) LoginService {
	return loginService{
		users:        users,
		passwords:    passwords,
		tokenManager: tokenManager,
	}
}

func (s loginService) Login(ctx context.Context, request dto.LoginRequest) (dto.LoginResponse, error) {
	user, err := s.users.GetByEmail(ctx, request.Email)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return dto.LoginResponse{}, ErrInvalidCredentials
		}
		return dto.LoginResponse{}, err
	}

	if !user.IsActive {
		return dto.LoginResponse{}, ErrInvalidCredentials
	}

	if err := s.passwords.Compare(user.PasswordHash, request.Password); err != nil {
		return dto.LoginResponse{}, ErrInvalidCredentials
	}

	expiresAt := time.Now().UTC().Add(12 * time.Hour)
	token, err := s.tokenManager.IssueAccessToken(ctx, Claims{
		UserID:    user.ID,
		Email:     user.Email,
		Roles:     []string{user.Role},
		ExpiresAt: expiresAt,
	})
	if err != nil {
		return dto.LoginResponse{}, err
	}

	now := time.Now().UTC()
	_ = s.users.UpdateLastLogin(ctx, user.ID, now)

	return dto.LoginResponse{
		AccessToken: token,
		TokenType:   "Bearer",
		ExpiresAt:   expiresAt,
		User: dto.AuthenticatedUserView{
			ID:          fallbackID(user.ID),
			Email:       user.Email,
			FullName:    user.FullName,
			Role:        user.Role,
			LastLoginAt: &now,
		},
	}, nil
}

func fallbackID(id string) string {
	if id != "" {
		return id
	}
	return uuid.NewString()
}

func ClaimsFromUser(user models.User, expiresAt time.Time) Claims {
	return Claims{
		UserID:    user.ID,
		Email:     user.Email,
		Roles:     []string{user.Role},
		ExpiresAt: expiresAt,
	}
}
