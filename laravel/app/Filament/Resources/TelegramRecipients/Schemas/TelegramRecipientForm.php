<?php

namespace App\Filament\Resources\TelegramRecipients\Schemas;

use Illuminate\Support\Carbon;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class TelegramRecipientForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Thong tin nhan thong bao')
                    ->schema([
                        TextInput::make('name')
                            ->label('Ten hien thi')
                            ->required()
                            ->maxLength(255),
                        TextInput::make('chat_id')
                            ->label('Chat ID Telegram')
                            ->required()
                            ->helperText('Ho tro chat ca nhan, group hoac channel. Vi du: 123456789 hoac -1001234567890')
                            ->maxLength(255)
                            ->unique(ignoreRecord: true),
                        Toggle::make('is_active')
                            ->label('Dang nhan thong bao')
                            ->default(true),
                        Textarea::make('notes')
                            ->label('Ghi chu')
                            ->rows(4)
                            ->maxLength(5000),
                    ]),
                Section::make('Thong tin webhook Telegram')
                    ->schema([
                        TextInput::make('source')
                            ->label('Nguon tao')
                            ->disabled()
                            ->dehydrated(false),
                        TextInput::make('chat_type')
                            ->label('Loai chat')
                            ->disabled()
                            ->dehydrated(false),
                        TextInput::make('telegram_username')
                            ->label('Username Telegram')
                            ->disabled()
                            ->dehydrated(false),
                        TextInput::make('membership_status')
                            ->label('Trang thai membership')
                            ->disabled()
                            ->dehydrated(false),
                        TextInput::make('last_seen_at')
                            ->label('Lan cuoi bot duoc thay')
                            ->disabled()
                            ->dehydrated(false)
                            ->formatStateUsing(
                                fn (mixed $state): string => filled($state)
                                    ? Carbon::parse((string) $state)->format('d/m/Y H:i:s')
                                    : ''
                            ),
                    ])
                    ->columns(2),
            ]);
    }
}
