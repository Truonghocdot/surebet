# Sơ đồ Phụ thuộc

## Sơ đồ mức cao

```mermaid
flowchart TD
    API[internal/api]
    DTO[internal/dto]
    MODELS[internal/models]
    VALIDATOR[internal/validator]
    FEATURE[internal/feature]
    RISK[internal/risk]
    EXEC[internal/execution]
    EVENTBUS[internal/eventbus]
    REPO[internal/repository]
    WS[internal/websocket]
    AUTH[internal/auth]
    CONFIG[internal/config]
    LOG[internal/logger]
    HEALTH[pkg/health]

    API --> DTO
    API --> LOG
    API --> HEALTH
    DTO --> MODELS
    VALIDATOR --> MODELS
    VALIDATOR --> FEATURE
    VALIDATOR --> RISK
    EXEC --> MODELS
    EXEC --> REPO
    EVENTBUS --> MODELS
    FEATURE --> MODELS
    REPO --> MODELS
    WS --> EVENTBUS
    AUTH --> MODELS
```

## Hướng dẫn triển khai

- Giữ event payload ổn định và có version
- Khi bắt đầu làm persistence, nên đặt phần implement repository trong các adapter package riêng
- Execution adapter nên tách theo từng bookmaker, không gom vào một package khổng lồ
- API handler nên mỏng, không chứa orchestration logic
