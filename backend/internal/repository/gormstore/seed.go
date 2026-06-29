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
	if err := migrateLegacyBookmakers(ctx, db); err != nil {
		return err
	}

	user, err := ensureOperatorUser(ctx, db, hasher)
	if err != nil {
		return err
	}

	if _, err := ensureBookmaker(ctx, db, models.Bookmaker{
		BaseModel:     models.BaseModel{ID: uuid.NewString()},
		Code:          "8xbet",
		Name:          "8xbet",
		SiteURL:       "https://8xbet.example.com",
		Region:        "global",
		IsEnabled:     true,
		SupportsAuto:  true,
		MaxConcurrent: 2,
	}); err != nil {
		return err
	}

	bookmakerB, err := ensureBookmaker(ctx, db, models.Bookmaker{
		BaseModel:     models.BaseModel{ID: uuid.NewString()},
		Code:          "jun88",
		Name:          "jun88",
		SiteURL:       "https://jun88.example.com",
		Region:        "global",
		IsEnabled:     true,
		SupportsAuto:  false,
		MaxConcurrent: 2,
	})
	if err != nil {
		return err
	}

	bookmakerA, err := getBookmakerByCode(ctx, db, "8xbet")
	if err != nil {
		return err
	}

	if err := ensureAccount(ctx, db, models.Account{
		BaseModel:      models.BaseModel{ID: uuid.NewString()},
		UserID:         user.ID,
		BookmakerID:    bookmakerA.ID,
		ExternalRef:    "8xbet-primary",
		Label:          "8xbet Primary",
		LoginUsername:  "8xbet.ops.primary",
		LoginPassword:  "Dev8xbet123!",
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
		ExternalRef:    "jun88-primary",
		Label:          "jun88 Primary",
		LoginUsername:  "jun88.ops.primary",
		LoginPassword:  "DevJun88123!",
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
			Key:         "bookmaker.8xbet.site_url",
			Value:       bookmakerA.SiteURL,
			ValueType:   "string",
			Description: "Default site URL for 8xbet",
		},
		{
			BaseModel:   models.BaseModel{ID: uuid.NewString()},
			Key:         "bookmaker.jun88.site_url",
			Value:       bookmakerB.SiteURL,
			ValueType:   "string",
			Description: "Default site URL for jun88",
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

func migrateLegacyBookmakers(ctx context.Context, db *gorm.DB) error {
	type legacyMapping struct {
		oldCode        string
		newCode        string
		newName        string
		newURL         string
		oldExternalRef string
		newExternalRef string
		newLabel       string
		oldConfigKey   string
		newConfigKey   string
	}

	mappings := []legacyMapping{
		{
			oldCode:        "bookmaker-a",
			newCode:        "8xbet",
			newName:        "8xbet",
			newURL:         "https://8xbet.example.com",
			oldExternalRef: "bookmaker-a-primary",
			newExternalRef: "8xbet-primary",
			newLabel:       "8xbet Primary",
			oldConfigKey:   "bookmaker.bookmaker-a.site_url",
			newConfigKey:   "bookmaker.8xbet.site_url",
		},
		{
			oldCode:        "bookmaker-b",
			newCode:        "jun88",
			newName:        "jun88",
			newURL:         "https://jun88.example.com",
			oldExternalRef: "bookmaker-b-primary",
			newExternalRef: "jun88-primary",
			newLabel:       "jun88 Primary",
			oldConfigKey:   "bookmaker.bookmaker-b.site_url",
			newConfigKey:   "bookmaker.jun88.site_url",
		},
	}

	for _, mapping := range mappings {
		var legacyBookmaker models.Bookmaker
		if err := db.WithContext(ctx).Where("code = ?", mapping.oldCode).First(&legacyBookmaker).Error; err == nil {
			var modernBookmaker models.Bookmaker
			err = db.WithContext(ctx).Where("code = ?", mapping.newCode).First(&modernBookmaker).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				legacyBookmaker.Code = mapping.newCode
				legacyBookmaker.Name = mapping.newName
				legacyBookmaker.SiteURL = mapping.newURL
				if saveErr := db.WithContext(ctx).Save(&legacyBookmaker).Error; saveErr != nil {
					return saveErr
				}
				modernBookmaker = legacyBookmaker
			} else if err == nil {
				if mergeErr := db.WithContext(ctx).Model(&models.Account{}).
					Where("bookmaker_id = ?", legacyBookmaker.ID).
					Update("bookmaker_id", modernBookmaker.ID).Error; mergeErr != nil {
					return mergeErr
				}

				if deleteErr := db.WithContext(ctx).Delete(&legacyBookmaker).Error; deleteErr != nil {
					return deleteErr
				}
			} else {
				return err
			}
		}

		var legacyAccount models.Account
		if err := db.WithContext(ctx).Where("external_ref = ?", mapping.oldExternalRef).First(&legacyAccount).Error; err == nil {
			var modernAccount models.Account
			err = db.WithContext(ctx).Where("external_ref = ?", mapping.newExternalRef).First(&modernAccount).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				legacyAccount.ExternalRef = mapping.newExternalRef
				legacyAccount.Label = mapping.newLabel
				if saveErr := db.WithContext(ctx).Save(&legacyAccount).Error; saveErr != nil {
					return saveErr
				}
			} else if err == nil {
				if modernAccount.LoginUsername == "" {
					modernAccount.LoginUsername = legacyAccount.LoginUsername
				}
				if modernAccount.LoginPassword == "" {
					modernAccount.LoginPassword = legacyAccount.LoginPassword
				}
				if modernAccount.UserID == "" {
					modernAccount.UserID = legacyAccount.UserID
				}
				if modernAccount.BookmakerID == "" {
					modernAccount.BookmakerID = legacyAccount.BookmakerID
				}
				if modernAccount.Label == "" {
					modernAccount.Label = mapping.newLabel
				}
				if modernAccount.Balance == 0 {
					modernAccount.Balance = legacyAccount.Balance
				}
				if modernAccount.AvailableStake == 0 {
					modernAccount.AvailableStake = legacyAccount.AvailableStake
				}
				if saveErr := db.WithContext(ctx).Save(&modernAccount).Error; saveErr != nil {
					return saveErr
				}
				if deleteErr := db.WithContext(ctx).Delete(&legacyAccount).Error; deleteErr != nil {
					return deleteErr
				}
			} else {
				return err
			}
		}

		var legacyConfig models.Configuration
		if err := db.WithContext(ctx).Where("key = ?", mapping.oldConfigKey).First(&legacyConfig).Error; err == nil {
			var modernConfig models.Configuration
			err = db.WithContext(ctx).Where("key = ?", mapping.newConfigKey).First(&modernConfig).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				legacyConfig.Key = mapping.newConfigKey
				legacyConfig.Description = "Default site URL for " + mapping.newName
				if saveErr := db.WithContext(ctx).Save(&legacyConfig).Error; saveErr != nil {
					return saveErr
				}
			} else if err == nil {
				modernConfig.Value = legacyConfig.Value
				modernConfig.Description = "Default site URL for " + mapping.newName
				if saveErr := db.WithContext(ctx).Save(&modernConfig).Error; saveErr != nil {
					return saveErr
				}
				if deleteErr := db.WithContext(ctx).Delete(&legacyConfig).Error; deleteErr != nil {
					return deleteErr
				}
			} else {
				return err
			}
		}
	}

	return nil
}
