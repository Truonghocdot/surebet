GO ?= go

.PHONY: build tidy test deps-audit deps-why-all deps-why-json deps-runtime-json

build:
	$(GO) build ./...

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

