# Sơ đồ Phụ thuộc

## Sơ đồ mức cao

```mermaid
flowchart TD
    API[internal/api]
    DTO[internal/dto]
    MODELS[internal/models]
    AUTH[internal/auth]
    CONFIG[internal/config]
    COLLECTOR[internal/collector]
    ODDS[internal/odds]
    CALCULATOR[internal/calculator]
    SUREBET[internal/surebet]
    RUNTIMECONFIG[internal/runtimeconfig]
    EVENTBUS[internal/eventbus]
    REPO[internal/repository]
    GORMSTORE[internal/repository/gormstore]
    REDISSTORE[internal/repository/redisstore]
    REALTIME[internal/realtime]
    LOG[internal/logger]
    HEALTH[pkg/health]

    API --> DTO
    API --> AUTH
    API --> CONFIG
    API --> COLLECTOR
    API --> ODDS
    API --> SUREBET
    API --> RUNTIMECONFIG
    API --> REALTIME
    API --> LOG
    API --> HEALTH
    DTO --> MODELS
    AUTH --> MODELS
    COLLECTOR --> DTO
    COLLECTOR --> MODELS
    COLLECTOR --> REPO
    COLLECTOR --> EVENTBUS
    COLLECTOR --> REALTIME
    ODDS --> DTO
    ODDS --> MODELS
    ODDS --> REPO
    CALCULATOR --> MODELS
    SUREBET --> CALCULATOR
    SUREBET --> COLLECTOR
    SUREBET --> REPO
    RUNTIMECONFIG --> CONFIG
    RUNTIMECONFIG --> DTO
    RUNTIMECONFIG --> MODELS
    REPO --> MODELS
    GORMSTORE --> REPO
    REDISSTORE --> REPO
```

## Hướng dẫn triển khai

- Giữ event payload ổn định và có version
- Khi bắt đầu làm persistence, nên đặt phần implement repository trong `gormstore` và `redisstore`
- Logic bookmaker nên tách trong collector shared theo từng nguồn, không gom vào một package khổng lồ
- API handler nên mỏng, không chứa orchestration logic
