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
            return;
        }

        Schema::table('telegram_notification_logs', function (Blueprint $table): void {
            if (! Schema::hasColumn('telegram_notification_logs', 'attempt_count')) {
                $table->unsignedInteger('attempt_count')->default(0);
            }

            if (! Schema::hasColumn('telegram_notification_logs', 'available_at')) {
                $table->timestampTz('available_at')->nullable();
            }

            if (! Schema::hasColumn('telegram_notification_logs', 'reserved_at')) {
                $table->timestampTz('reserved_at')->nullable();
            }
        });

        DB::statement(<<<'SQL'
            UPDATE telegram_notification_logs
            SET available_at = COALESCE(available_at, created_at)
            WHERE available_at IS NULL
        SQL);

        DB::statement(<<<'SQL'
            CREATE INDEX IF NOT EXISTS idx_telegram_notification_logs_pending_queue
            ON telegram_notification_logs (status, available_at ASC, created_at ASC)
        SQL);
    }

    public function down(): void
    {
        if (! Schema::hasTable('telegram_notification_logs')) {
            return;
        }

        DB::statement('DROP INDEX IF EXISTS idx_telegram_notification_logs_pending_queue');

        Schema::table('telegram_notification_logs', function (Blueprint $table): void {
            if (Schema::hasColumn('telegram_notification_logs', 'reserved_at')) {
                $table->dropColumn('reserved_at');
            }

            if (Schema::hasColumn('telegram_notification_logs', 'available_at')) {
                $table->dropColumn('available_at');
            }

            if (Schema::hasColumn('telegram_notification_logs', 'attempt_count')) {
                $table->dropColumn('attempt_count');
            }
        });
    }
};
