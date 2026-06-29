GO ?= go

.PHONY: build tidy test migrate seed cleanup deps-audit deps-why-all deps-why-json deps-runtime-json

build:
	$(GO) build ./...

migrate:
	$(GO) run ./cmd/migrate

seed:
	$(GO) run ./cmd/seed

cleanup:
	$(GO) run ./cmd/cleanup

tidy:
	$(GO) mod tidy

test:
	$(GO) test ./...

deps-audit:
	$(GO) list -deps -f '{{if not .Standard}}{{.ImportPath}}{{end}}' ./... | sort -u

deps-why-all:
	$(GO) mod why -m all

deps-why-json:
	@printf '\n==> github.com/bytedance/sonic\n'
	$(GO) mod why github.com/bytedance/sonic
	@printf '\n==> github.com/goccy/go-json\n'
	$(GO) mod why github.com/goccy/go-json
	@printf '\n==> github.com/json-iterator/go\n'
	$(GO) mod why github.com/json-iterator/go

deps-runtime-json:
	@$(GO) list -deps -f '{{if not .Standard}}{{.ImportPath}}{{end}}' ./... | sort -u | rg 'github.com/(bytedance/sonic|goccy/go-json|json-iterator/go)' || true
