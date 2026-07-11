<?php

namespace App\Filament\Resources\TelegramRecipients;

use App\Filament\Resources\TelegramRecipients\Pages\CreateTelegramRecipient;
use App\Filament\Resources\TelegramRecipients\Pages\EditTelegramRecipient;
use App\Filament\Resources\TelegramRecipients\Pages\ListTelegramRecipients;
use App\Filament\Resources\TelegramRecipients\Schemas\TelegramRecipientForm;
use App\Filament\Resources\TelegramRecipients\Tables\TelegramRecipientsTable;
use App\Models\TelegramRecipient;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;

class TelegramRecipientResource extends Resource
{
    protected static ?string $model = TelegramRecipient::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedRectangleStack;

    protected static ?string $navigationLabel = 'Nguoi nhan Telegram';

    protected static ?string $modelLabel = 'Nguoi nhan Telegram';

    protected static ?string $pluralModelLabel = 'Nguoi nhan Telegram';

    public static function form(Schema $schema): Schema
    {
        return TelegramRecipientForm::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return TelegramRecipientsTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [
            //
        ];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListTelegramRecipients::route('/'),
            'create' => CreateTelegramRecipient::route('/create'),
            'edit' => EditTelegramRecipient::route('/{record}/edit'),
        ];
    }
}
