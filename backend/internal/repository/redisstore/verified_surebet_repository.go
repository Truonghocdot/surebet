package redisstore

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"surebet/backend/internal/dto"
)

const (
	verifiedSurebetIndexKey = "surebet:v2:verified:index"
	verificationRolloutKey  = "surebet:v2:verification:rollout"
	verificationLatencyKey  = "surebet:v2:verification:latencies"
)

type VerifiedSurebetRepository struct {
	client *redis.Client
}

func NewVerifiedSurebetRepository(client *redis.Client) *VerifiedSurebetRepository {
	return &VerifiedSurebetRepository{client: client}
}

func (r *VerifiedSurebetRepository) Put(
	ctx context.Context,
	item dto.SurebetView,
	ttl time.Duration,
) error {
	if r == nil || r.client == nil || strings.TrimSpace(item.ID) == "" {
		return errors.New("verified surebet repository is not configured")
	}
	if ttl <= 0 {
		ttl = 2 * time.Second
	}
	encoded, err := json.Marshal(item)
	if err != nil {
		return err
	}

	pipe := r.client.TxPipeline()
	pipe.Set(ctx, verifiedSurebetKey(item.ID), encoded, ttl)
	pipe.SAdd(ctx, verifiedSurebetIndexKey, item.ID)
	pipe.Expire(ctx, verifiedSurebetIndexKey, 24*time.Hour)
	for _, leg := range item.Legs {
		key := verifiedFixtureIndexKey(dto.VerifiedFixtureRef{
			BookmakerID: leg.BookmakerID,
			LobbyID:     leg.LobbyID,
			FixtureID:   leg.FixtureID,
		})
		pipe.SAdd(ctx, key, item.ID)
		pipe.Expire(ctx, key, ttl+10*time.Second)
	}
	_, err = pipe.Exec(ctx)
	return err
}

func (r *VerifiedSurebetRepository) Get(
	ctx context.Context,
	opportunityID string,
) (dto.SurebetView, bool, error) {
	value, err := r.client.Get(ctx, verifiedSurebetKey(opportunityID)).Result()
	if errors.Is(err, redis.Nil) {
		return dto.SurebetView{}, false, nil
	}
	if err != nil {
		return dto.SurebetView{}, false, err
	}
	var item dto.SurebetView
	if err := json.Unmarshal([]byte(value), &item); err != nil {
		return dto.SurebetView{}, false, err
	}
	if !item.ValidUntil.IsZero() && !item.ValidUntil.After(time.Now().UTC()) {
		_ = r.Delete(ctx, item.ID)
		return dto.SurebetView{}, false, nil
	}
	return item, true, nil
}

func (r *VerifiedSurebetRepository) List(ctx context.Context) ([]dto.SurebetView, error) {
	ids, err := r.client.SMembers(ctx, verifiedSurebetIndexKey).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}
	items := make([]dto.SurebetView, 0, len(ids))
	stale := make([]any, 0)
	for _, id := range ids {
		item, found, getErr := r.Get(ctx, id)
		if getErr != nil {
			return nil, getErr
		}
		if !found {
			stale = append(stale, id)
			continue
		}
		items = append(items, item)
	}
	if len(stale) > 0 {
		_ = r.client.SRem(ctx, verifiedSurebetIndexKey, stale...).Err()
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].ProfitPercentage > items[j].ProfitPercentage
	})
	return items, nil
}

func (r *VerifiedSurebetRepository) Delete(ctx context.Context, opportunityID string) error {
	pipe := r.client.TxPipeline()
	pipe.Del(ctx, verifiedSurebetKey(opportunityID))
	pipe.SRem(ctx, verifiedSurebetIndexKey, opportunityID)
	_, err := pipe.Exec(ctx)
	return err
}

