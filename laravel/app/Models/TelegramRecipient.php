<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TelegramRecipient extends Model
{
    protected $table = 'telegram_recipients';

    protected $guarded = [];

    protected $casts = [
        'is_active' => 'boolean',
        'last_seen_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function logs(): HasMany
    {
        return $this->hasMany(TelegramNotificationLog::class, 'recipient_id');
    }
}
