<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('bet_actions')) {
            Schema::create('bet_actions', function (Blueprint $table): void {
                $table->string('id')->primary();
                $table->text('idempotency_key')->unique();
                $table->text('opportunity_id');
                $table->text('mode')->default('simulation');
                $table->text('status');
                $table->text('currency')->default('VND');
                $table->bigInteger('total_stake_vnd');
                $table->double('expected_return')->default(0);
                $table->jsonb('legs');
                $table->jsonb('events');
                $table->boolean('exposure_open')->default(false);
                $table->timestampTz('completed_at')->nullable();
                $table->text('error_code')->nullable();
                $table->text('error_message')->nullable();
                $table->timestampTz('created_at')->useCurrent();
                $table->timestampTz('updated_at')->useCurrent();
                $table->timestampTz('deleted_at')->nullable();

                $table->index(['status', 'created_at']);
                $table->index(['opportunity_id', 'created_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('bet_actions');
    }
};
