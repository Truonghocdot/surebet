<?php

use Illuminate\Support\Facades\Artisan;

Artisan::command('surebet:about', function (): void {
    $this->info('Surebet Laravel Data Tools');
    $this->line('Dung cac lenh odds:stats, odds:retention, migrate va tinker de quan ly du lieu.');
})->purpose('Hien thi thong tin service quan ly du lieu Surebet');
