<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TelegramNotificationLog extends Model
{
    protected $table = 'telegram_notification_logs';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $casts = [
        'profit_percentage' => 'float',
        'attempt_count' => 'integer',
        'available_at' => 'datetime',
        'reserved_at' => 'datetime',
        'sent_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(TelegramRecipient::class, 'recipient_id');
    }
}