func (r *VerifiedSurebetRepository) InvalidateFixtures(
	ctx context.Context,
	refs []dto.VerifiedFixtureRef,
) ([]string, error) {
	ids := make(map[string]struct{})
	keys := make([]string, 0, len(refs))
	for _, ref := range refs {
		key := verifiedFixtureIndexKey(ref)
		keys = append(keys, key)
		members, err := r.client.SMembers(ctx, key).Result()
		if err != nil && !errors.Is(err, redis.Nil) {
			return nil, err
		}
		for _, id := range members {
			ids[id] = struct{}{}
		}
	}

	pipe := r.client.TxPipeline()
	invalidated := make([]string, 0, len(ids))
	for id := range ids {
		invalidated = append(invalidated, id)
		pipe.Del(ctx, verifiedSurebetKey(id))
		pipe.SRem(ctx, verifiedSurebetIndexKey, id)
	}
	if len(keys) > 0 {
		pipe.Del(ctx, keys...)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}
	sort.Strings(invalidated)
	return invalidated, nil
}

func (r *VerifiedSurebetRepository) RecordVerification(
	ctx context.Context,
	confirmed bool,
	latency time.Duration,
	isError bool,
	isParserError bool,
) error {
	now := time.Now().UTC()
	pipe := r.client.TxPipeline()
	pipe.HSetNX(ctx, verificationRolloutKey, "started_at", now.Format(time.RFC3339Nano))
	pipe.HIncrBy(ctx, verificationRolloutKey, "candidate_total", 1)
	if confirmed {
		pipe.HIncrBy(ctx, verificationRolloutKey, "confirmed_total", 1)
		pipe.HSet(ctx, verificationRolloutKey, "consecutive_errors", 0)
	} else if isError {
		pipe.HIncrBy(ctx, verificationRolloutKey, "error_total", 1)
		pipe.HIncrBy(ctx, verificationRolloutKey, "consecutive_errors", 1)
	} else {
		pipe.HSet(ctx, verificationRolloutKey, "consecutive_errors", 0)
	}
	if isParserError {
		pipe.HIncrBy(ctx, verificationRolloutKey, "parser_error_total", 1)
	}
	pipe.LPush(ctx, verificationLatencyKey, latency.Milliseconds())
	pipe.LTrim(ctx, verificationLatencyKey, 0, 199)
	pipe.Expire(ctx, verificationLatencyKey, 24*time.Hour)
	pipe.Expire(ctx, verificationRolloutKey, 24*time.Hour)
	_, err := pipe.Exec(ctx)
	return err
}

func (r *VerifiedSurebetRepository) RolloutSnapshot(
	ctx context.Context,
) (dto.VerificationRolloutSnapshot, error) {
	values, err := r.client.HGetAll(ctx, verificationRolloutKey).Result()
	if err != nil {
		return dto.VerificationRolloutSnapshot{}, err
	}
	latencies, err := r.client.LRange(ctx, verificationLatencyKey, 0, 199).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return dto.VerificationRolloutSnapshot{}, err
	}
	startedAt, _ := time.Parse(time.RFC3339Nano, values["started_at"])
	result := dto.VerificationRolloutSnapshot{
		Mode:              values["mode"],
		StartedAt:         startedAt,
		CandidateTotal:    parseInt64(values["candidate_total"]),
		ConfirmedTotal:    parseInt64(values["confirmed_total"]),
		ErrorTotal:        parseInt64(values["error_total"]),
		ParserErrorTotal:  parseInt64(values["parser_error_total"]),
		ConsecutiveErrors: parseInt64(values["consecutive_errors"]),
		Latencies:         make([]time.Duration, 0, len(latencies)),
	}
	for _, value := range latencies {
		result.Latencies = append(result.Latencies, time.Duration(parseInt64(value))*time.Millisecond)
	}
	return result, nil
}

func (r *VerifiedSurebetRepository) SetRolloutMode(ctx context.Context, mode string) error {
	return r.client.HSet(ctx, verificationRolloutKey, "mode", mode).Err()
}

func verifiedSurebetKey(id string) string {
	return "surebet:v2:verified:" + id
}

func verifiedFixtureIndexKey(ref dto.VerifiedFixtureRef) string {
	return strings.Join([]string{
		"surebet:v2:verified_by_fixture",
		ref.BookmakerID,
		ref.LobbyID,
		ref.FixtureID,
	}, ":")
}

func parseInt64(value string) int64 {
	parsed, _ := strconv.ParseInt(value, 10, 64)
	return parsed
}
