<?php

namespace App\Providers;

use App\Console\Commands\OddsRetentionCommand;
use App\Console\Commands\OddsStatsCommand;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $appUrl = trim((string) config('app.url', ''));
        if ($appUrl !== '') {
            URL::forceRootUrl($appUrl);

            if (str_starts_with($appUrl, 'https://')) {
                URL::forceScheme('https');
            }
        }

        if ($this->app->runningInConsole()) {
            $this->commands([
                OddsRetentionCommand::class,
                OddsStatsCommand::class,
            ]);
        }
    }
}
