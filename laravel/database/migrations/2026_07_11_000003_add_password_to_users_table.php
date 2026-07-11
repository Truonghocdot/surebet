<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('users') && ! Schema::hasColumn('users', 'password')) {
            Schema::table('users', function (Blueprint $table): void {
                $table->text('password')->default('')->after('email');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('users') && Schema::hasColumn('users', 'password')) {
            Schema::table('users', function (Blueprint $table): void {
                $table->dropColumn('password');
            });
        }
    }
};
