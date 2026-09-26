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
            id: (string) 'surebet-operator',
            email: (string) 'operator@surebet.local',
            password: (string) 'matkhau123',
            fullName: (string) 'Surebet Operator',
            role: (string) 'operator',
        );

        $this->upsertUser(
            id: (string) 'surebet-super-admin',
            email: (string) 'superadmin@surebet.local',
            password: (string) 'superadmin123',
            fullName: (string) 'Surebet Super Admin',
            role: (string) 'super_admin',
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
