package api

import (
	"testing"
	"time"
)

func TestResponseCacheExpiresAndBoundsEntries(t *testing.T) {
	cache := newResponseCache()
	now := time.Unix(100, 0)
	cache.set("key", []string{"value"}, time.Second, now)
	if value, ok := cache.get("key", now.Add(500*time.Millisecond)); !ok || value == nil {
		t.Fatalf("expected cached value, got %v %v", value, ok)
	}
	if _, ok := cache.get("key", now.Add(time.Second)); ok {
		t.Fatal("expected cache entry to expire")
	}
}
