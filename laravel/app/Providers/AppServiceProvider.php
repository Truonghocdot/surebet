<?php

namespace App\Providers;

use App\Console\Commands\OddsRetentionCommand;
use App\Console\Commands\OddsStatsCommand;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->commands([
                OddsRetentionCommand::class,
                OddsStatsCommand::class,
            ]);
        }
    }
}
