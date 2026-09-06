package userkey

import (
	"context"
	"reflect"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/logger"
)

// Install provisions keys inside the user-create transaction, covering email,
// code-login, local registration and administrator-created accounts alike.
func (s *Service) Install() error {
	// Production skips GORM's default transactions. Start one only for users,
	// and only when the caller has not already supplied its own transaction.
	const transactionKey = "userkey:owned_create_transaction"
	callbacks := s.db.Callback().Create()
	if err := callbacks.Before("gorm:before_create").Register("userkey:begin", func(tx *gorm.DB) {
		if tx.Error != nil || !tx.SkipDefaultTransaction || tx.Statement.Schema == nil || tx.Statement.Schema.Table != "users" {
			return
		}
		if _, nested := tx.Statement.ConnPool.(gorm.TxCommitter); nested {
			return
		}
		original := tx.Statement.ConnPool
		started := tx.Begin()
		if started.Error != nil {
			tx.AddError(started.Error)
			return
		}
		tx.Statement.ConnPool = started.Statement.ConnPool
		tx.InstanceSet(transactionKey, original)
	}); err != nil {
		return err
	}
	if err := callbacks.After("gorm:after_create").Before("gorm:commit_or_rollback_transaction").Register("userkey:provision", func(tx *gorm.DB) {
		if tx.Error != nil || tx.Statement.Schema == nil || tx.Statement.Schema.Table != "users" {
			return
		}
		var visit func(reflect.Value)
		visit = func(value reflect.Value) {
			if value.Kind() == reflect.Pointer {
				if !value.IsNil() {
					visit(value.Elem())
				}
				return
			}
			if value.Kind() == reflect.Slice || value.Kind() == reflect.Array {
				for i := 0; i < value.Len(); i++ {
					visit(value.Index(i))
				}
				return
			}
			if value.CanInterface() {
				if user, ok := value.Interface().(model.User); ok {
					// INSERT ... DO NOTHING can skip some rows in a batch. Only
					// provision owners that actually exist inside this transaction.
					var persisted model.User
					lookup := tx.Session(&gorm.Session{NewDB: true}).Select("id").Where("id = ?", user.ID).Limit(1).Find(&persisted)
					if lookup.Error != nil {
						tx.AddError(lookup.Error)
						return
					}
					if lookup.RowsAffected == 0 {
						return
					}
					row, err := s.generate(user.ID)
					if err == nil {
						err = tx.Session(&gorm.Session{NewDB: true}).Clauses(clause.OnConflict{DoNothing: true}).Create(row).Error
					}
					if err != nil {
						tx.AddError(err)
					}
				}
			}
		}
		visit(tx.Statement.ReflectValue)
	}); err != nil {
		return err
	}
	return callbacks.After("userkey:provision").Before("gorm:commit_or_rollback_transaction").Register("userkey:commit", func(tx *gorm.DB) {
		value, _ := tx.InstanceGet(transactionKey)
		if original, owned := value.(gorm.ConnPool); owned {
			if tx.Error != nil {
				tx.Rollback()
			} else {
				tx.Commit()
			}
			tx.Statement.ConnPool = original
			tx.InstanceSet(transactionKey, nil)
		}
	})
}

// Backfill adds defaults to pre-existing accounts in bounded pages. Unique
// user IDs make it safe to resume or run concurrently on multiple replicas.
func (s *Service) Backfill(ctx context.Context) error {
	for {
		var users []model.User
		if err := s.db.WithContext(ctx).Select("id").
			Where("NOT EXISTS (SELECT 1 FROM user_api_key k WHERE k.user_id = users.id)").
			Order("id ASC").Limit(200).Find(&users).Error; err != nil {
			return err
		}
		if len(users) == 0 {
			return nil
		}
		for _, user := range users {
			if _, err := s.Ensure(ctx, user.ID); err != nil {
				return err
			}
		}
	}
}

func (s *Service) StartBackfill(ctx context.Context) {
	go func() {
		for {
			if err := s.Backfill(ctx); err == nil {
				return
			} else if ctx.Err() == nil {
				logger.L().Warn("user API key backfill failed; will retry", zap.Error(err))
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Minute):
			}
		}
	}()
}
