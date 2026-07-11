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
            Schema::create('telegram_recipients', function (Blueprint $table): void {
                $table->id();
                $table->text('name');
                $table->text('chat_id');
                $table->boolean('is_active')->default(true);
                $table->text('notes')->default('');
                $table->timestampTz('created_at')->useCurrent();
                $table->timestampTz('updated_at')->useCurrent();
            });
        }

        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_recipients_chat_id ON telegram_recipients (chat_id)');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_telegram_recipients_active ON telegram_recipients (is_active)');
    }

    public function down(): void
    {
        Schema::dropIfExists('telegram_recipients');
    }
};
