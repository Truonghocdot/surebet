<?php

namespace App\Console\Commands;

use App\Models\OddsQuote;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class OddsStatsCommand extends Command
{
    protected $signature = 'odds:stats {--minutes=30 : Cua so du lieu hien tai tinh bang phut}';

    protected $description = 'Thong ke nhanh bang odds_quotes theo source va trang thai';

    public function handle(): int
    {
        $minutes = max(1, (int) $this->option('minutes'));
        $cutoff = now()->subMinutes($minutes);

        $summary = OddsQuote::query()
            ->selectRaw('COUNT(*) AS total_rows')
            ->selectRaw('MIN(collected_at) AS oldest_collected_at')
            ->selectRaw('MAX(collected_at) AS newest_collected_at')
            ->selectRaw('COUNT(*) FILTER (WHERE collected_at >= ?) AS current_rows', [$cutoff])
            ->first();

        $this->info('Tong quan odds_quotes');
        $this->table(
            ['Tong ban ghi', "Trong {$minutes} phut", 'Cu nhat', 'Moi nhat'],
            [[
                $summary?->total_rows ?? 0,
                $summary?->current_rows ?? 0,
                $summary?->oldest_collected_at ?? '-',
                $summary?->newest_collected_at ?? '-',
            ]]
        );

        $bySource = OddsQuote::query()
            ->select('bookmaker_id', 'lobby_id', 'match_state')
            ->selectRaw('COUNT(*) AS total_rows')
            ->selectRaw('COUNT(*) FILTER (WHERE collected_at >= ?) AS current_rows', [$cutoff])
            ->selectRaw('MAX(collected_at) AS latest_collected_at')
            ->groupBy('bookmaker_id', 'lobby_id', 'match_state')
            ->orderBy('bookmaker_id')
            ->orderBy('lobby_id')
            ->orderBy('match_state')
            ->get();

        $this->info('Theo nha cai / sanh / trang thai');
        $this->table(
            ['Nha cai', 'Sanh', 'Trang thai', 'Tong', "Trong {$minutes} phut", 'Moi nhat'],
            $bySource->map(fn ($row) => [
                $row->bookmaker_id,
                $row->lobby_id,
                $row->match_state,
                $row->total_rows,
                $row->current_rows,
                $row->latest_collected_at,
            ])->all()
        );

        $deadIndexes = DB::table('odds_quotes')
            ->where('collected_at', '<', $cutoff)
            ->count();
        $this->line("Ban ghi cu hon {$minutes} phut: {$deadIndexes}");

        return self::SUCCESS;
    }
}
