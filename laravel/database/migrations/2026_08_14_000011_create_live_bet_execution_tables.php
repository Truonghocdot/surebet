<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('odds_quotes') && ! Schema::hasColumn('odds_quotes', 'provider_reference')) {
            Schema::table('odds_quotes', function (Blueprint $table): void {
                $table->text('provider_reference')->nullable();
                $table->index('provider_reference', 'idx_odds_quotes_provider_ref');
            });
        }

        if (! Schema::hasTable('bet_actions')) {
            return;
        }

        $actionColumns = [
            'account_id' => ! Schema::hasColumn('bet_actions', 'account_id'),
            'confirmation_revision' => ! Schema::hasColumn('bet_actions', 'confirmation_revision'),
            'reserved_stake_vnd' => ! Schema::hasColumn('bet_actions', 'reserved_stake_vnd'),
            'reservation_expires_at' => ! Schema::hasColumn('bet_actions', 'reservation_expires_at'),
            'exposure_id' => ! Schema::hasColumn('bet_actions', 'exposure_id'),
            'reprice_revision' => ! Schema::hasColumn('bet_actions', 'reprice_revision'),
            'version' => ! Schema::hasColumn('bet_actions', 'version'),
            'lease_owner' => ! Schema::hasColumn('bet_actions', 'lease_owner'),
            'lease_expires_at' => ! Schema::hasColumn('bet_actions', 'lease_expires_at'),
        ];
        if (in_array(true, $actionColumns, true)) {
            Schema::table('bet_actions', function (Blueprint $table) use ($actionColumns): void {
                if ($actionColumns['account_id']) {
                    $table->text('account_id')->default('');
                    $table->index('account_id', 'idx_bet_actions_account');
                }
                if ($actionColumns['confirmation_revision']) {
                    $table->text('confirmation_revision')->default('');
                    $table->index('confirmation_revision', 'idx_bet_actions_confirmation_rev');
                }
                if ($actionColumns['reserved_stake_vnd']) {
                    $table->bigInteger('reserved_stake_vnd')->default(0);
                }
                if ($actionColumns['reservation_expires_at']) {
                    $table->timestampTz('reservation_expires_at')->nullable();
                }
                if ($actionColumns['exposure_id']) {
                    $table->text('exposure_id')->default('');
                    $table->index('exposure_id', 'idx_bet_actions_exposure');
                }
                if ($actionColumns['reprice_revision']) {
                    $table->unsignedSmallInteger('reprice_revision')->default(0);
                }
                if ($actionColumns['version']) {
                    $table->unsignedBigInteger('version')->default(1);
                }
                if ($actionColumns['lease_owner']) {
                    $table->text('lease_owner')->default('');
                }
                if ($actionColumns['lease_expires_at']) {
                    $table->timestampTz('lease_expires_at')->nullable();
                    $table->index('lease_expires_at', 'idx_bet_actions_lease_expiry');
                }
            });
        }
        if (! $this->hasOrderedIndex('bet_actions', ['account_id', 'reservation_expires_at'])) {
            Schema::table('bet_actions', function (Blueprint $table): void {
                $table->index(['account_id', 'reservation_expires_at'], 'idx_bet_actions_account_reservation');
            });
        }

        // Migration 000009 already creates this pair on fresh installs. Check
        // columns, not a generated name, so upgraded databases never receive a
        // second equivalent status/created_at index.
        if (! $this->hasOrderedIndex('bet_actions', ['status', 'created_at'])) {
            Schema::table('bet_actions', function (Blueprint $table): void {
                $table->index(['status', 'created_at'], 'idx_bet_actions_status_created');
            });
        }

        if (! Schema::hasTable('bet_attempts')) {
            Schema::create('bet_attempts', function (Blueprint $table): void {
                $table->string('id')->primary();
                $table->text('idempotency_key')->unique('uq_bet_attempts_idempotency');
                $table->string('action_id');
                $table->string('exposure_id')->default('');
                $table->text('account_id')->default('');
                $table->unsignedSmallInteger('attempt_number');
                $table->text('phase');
                $table->text('status');
                $table->text('result')->default('');
                $table->text('request_id')->default('');
                $table->text('session_id')->default('');
                $table->text('session_generation')->default('');
                $table->text('leg_id');
                $table->text('bookmaker_id');
                $table->text('lobby_id')->default('');
                $table->text('collector_id')->default('');
                $table->text('fixture_id')->default('');
                $table->text('market_id')->default('');
                $table->text('outcome_id')->default('');
                $table->text('provider_reference')->default('');
                $table->text('prepare_id')->default('');
                $table->text('slip_fingerprint')->default('');
                $table->text('quote_revision')->default('');
                $table->text('odds_format')->default('');
                $table->double('raw_odds')->default(0);
                $table->double('expected_odds')->default(0);
                $table->double('submitted_odds')->default(0);
                $table->double('offered_odds')->default(0);
                $table->double('accepted_odds')->default(0);
                $table->bigInteger('requested_stake_vnd')->default(0);
                $table->bigInteger('accepted_stake_vnd')->default(0);
                $table->bigInteger('minimum_stake_vnd')->default(0);
                $table->bigInteger('maximum_stake_vnd')->default(0);
                $table->bigInteger('stake_increment_vnd')->default(0);
                $table->bigInteger('balance_vnd')->default(0);
                $table->text('ticket_id')->default('');
                $table->text('raw_response_hash')->default('');
                $table->timestampTz('expires_at')->nullable();
                $table->timestampTz('observed_at')->nullable();
                $table->timestampTz('submit_started_at')->nullable();
                $table->timestampTz('response_received_at')->nullable();
                $table->timestampTz('reconciled_at')->nullable();
                $table->unsignedBigInteger('version')->default(1);
                $table->text('error_code')->default('');
                $table->text('error_message')->default('');
                $table->timestampTz('created_at')->useCurrent();
                $table->timestampTz('updated_at')->useCurrent();
                $table->timestampTz('deleted_at')->nullable();

                $table->unique(
                    ['action_id', 'bookmaker_id', 'phase', 'attempt_number'],
                    'uq_bet_attempts_action_book_phase_no'
                );
                $table->index(['action_id', 'created_at'], 'idx_bet_attempts_action_created');
                $table->index(['exposure_id', 'created_at'], 'idx_bet_attempts_exposure_created');
                $table->index(['status', 'created_at'], 'idx_bet_attempts_status_created');
                $table->index('request_id', 'idx_bet_attempts_request');
                $table->index('ticket_id', 'idx_bet_attempts_ticket');
                $table->foreign('action_id')->references('id')->on('bet_actions')->cascadeOnDelete();
            });
        }

        if (! Schema::hasTable('bet_exposures')) {
            Schema::create('bet_exposures', function (Blueprint $table): void {
                $table->string('id')->primary();
                $table->text('idempotency_key')->unique('uq_bet_exposures_idempotency');
                $table->string('action_id')->unique('uq_bet_exposures_action');
                $table->text('account_id');
                $table->text('status');
                $table->text('currency')->default('VND');
                $table->unsignedBigInteger('version')->default(1);
                $table->text('lease_owner')->default('');
                $table->timestampTz('lease_expires_at')->nullable();

                $table->string('jun88_attempt_id');
                $table->text('jun88_ticket_id');
                $table->text('jun88_leg_id');
                $table->text('jun88_fixture_id');
                $table->text('jun88_market_id');
                $table->text('jun88_outcome_id');
                $table->text('jun88_provider_reference');
                $table->double('jun88_accepted_odds');
                $table->bigInteger('jun88_stake_vnd');
                $table->timestampTz('jun88_accepted_at');

                $table->text('hedge_bookmaker_id')->default('8xbet');
                $table->text('hedge_leg_id');
                $table->text('hedge_fixture_id');
                $table->text('hedge_market_id');
                $table->text('hedge_outcome_id');
                $table->text('hedge_provider_reference');
                $table->bigInteger('maximum_total_stake_vnd');
                $table->bigInteger('hedge_minimum_stake_vnd')->default(0);
                $table->bigInteger('hedge_maximum_stake_vnd')->default(0);
                $table->bigInteger('hedge_stake_increment_vnd');
                $table->double('current_hedge_odds')->default(0);
                $table->bigInteger('required_hedge_stake_vnd')->default(0);
                $table->bigInteger('projected_jun_profit_vnd')->default(0);
                $table->bigInteger('projected_hedge_profit_vnd')->default(0);
                $table->text('last_quote_revision')->default('');
                $table->timestampTz('last_quote_observed_at')->nullable();
                $table->timestampTz('next_evaluation_at')->nullable();

                $table->string('hedge_attempt_id')->default('');
                $table->text('hedge_ticket_id')->default('');
                $table->double('hedge_accepted_odds')->default(0);
                $table->bigInteger('hedge_accepted_stake_vnd')->default(0);
                $table->timestampTz('hedge_accepted_at')->nullable();
                $table->timestampTz('opened_at');
                $table->timestampTz('completed_at')->nullable();
                $table->timestampTz('closed_at')->nullable();
                $table->timestampTz('market_closed_at')->nullable();
                $table->text('last_failure_code')->default('');
                $table->text('last_failure_message')->default('');
                $table->timestampTz('created_at')->useCurrent();
                $table->timestampTz('updated_at')->useCurrent();
                $table->timestampTz('deleted_at')->nullable();

                $table->index(['status', 'next_evaluation_at'], 'idx_bet_exposures_due');
                $table->index(['account_id', 'status'], 'idx_bet_exposures_account_status');
                $table->index('lease_expires_at', 'idx_bet_exposures_lease_expiry');
                $table->index(
                    ['hedge_bookmaker_id', 'hedge_fixture_id', 'hedge_market_id', 'hedge_outcome_id', 'status'],
                    'idx_bet_exposures_hedge_target'
                );
                $table->foreign('action_id')->references('id')->on('bet_actions')->cascadeOnDelete();
            });
        }

        if (! Schema::hasTable('bet_action_events')) {
            Schema::create('bet_action_events', function (Blueprint $table): void {
                $table->string('id')->primary();
                $table->text('idempotency_key')->unique('uq_bet_action_events_idempotency');
                $table->string('action_id');
                $table->string('exposure_id')->default('');
                $table->unsignedBigInteger('sequence');
                $table->text('type');
                $table->text('status');
                $table->text('bookmaker_id')->default('');
                $table->text('message')->default('');
                $table->jsonb('metadata')->default(DB::raw("'{}'::jsonb"));
                $table->timestampTz('occurred_at');
                $table->timestampTz('created_at')->useCurrent();
                $table->timestampTz('updated_at')->useCurrent();
                $table->timestampTz('deleted_at')->nullable();

                $table->unique(['action_id', 'sequence'], 'uq_bet_action_events_action_sequence');
                $table->index(['action_id', 'occurred_at'], 'idx_bet_action_events_action_time');
                $table->index(['exposure_id', 'occurred_at'], 'idx_bet_action_events_exposure_time');
                $table->foreign('action_id')->references('id')->on('bet_actions')->cascadeOnDelete();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('bet_action_events');
        Schema::dropIfExists('bet_exposures');
        Schema::dropIfExists('bet_attempts');
        if (Schema::hasTable('bet_actions')) {
            $columns = array_values(array_filter([
                'account_id',
                'confirmation_revision',
                'reserved_stake_vnd',
                'reservation_expires_at',
                'exposure_id',
                'reprice_revision',
                'version',
                'lease_owner',
                'lease_expires_at',
            ], fn (string $column): bool => Schema::hasColumn('bet_actions', $column)));
            if ($columns !== []) {
                Schema::table('bet_actions', function (Blueprint $table) use ($columns): void {
                    $table->dropColumn($columns);
                });
            }
        }

        if (Schema::hasTable('odds_quotes') && Schema::hasColumn('odds_quotes', 'provider_reference')) {
            Schema::table('odds_quotes', function (Blueprint $table): void {
                $table->dropColumn('provider_reference');
            });
        }
    }

    /** @param array<int, string> $columns */
    private function hasOrderedIndex(string $table, array $columns): bool
    {
        foreach (Schema::getIndexes($table) as $index) {
            if (($index['columns'] ?? []) === $columns) {
                return true;
            }
        }

        return false;
    }
};
