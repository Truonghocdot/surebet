<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('odds_quotes')) {
            Schema::create('odds_quotes', function (Blueprint $table): void {
                $table->string('id')->primary();
                $table->text('bookmaker_id');
                $table->text('lobby_id');
                $table->text('fixture_id');
                $table->text('fixture_marker')->default('');
                $table->text('home_team')->default('');
                $table->text('away_team')->default('');
                $table->text('league_name')->default('');
                $table->text('sport')->default('');
                $table->text('market_id')->default('');
                $table->text('market_marker')->default('');
                $table->text('market_name')->default('');
                $table->text('outcome_id')->default('');
                $table->text('outcome_marker')->default('');
                $table->text('outcome_name')->default('');
                $table->double('odds')->default(0);
                $table->double('available_stake')->default(0);
                $table->boolean('suspended')->default(false);
                $table->text('match_state')->default('unknown');
                $table->timestampTz('event_start_at')->nullable();
                $table->timestampTz('collected_at');
            });
        }

        DB::statement(<<<'SQL'
            CREATE INDEX IF NOT EXISTS idx_odds_quotes_active_current_snapshot
            ON odds_quotes (
                match_state,
                bookmaker_id,
                lobby_id,
                fixture_marker,
                market_marker,
                outcome_marker,
                collected_at DESC
            )
            WHERE suspended = false AND odds <> 0
        SQL);

        DB::statement(<<<'SQL'
            CREATE INDEX IF NOT EXISTS idx_odds_quotes_live_current_snapshot_key
            ON odds_quotes (
                bookmaker_id,
                lobby_id,
                fixture_marker,
                market_marker,
                outcome_marker,
                collected_at DESC
            )
            WHERE match_state IN ('upcoming', 'live', 'unknown')
              AND suspended = false
              AND odds <> 0
        SQL);

        DB::statement(<<<'SQL'
            CREATE INDEX IF NOT EXISTS idx_odds_quotes_current_snapshot_key
            ON odds_quotes (
                bookmaker_id,
                lobby_id,
                fixture_marker,
                market_marker,
                outcome_marker,
                collected_at DESC
            )
            WHERE match_state IN ('upcoming', 'live', 'unknown')
        SQL);

        DB::statement(<<<'SQL'
            CREATE INDEX IF NOT EXISTS idx_odds_quotes_state_start_window
            ON odds_quotes (
                match_state,
                event_start_at,
                collected_at DESC
            )
            WHERE suspended = false AND odds <> 0
        SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('odds_quotes');
    }
};
