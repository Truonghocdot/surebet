# Auto-bet live: kien truc va rollout

The operator switch and total stake are controlled from the frontend `/auto-bet`
screen. Collector workers do not need auto-bet environment variables.

## Trang thai trien khai

Da hoan thanh lop an toan truoc live:

- protocol v4 co token rieng theo collector/account, source binding va capability negotiation;
- `prepare_bet`, `cancel_prepared_bet`, `commit_bet`, `reconcile_bet` co correlation day du;
- action/attempt/exposure/event journal ben vung, CAS, account reservation va Jun88 ticket transaction barrier;
- Jun88-first orchestration, toi da 3 reprice, exposure matcher dung exact 8xbet selection va chi hedge khi ca hai P&L sau lam tron deu lon hon 0 VND;
- startup/periodic reconciliation khong bao gio gui lai `commit_bet`;
- dashboard `/auto-bet` va internal API cho action, attempt, exposure, journal, reconcile/manual resolution.

Collector da thuc hien click odds, doc betslip, kiem tra don vi/limit/balance va nhap stake tren DOM. `commit_bet` hien van dung truoc nut submit va tra reject fail-closed. Day la chu y: chua co capture du tin cay cho response accepted/repriced/rejected va ticket history cua hai bookmaker, nen bat commit switch luc nay van khong tao cuoc that.

Hai kill switch mac dinh deu tat. Thu tu bat bat buoc:

1. `AUTO_BET_MODE=dry-run`: prepare/cancel nhưng không submit.
2. Capture và test đủ bốn outcome thật. Jun88 luôn quy đổi `1 VD = 1.000 VND`.
3. Hoan thien submit/history adapter va fault-injection.
4. Chạy thử với vốn tối thiểu, sau đó mới đổi `AUTO_BET_MODE=live`.

Tai lieu nay dua tren hai betslip da duoc capture truc tiep ngay 2026-08-14:

- Jun88 CMD: [`lobbby/jun888/cmd-betslip-live.html`](lobbby/jun888/cmd-betslip-live.html) va metadata [`cmd-betslip-live.json`](lobbby/jun888/cmd-betslip-live.json).
- 8xbet: [`lobbby/8xbet/match-betslip-live.html`](lobbby/8xbet/match-betslip-live.html) va metadata [`match-betslip-live.json`](lobbby/8xbet/match-betslip-live.json).

Script capture la `collector/scripts/capture-live-bet-slips.ts`. Script chi click odds, khong nhap stake va khong click nut submit.

## Selector da xac minh

| Thanh phan | Jun88 CMD | 8xbet |
| --- | --- | --- |
| Odds co the click | `a.odds[href*="OddsClick"]` trong frame CMD | `button[data-testid^="oddsBtn-1\|<fixture>\|"]` |
| Betslip root | `.PlaceBetLeft` / `#BetWindow` trong `AdminLeftFrame.aspx` | `[data-testid="SportCart"]` |
| Selection | `#lb_bet_team`, `#lb_hdpball`, `#lb_hdpscore` | `[data-testid="sport-cart-single-card"] [data-testid="TicketInfoLayoutV4"]` |
| Odds hien thi | `#lb_bet_odds` | text `@<odds>` trong `TicketInfoLayoutV4` |
| Odds may | `#tx_bet_odds`, `#tx_bet_oddsType=MY`, `#tx_bet_type` | provider ref tu `data-testid="oddsBtn-..."`, sau do parse card |
| Stake | `#tx_stake` | keypad trong `[data-testid="SportCalculator"]` |
| Stake da nhap | `#tx_stake.inputValue` | `[data-testid="sport-cart-bet-amount-label"]` |
| Gioi han | `#tx_min_bet`, `#tx_max_bet`, `#lb_bet_limit_val` | `[data-testid="sport-cart-bet-limit-amount"]` |
| Submit | `#btnBet` | `[data-testid="sport-cart-bet-button"]` |
| Cancel/clear | `#btnCancel` | `[data-testid="sport-cart-clear-btn"]` |
| Loi/reject | `#BetErrorMessage:visible`, `#lb_msg` | message/toast va text nut submit |
| Reprice | thay doi `#tx_bet_odds`/`#lb_bet_odds`; can capture them response | `WinnableTip` va nut chuyen thanh `Chap Nhan` |

Capture live cho thay:

- Jun88: provider ref `25212060_Hdp_Home`, odds `-0.93`, format `MY`, min `20`, max `229166`. UI tu dien stake mac dinh `20` ngay sau khi chon odds.
- 8xbet: provider ref `oddsBtn-1|4928833|ah|h|0`, card odds `@0.96`, currency `VND`, amount rong, submit disabled.

## Luong muc tieu

