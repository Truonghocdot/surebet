<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('users')) {
            Schema::create('users', function (Blueprint $table): void {
                $table->string('id')->primary();
                $table->text('email');
                $table->text('password_hash')->default('');
                $table->text('full_name')->default('');
                $table->text('role')->default('operator');
                $table->boolean('is_active')->default(true);
                $table->text('locale')->default('vi');
                $table->text('timezone')->default('Asia/Ho_Chi_Minh');
                $table->timestampTz('last_login_at')->nullable();
                $table->timestampTz('created_at')->useCurrent();
                $table->timestampTz('updated_at')->useCurrent();
                $table->timestampTz('deleted_at')->nullable();
            });
        }

        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)');
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};
