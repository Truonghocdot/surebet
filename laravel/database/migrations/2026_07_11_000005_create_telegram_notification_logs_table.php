<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('telegram_notification_logs')) {
            Schema::create('telegram_notification_logs', function (Blueprint $table): void {
                $table->string('id')->primary();
                $table->foreignId('recipient_id')->constrained('telegram_recipients')->cascadeOnDelete();
                $table->text('opportunity_id');
                $table->text('fixture_id')->default('');
                $table->text('market_name')->default('');
                $table->double('profit_percentage')->default(0);
                $table->text('status')->default('sent');
                $table->text('error_message')->default('');
                $table->text('message')->default('');
                $table->timestampTz('sent_at');
                $table->timestampTz('created_at')->useCurrent();
                $table->timestampTz('updated_at')->useCurrent();
            });
        }

        DB::statement(<<<'SQL'
            CREATE INDEX IF NOT EXISTS idx_telegram_notification_logs_recent_lookup
            ON telegram_notification_logs (recipient_id, opportunity_id, status, sent_at DESC)
        SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('telegram_notification_logs');
    }
};
