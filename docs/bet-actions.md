# Mô phỏng auto-bet

This workflow models auto-bet coordination without clicking a bookmaker page or submitting a real wager. It is disabled by default.

## Trigger

Use the `/auto-bet` frontend controls for the switch and total stake. Collector
workers no longer require auto-bet environment variables.

Chỉ cần chọn chế độ mô phỏng và tổng vốn cho một cặp cược:

```dotenv
AUTO_BET_MODE=simulation
AUTO_BET_TOTAL_STAKE_VND=100000
```

After the normal hard-confirmation service confirms a surebet, the backend starts one idempotent simulation action. The passive `confirm_quote` protocol remains unchanged.

## Sequence

1. Backend sends `simulate_select_odds` to 8xbet and Jun88 CMD concurrently.
2. Each collector reads its in-memory current selection and returns a simulated slip preview. No DOM click is performed. Cache timestamps must be at most 2 seconds old and the pair skew must be at most 1 second.
3. The collector binds that preview to the action and leg. A placement without a matching preview is rejected; a cache change between preview and placement returns `odds_changed` automatically.
4. Backend accepts the selected pair only when provenance/odds format is valid, both normalized Malay odds are negative, and the pair remains profitable.
5. Stakes are allocated from the configured VND bankroll for an equalized two-way return. A positive `available_stake` is treated as a known limit; zero currently means the collector did not provide a limit.
6. Backend sends `simulate_place_bet` to Jun88 CMD first.
7. Backend sends the 8xbet command only after Jun88 returns a ticket whose odds and stake exactly match the submitted terms.

The entire sequence is capped by the hard-confirmed surebet `valid_until` deadline. Collector stream protocol v3 is required for simulation commands; v1/v2 collectors can still stream odds but cannot participate in this workflow.

## Outcomes

- Both collectors return `ticket_accepted`: action status is `completed`.
- Jun88 returns `odds_changed`: status is `awaiting_odds_confirmation`; 8xbet is not called and there is no exposure.
- Jun88 returns a ticket, then 8xbet returns `odds_changed`: status is `exposure_open` and the new offered odds are retained.
- A lost or malformed Jun88 submission response is `submission_unknown` with `exposure_open=true`, because a first ticket may exist.
- A timeout after the Jun88 ticket is `submission_unknown` with `exposure_open=true`; the command is not retried blindly.
- Mixed-sign, non-profitable, stale, skewed, missing, suspended, invalid-provenance, or known insufficient-liquidity selections stop before placement as `selection_rejected`.

`awaiting_odds_confirmation` and `exposure_open` are terminal results of this simulation version. There is intentionally no endpoint that accepts a changed price or continues into a real wager.

Collector mô phỏng mặc định trả vé thành công xác định; các nhánh đổi odds được
kiểm thử bằng handler test riêng, không còn là cấu hình vận hành.

## Inspection

The endpoints require `X-Surebet-Internal-Token`:

- `GET /v2/internal/bet-actions?status=completed&limit=100`
- `GET /v2/internal/bet-actions/:id`

Progress is also broadcast as `auto_bet_simulation_updated` on the existing realtime channel. The action stores both legs, per-leg stakes, synthetic ticket IDs, offered odds, state transitions, and exposure state.

PostgreSQL storage is created by Laravel migration `2026_08_14_000009_create_bet_actions_table.php`. Migration `2026_08_14_000010_convert_bet_actions_to_simulation_workflows.php` upgrades a database that already ran the earlier single-leg draft schema.

## Live-execution boundary

Do not replace the simulation handlers with Playwright clicks yet. Live execution also requires authenticated collector WebSocket sessions, durable bookmaker-side client references, startup reconciliation for actions left in `placing_*`, and balance/risk limits. Those controls are deliberately outside this simulation-only implementation.
