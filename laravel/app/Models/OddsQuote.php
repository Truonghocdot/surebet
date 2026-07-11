<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class OddsQuote extends Model
{
    protected $table = 'odds_quotes';

    protected $primaryKey = 'id';

    public $incrementing = false;

    public $timestamps = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $casts = [
        'odds' => 'float',
        'available_stake' => 'float',
        'suspended' => 'boolean',
        'event_start_at' => 'datetime',
        'collected_at' => 'datetime',
    ];

    public function scopeActiveMatch(Builder $query): Builder
    {
        return $query->whereIn('match_state', ['upcoming', 'live', 'unknown']);
    }

    public function scopePlayable(Builder $query): Builder
    {
        return $query
            ->where('suspended', false)
            ->where('odds', '<>', 0);
    }
}
