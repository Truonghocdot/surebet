<?php

namespace App\Filament\Resources\TelegramRecipients\Pages;

use App\Filament\Resources\TelegramRecipients\TelegramRecipientResource;
use Filament\Actions\DeleteAction;
use Filament\Resources\Pages\EditRecord;

class EditTelegramRecipient extends EditRecord
{
    protected static string $resource = TelegramRecipientResource::class;

    protected function getHeaderActions(): array
    {
        return [
            DeleteAction::make(),
        ];
    }
}
