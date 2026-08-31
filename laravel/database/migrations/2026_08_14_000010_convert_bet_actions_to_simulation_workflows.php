<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('bet_actions') || ! Schema::hasColumn('bet_actions', 'request_fingerprint')) {
            return;
        }

        Schema::table('bet_actions', function (Blueprint $table): void {
            $table->text('opportunity_id')->default('');
            $table->text('mode')->default('simulation');
            $table->bigInteger('total_stake_vnd')->default(0);
            $table->double('expected_return')->default(0);
            $table->jsonb('legs')->default(DB::raw("'[]'::jsonb"));
            $table->jsonb('events')->default(DB::raw("'[]'::jsonb"));
            $table->boolean('exposure_open')->default(false);
            $table->timestampTz('completed_at')->nullable();
        });

        DB::statement(<<<'SQL'
            UPDATE bet_actions
            SET opportunity_id = COALESCE(source_opportunity_id, ''),
                total_stake_vnd = stake_vnd,
                status = 'failed',
                error_code = 'legacy_single_leg_action',
                error_message = 'Replaced by the two-leg auto-bet simulation workflow'
        SQL);

        Schema::table('bet_actions', function (Blueprint $table): void {
            $table->dropColumn([
                'request_fingerprint',
                'action_type',
                'bookmaker_id',
                'lobby_id',
                'bet_type',
                'stake_vnd',
                'selections',
                'source_opportunity_id',
                'expires_at',
            ]);
            $table->index(['opportunity_id', 'created_at']);
        });
    }

    public function down(): void
    {
        // Legacy single-leg actions cannot be reconstructed from two-leg workflow rows.
    }
};
