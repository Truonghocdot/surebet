<?php

namespace App\Console\Commands;

use App\Models\OddsQuote;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class OddsRetentionCommand extends Command
{
    protected $signature = 'odds:retention
        {--active-hours= : So gio giu du lieu upcoming/live/unknown}
        {--finished-minutes= : So phut giu du lieu finished}
        {--dry-run : Chi dem so ban ghi se xoa, khong xoa that}
        {--vacuum : Chay VACUUM ANALYZE odds_quotes sau khi xoa}';

    protected $description = 'Don du lieu odds_quotes cu de bang khong phinh vo han';

    public function handle(): int
    {
        $activeHours = (int) ($this->option('active-hours') ?: env('ODDS_RETENTION_ACTIVE_HOURS', 24));
        $finishedMinutes = (int) ($this->option('finished-minutes') ?: env('ODDS_RETENTION_FINISHED_MINUTES', 30));

        if ($activeHours <= 0 || $finishedMinutes <= 0) {
            $this->error('active-hours va finished-minutes phai lon hon 0.');
            return self::FAILURE;
        }

        $activeCutoff = now()->subHours($activeHours);
        $finishedCutoff = now()->subMinutes($finishedMinutes);
        $query = $this->expiredQuery($activeCutoff, $finishedCutoff);
        $expiredCount = (clone $query)->count();

        $this->line("Nguong du lieu active: cu hon {$activeHours} gio ({$activeCutoff->toIso8601String()})");
        $this->line("Nguong du lieu finished: cu hon {$finishedMinutes} phut ({$finishedCutoff->toIso8601String()})");
        $this->info("So ban ghi se xoa: {$expiredCount}");

        if ($this->option('dry-run')) {
            $this->warn('Dry-run: chua xoa ban ghi nao.');
            return self::SUCCESS;
        }

        if ($expiredCount === 0) {
            $this->info('Khong co du lieu can don.');
            return self::SUCCESS;
        }

        $deleted = $query->delete();
        $this->info("Da xoa {$deleted} ban ghi.");

        if ($this->option('vacuum')) {
            DB::statement('VACUUM ANALYZE odds_quotes');
            $this->info('Da chay VACUUM ANALYZE odds_quotes.');
        }

        return self::SUCCESS;
    }

    private function expiredQuery($activeCutoff, $finishedCutoff)
    {
        return OddsQuote::query()
            ->where(function ($query) use ($activeCutoff, $finishedCutoff): void {
                $query
                    ->where('collected_at', '<', $activeCutoff)
                    ->orWhere(function ($finishedQuery) use ($finishedCutoff): void {
                        $finishedQuery
                            ->where('match_state', 'finished')
                            ->where('collected_at', '<', $finishedCutoff);
                    });
            });
    }
}
