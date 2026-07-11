<?php

namespace App\Filament\Resources\TelegramRecipients\Tables;

use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\EditAction;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class TelegramRecipientsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('name')
                    ->label('Ten')
                    ->searchable()
                    ->sortable(),
                TextColumn::make('chat_id')
                    ->label('Chat ID')
                    ->searchable()
                    ->copyable(),
                TextColumn::make('source')
                    ->label('Nguon')
                    ->badge()
                    ->sortable(),
                TextColumn::make('chat_type')
                    ->label('Loai chat')
                    ->badge()
                    ->sortable(),
                TextColumn::make('telegram_username')
                    ->label('Username')
                    ->searchable()
                    ->toggleable(),
                TextColumn::make('membership_status')
                    ->label('Membership')
                    ->badge()
                    ->sortable(),
                IconColumn::make('is_active')
                    ->label('Dang bat')
                    ->boolean(),
                TextColumn::make('last_seen_at')
                    ->label('Lan cuoi thay')
                    ->since()
                    ->sortable(),
                TextColumn::make('updated_at')
                    ->label('Cap nhat')
                    ->since()
                    ->sortable(),
            ])
            ->recordActions([
                EditAction::make(),
            ])
            ->toolbarActions([
                BulkActionGroup::make([
                    DeleteBulkAction::make(),
                ]),
            ]);
    }
}
