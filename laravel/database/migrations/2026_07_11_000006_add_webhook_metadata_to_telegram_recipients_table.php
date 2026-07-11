<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('telegram_recipients')) {
            return;
        }

        Schema::table('telegram_recipients', function (Blueprint $table): void {
            if (! Schema::hasColumn('telegram_recipients', 'source')) {
                $table->text('source')->default('manual');
            }

            if (! Schema::hasColumn('telegram_recipients', 'chat_type')) {
                $table->text('chat_type')->nullable();
            }

            if (! Schema::hasColumn('telegram_recipients', 'telegram_username')) {
                $table->text('telegram_username')->nullable();
            }

            if (! Schema::hasColumn('telegram_recipients', 'membership_status')) {
                $table->text('membership_status')->nullable();
            }

            if (! Schema::hasColumn('telegram_recipients', 'last_seen_at')) {
                $table->timestampTz('last_seen_at')->nullable();
            }
        });

        DB::statement('CREATE INDEX IF NOT EXISTS idx_telegram_recipients_source ON telegram_recipients (source)');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_telegram_recipients_last_seen_at ON telegram_recipients (last_seen_at DESC)');
    }

    public function down(): void
    {
        if (! Schema::hasTable('telegram_recipients')) {
            return;
        }

        DB::statement('DROP INDEX IF EXISTS idx_telegram_recipients_source');
        DB::statement('DROP INDEX IF EXISTS idx_telegram_recipients_last_seen_at');

        Schema::table('telegram_recipients', function (Blueprint $table): void {
            if (Schema::hasColumn('telegram_recipients', 'last_seen_at')) {
                $table->dropColumn('last_seen_at');
            }

            if (Schema::hasColumn('telegram_recipients', 'membership_status')) {
                $table->dropColumn('membership_status');
            }

            if (Schema::hasColumn('telegram_recipients', 'telegram_username')) {
                $table->dropColumn('telegram_username');
            }

            if (Schema::hasColumn('telegram_recipients', 'chat_type')) {
                $table->dropColumn('chat_type');
            }

            if (Schema::hasColumn('telegram_recipients', 'source')) {
                $table->dropColumn('source');
            }
        });
    }
};
