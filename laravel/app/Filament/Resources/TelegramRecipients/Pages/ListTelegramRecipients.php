<?php

namespace App\Filament\Resources\TelegramRecipients\Pages;

use App\Filament\Resources\TelegramRecipients\TelegramRecipientResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListTelegramRecipients extends ListRecords
{
    protected static string $resource = TelegramRecipientResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make(),
        ];
    }
}
