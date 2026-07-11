<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

class SurebetAccountSeeder extends Seeder
{
    public function run(): void
    {
        $this->upsertUser(
            id: (string) env('SEED_FRONTEND_USER_ID', 'surebet-operator'),
            email: (string) env('SEED_FRONTEND_USER_EMAIL', 'operator@surebet.local'),
            password: (string) env('SEED_FRONTEND_USER_PASSWORD', 'matkhau123'),
            fullName: (string) env('SEED_FRONTEND_USER_FULL_NAME', 'Surebet Operator'),
            role: (string) env('SEED_FRONTEND_USER_ROLE', 'operator'),
        );

        $this->upsertUser(
            id: (string) env('SEED_SUPER_ADMIN_ID', 'surebet-super-admin'),
            email: (string) env('SEED_SUPER_ADMIN_EMAIL', 'superadmin@surebet.local'),
            password: (string) env('SEED_SUPER_ADMIN_PASSWORD', 'superadmin123'),
            fullName: (string) env('SEED_SUPER_ADMIN_FULL_NAME', 'Surebet Super Admin'),
            role: (string) env('SEED_SUPER_ADMIN_ROLE', 'super_admin'),
        );
    }

    private function hashPassword(string $password): string
    {
        return base64_encode(hash('sha256', $password, true));
    }

    private function upsertUser(
        string $id,
        string $email,
        string $password,
        string $fullName,
        string $role,
    ): void {
        $now = Carbon::now();

        User::query()->updateOrCreate(
            ['email' => $email],
            [
                'id' => $id,
                'password' => password_hash($password, PASSWORD_BCRYPT),
                'password_hash' => $this->hashPassword($password),
                'full_name' => $fullName,
                'role' => $role,
                'is_active' => true,
                'locale' => 'vi',
                'timezone' => 'Asia/Ho_Chi_Minh',
                'updated_at' => $now,
                'created_at' => $now,
            ]
        );
    }
}