1. Backend hard-confirm hai quote nhu hien tai.
2. Backend gui `prepare_bet` cho hai collector dong thoi.
3. Moi collector click dung provider reference va tra ve slip preview thuc te.
4. Backend kiem tra lai fixture/market/outcome, odds format, freshness, skew, hai odds Malay deu am, loi nhuan, min/max/increment va balance.
5. Backend tinh stake sau khi quy doi don vi rieng tung bookmaker va kiem tra lai P&L sau lam tron.
6. Ghi durable attempt journal truoc khi co bat ky click submit nao.
7. Gui `commit_bet` cho Jun88 CMD truoc.
8. Chi khi Jun88 tra ve ticket/order ID chac chan moi gui `commit_bet` cho 8xbet.
9. Neu 8xbet reprice, ghi `exposure_open` voi offered odds; khong tu click `Chap Nhan`.
10. Neu mat response sau submit, ghi `submission_unknown`, doi chieu bet history theo attempt ID; khong blind retry.

Trang thai de xuat:

```text
confirmed
  -> preparing_both
  -> prepared
  -> submitting_jun88
  -> jun88_ticket_received
  -> submitting_8xbet
  -> completed

preparing_both -> selection_rejected
submitting_jun88 -> jun88_odds_changed | submission_unknown
submitting_8xbet -> exposure_open | submission_unknown
```

## Tich hop collector

### Jun88 CMD

- Dat handler live ben trong `Jun88CmdRuntime.stream`, sau `resolveCmdContentTarget`, vi day la noi co ca frame odds va authenticated page.
- Parser phai luu provider ref co cau truc, vi du match `25212060`, market `Hdp`, side `Home`. Backend khong duoc gui CSS selector hay chuoi `javascript:` tuy y.
- `prepare_bet` tim lai anchor tu provider ref va click element, khong `eval` gia tri `href`.
- Sau click, doc `#tx_bet_oddsType`; live mode chi chap nhan `MY`. Cross-check team, line, score, league va odds voi command.
- UI tu dien minimum stake sau prepare. Commit phai ghi de bang keyboard events (`click`, `Ctrl+A`, `type`) de kich hoat `onkeyup`; doc lai `#tx_stake` va `#lb_estPayVal`, khong bao gio dung gia tri san co.
- Ngay truoc submit phai doc lai odds, min/max va selection identity.
- `#BetErrorMessage` la reject. BetWindow bien mat khong duoc coi la ticket accepted.

### 8xbet

- Tao mot action page rieng trong authenticated `BrowserContext` cua `EightXBetRuntime`; khong navigate streaming page vi se lam mat network feed.
- Provider ref phai giu day du sport, fixture, market, side va line index, vi du `1|4928833|ah|h|0`.
- `prepare_bet` navigate action page toi match, click exact `oddsBtn`, sau do cross-check card text, line va odds.
- Stake la virtual keypad, khong phai HTML input. Clear amount, click tung digit, sau do parse lai `sport-cart-bet-amount-label`; currency bat buoc la `VND`.
- `sport-cart-quick-bet-switch` phai giu `aria-checked=false`.
- Nut enabled chua du de submit: text phai la trang thai dat cuoc, amount/limit/balance hop le va khong co warning.
- Khi nut thanh `Chap Nhan`, tra `odds_changed`; collector khong tu chap nhan gia moi.

## Protocol live rieng

Khong doi ten cac frame simulation thanh live. Them capability va frame rieng, vi du protocol v4:

- `prepare_bet` -> `bet_prepared`
- `commit_bet` -> `ticket_accepted | odds_changed | rejected | submission_unknown`
- `cancel_prepared_bet`
- `reconcile_bet`

`bet_prepared` can co `prepare_id`, provider ref, slip fingerprint, raw/canonical odds, odds format, min/max/increment theo VND, balance, session generation va observed time. `ticket_accepted` bat buoc co bookmaker ticket/order ID, accepted odds, accepted stake va timestamp.

## Blocker con lai truoc khi submit live

1. **Ticket semantics:** hai capture hien tai chi chung minh betslip. Can capture network/history cho bon case: accepted, repriced, rejected va response lost. Sidebar bien mat khong phai bang chung accepted.
2. **Don vi stake Jun88:** Jun88 hien min/max `20/187500`, trong khi 8xbet dung VND day du. Phai xac minh Jun88 la VND hay don vi nghin truoc khi dung `stakeVnd`.
3. **Bookmaker history adapter:** collector da co command reconciliation nhung chua co selector/API ticket history da xac minh. Vi vay live submit van bi chan truoc nut submit.

## Thu tu trien khai

1. Them provider reference vao model/parser va unit test selector tren hai HTML capture.
2. Them authenticated protocol v4 va durable attempt journal.
3. Trien khai `prepare_bet` + `cancel_prepared_bet` thuc te, van cam submit; chay soak test.
4. Capture request/response va bet history bang tai khoan test/minimum stake co phe duyet.
5. Trien khai commit/reconcile voi fault injection: disconnect truoc submit, sau submit, DB failure va worker restart.
6. Canary mot action tai mot thoi voi hard limit va manual approval.
7. Chi sau khi ticket reconciliation va exposure alert dat test moi bat limited production mode.
