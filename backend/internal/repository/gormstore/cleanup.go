package gormstore

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"surebet/backend/internal/models"
)

func CleanupLegacyBookmakers(ctx context.Context, db *gorm.DB) error {
	return migrateLegacyBookmakers(ctx, db)
}

func PurgeLegacyBookmakers(ctx context.Context, db *gorm.DB) error {
	for _, code := range []string{"bookmaker-a", "bookmaker-b"} {
		if err := db.WithContext(ctx).Where("code = ?", code).Delete(&models.Bookmaker{}).Error; err != nil {
			return err
		}
	}

	for _, externalRef := range []string{"bookmaker-a-primary", "bookmaker-b-primary"} {
		if err := db.WithContext(ctx).Where("external_ref = ?", externalRef).Delete(&models.Account{}).Error; err != nil {
			return err
		}
	}

	for _, key := range []string{
		"bookmaker.bookmaker-a.site_url",
		"bookmaker.bookmaker-b.site_url",
	} {
		if err := db.WithContext(ctx).Where("key = ?", key).Delete(&models.Configuration{}).Error; err != nil {
			return err
		}
	}

	return nil
}

func EnsureNoLegacyDuplication(ctx context.Context, db *gorm.DB) error {
	for _, pair := range [][2]string{
		{"bookmaker-a-primary", "8xbet-primary"},
		{"bookmaker-b-primary", "jun88-primary"},
	} {
		var legacy models.Account
		err := db.WithContext(ctx).Where("external_ref = ?", pair[0]).First(&legacy).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return err
		}

		var modern models.Account
		err = db.WithContext(ctx).Where("external_ref = ?", pair[1]).First(&modern).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return err
		}
	}

	return nil
}
