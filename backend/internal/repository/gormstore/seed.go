package gormstore

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"surebet/backend/internal/auth"
	"surebet/backend/internal/models"
)

const (
	defaultOperatorEmail    = "operator@surebet.local"
	defaultOperatorPassword = "Surebet123!"
)

func SeedDefaultData(ctx context.Context, db *gorm.DB, hasher auth.PasswordHasher) error {
	user, err := ensureOperatorUser(ctx, db, hasher)
	if err != nil {
		return err
	}

	if _, err := ensureBookmaker(ctx, db, models.Bookmaker{
		BaseModel:     models.BaseModel{ID: uuid.NewString()},
		Code:          "bookmaker-a",
		Name:          "Bookmaker A",
		SiteURL:       "https://bookmaker-a.example.com",
		Region:        "global",
		IsEnabled:     true,
		SupportsAuto:  true,
		MaxConcurrent: 2,
	}); err != nil {
		return err
	}

	bookmakerB, err := ensureBookmaker(ctx, db, models.Bookmaker{
		BaseModel:     models.BaseModel{ID: uuid.NewString()},
		Code:          "bookmaker-b",
		Name:          "Bookmaker B",
		SiteURL:       "https://bookmaker-b.example.com",
		Region:        "global",
		IsEnabled:     true,
		SupportsAuto:  false,
		MaxConcurrent: 2,
	})
	if err != nil {
		return err
	}

	bookmakerA, err := getBookmakerByCode(ctx, db, "bookmaker-a")
	if err != nil {
		return err
	}

	if err := ensureAccount(ctx, db, models.Account{
		BaseModel:      models.BaseModel{ID: uuid.NewString()},
		UserID:         user.ID,
		BookmakerID:    bookmakerA.ID,
		ExternalRef:    "bookmaker-a-primary",
		Label:          "Bookmaker A Primary",
		LoginUsername:  "bmka.ops.primary",
		LoginPassword:  "DevBookmakerA123!",
		Currency:       "VND",
		Balance:        25000,
		AvailableStake: 6000,
		IsEnabled:      true,
	}); err != nil {
		return err
	}

	if err := ensureAccount(ctx, db, models.Account{
		BaseModel:      models.BaseModel{ID: uuid.NewString()},
		UserID:         user.ID,
		BookmakerID:    bookmakerB.ID,
		ExternalRef:    "bookmaker-b-primary",
		Label:          "Bookmaker B Primary",
		LoginUsername:  "bmkb.ops.primary",
		LoginPassword:  "DevBookmakerB123!",
		Currency:       "VND",
		Balance:        18000,
		AvailableStake: 4200,
		IsEnabled:      true,
	}); err != nil {
		return err
	}

	for _, configuration := range []models.Configuration{
		{
			BaseModel:   models.BaseModel{ID: uuid.NewString()},
			Key:         "bookmaker.bookmaker-a.site_url",
			Value:       bookmakerA.SiteURL,
			ValueType:   "string",
			Description: "Default site URL for Bookmaker A",
		},
		{
			BaseModel:   models.BaseModel{ID: uuid.NewString()},
			Key:         "bookmaker.bookmaker-b.site_url",
			Value:       bookmakerB.SiteURL,
			ValueType:   "string",
			Description: "Default site URL for Bookmaker B",
		},
		{
			BaseModel:   models.BaseModel{ID: uuid.NewString()},
			Key:         "auth.default_operator_email",
			Value:       defaultOperatorEmail,
			ValueType:   "string",
			Description: "Default seeded operator email",
		},
	} {
		if err := ensureConfiguration(ctx, db, configuration); err != nil {
			return err
		}
	}

	return nil
}

func ensureOperatorUser(ctx context.Context, db *gorm.DB, hasher auth.PasswordHasher) (models.User, error) {
	var user models.User
	err := db.WithContext(ctx).Where("email = ?", defaultOperatorEmail).First(&user).Error
	if err == nil {
		updates := map[string]any{
			"full_name":  "Surebet Operator",
			"role":       "admin",
			"is_active":  true,
			"locale":     "en",
			"timezone":   "UTC",
			"updated_at": time.Now().UTC(),
		}
		if updateErr := db.WithContext(ctx).Model(&user).Updates(updates).Error; updateErr != nil {
			return models.User{}, updateErr
		}
		user.FullName = "Surebet Operator"
		user.Role = "admin"
		user.IsActive = true
		return user, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return models.User{}, err
	}

	passwordHash, err := hasher.Hash(defaultOperatorPassword)
	if err != nil {
		return models.User{}, err
	}

	user = models.User{
		BaseModel:    models.BaseModel{ID: uuid.NewString()},
		Email:        defaultOperatorEmail,
		PasswordHash: passwordHash,
		FullName:     "Surebet Operator",
		Role:         "admin",
		IsActive:     true,
		Locale:       "en",
		Timezone:     "UTC",
	}

	return user, db.WithContext(ctx).Create(&user).Error
}

func ensureBookmaker(ctx context.Context, db *gorm.DB, bookmaker models.Bookmaker) (models.Bookmaker, error) {
	current, err := getBookmakerByCode(ctx, db, bookmaker.Code)
	if err == nil {
		current.Name = bookmaker.Name
		current.SiteURL = bookmaker.SiteURL
		current.Region = bookmaker.Region
		current.IsEnabled = bookmaker.IsEnabled
		current.SupportsAuto = bookmaker.SupportsAuto
		current.MaxConcurrent = bookmaker.MaxConcurrent
		return current, db.WithContext(ctx).Save(&current).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return models.Bookmaker{}, err
	}

	return bookmaker, db.WithContext(ctx).Create(&bookmaker).Error
}

func ensureAccount(ctx context.Context, db *gorm.DB, seed models.Account) error {
	var current models.Account
	err := db.WithContext(ctx).Where("external_ref = ?", seed.ExternalRef).First(&current).Error
	if err == nil {
		current.UserID = seed.UserID
		current.BookmakerID = seed.BookmakerID
		current.Label = seed.Label
		current.Currency = seed.Currency
		current.Balance = seed.Balance
		current.AvailableStake = seed.AvailableStake
		current.IsEnabled = seed.IsEnabled
		if current.LoginUsername == "" {
			current.LoginUsername = seed.LoginUsername
		}
		if current.LoginPassword == "" {
			current.LoginPassword = seed.LoginPassword
		}
		return db.WithContext(ctx).Save(&current).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	return db.WithContext(ctx).Create(&seed).Error
}

func ensureConfiguration(ctx context.Context, db *gorm.DB, configuration models.Configuration) error {
	var current models.Configuration
	err := db.WithContext(ctx).Where("key = ?", configuration.Key).First(&current).Error
	if err == nil {
		current.Value = configuration.Value
		current.ValueType = configuration.ValueType
		current.Description = configuration.Description
		return db.WithContext(ctx).Save(&current).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	return db.WithContext(ctx).Create(&configuration).Error
}

func getBookmakerByCode(ctx context.Context, db *gorm.DB, code string) (models.Bookmaker, error) {
	var bookmaker models.Bookmaker
	err := db.WithContext(ctx).Where("code = ?", code).First(&bookmaker).Error
	return bookmaker, err
}
