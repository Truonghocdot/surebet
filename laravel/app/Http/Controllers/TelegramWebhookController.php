<?php

namespace App\Http\Controllers;

use App\Models\TelegramRecipient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TelegramWebhookController
{
    public function __invoke(Request $request): JsonResponse
    {
        if (! $this->hasValidSecret($request)) {
            return response()->json([
                'ok' => false,
                'message' => 'Webhook secret khong hop le.',
            ], 403);
        }

        $result = $this->handleUpdate($request->json()->all() ?: $request->all());

        return response()->json([
            'ok' => true,
            'result' => $result,
        ]);
    }

    private function hasValidSecret(Request $request): bool
    {
        $expected = trim((string) config('services.telegram.webhook_secret', ''));
        if ($expected === '') {
            return true;
        }

        $provided = (string) $request->header('X-Telegram-Bot-Api-Secret-Token', '');

        return $provided !== '' && hash_equals($expected, $provided);
    }

    /**
     * @param array<string, mixed> $update
     * @return array<string, mixed>
     */
    private function handleUpdate(array $update): array
    {
        $myChatMember = $update['my_chat_member'] ?? null;
        if (! is_array($myChatMember)) {
            return [
                'status' => 'ignored',
                'reason' => 'unsupported_update',
            ];
        }

        return $this->syncRecipientFromMyChatMember($myChatMember);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    private function syncRecipientFromMyChatMember(array $payload): array
    {
        $chat = $payload['chat'] ?? null;
        if (! is_array($chat) || ! array_key_exists('id', $chat)) {
            return [
                'status' => 'ignored',
                'reason' => 'missing_chat',
            ];
        }

        $chatId = (string) $chat['id'];
        $membershipStatus = trim((string) (($payload['new_chat_member']['status'] ?? null) ?: ''));
        $chatType = trim((string) (($chat['type'] ?? null) ?: ''));
        $chatName = $this->resolveChatName($chat);
        $username = $this->normalizeUsername($chat['username'] ?? null);

        $recipient = TelegramRecipient::query()->firstOrNew([
            'chat_id' => $chatId,
        ]);

        $wasCreated = ! $recipient->exists;

        $recipient->name = $chatName;
        $recipient->chat_type = $chatType !== '' ? $chatType : null;
        $recipient->telegram_username = $username;
        $recipient->source = $recipient->source ?: 'telegram_webhook';
        $recipient->membership_status = $membershipStatus !== '' ? $membershipStatus : null;
        $recipient->last_seen_at = now();

        if ($wasCreated) {
            $recipient->is_active = false;
            if (blank($recipient->notes)) {
                $recipient->notes = 'Duoc tao tu webhook Telegram. Bat thong bao trong Filament neu can gui surebet vao chat nay.';
            }
        } elseif ($this->isInactiveMembershipStatus($membershipStatus)) {
            $recipient->is_active = false;
        }

        $recipient->save();

        return [
            'status' => $wasCreated ? 'created' : 'updated',
            'chat_id' => $recipient->chat_id,
            'chat_type' => $recipient->chat_type,
            'membership_status' => $recipient->membership_status,
            'is_active' => $recipient->is_active,
        ];
    }

    /**
     * @param array<string, mixed> $chat
     */
    private function resolveChatName(array $chat): string
    {
        $title = trim((string) (($chat['title'] ?? null) ?: ''));
        if ($title !== '') {
            return $title;
        }

        $username = $this->normalizeUsername($chat['username'] ?? null);
        if ($username !== null) {
            return $username;
        }

        $firstName = trim((string) (($chat['first_name'] ?? null) ?: ''));
        $lastName = trim((string) (($chat['last_name'] ?? null) ?: ''));
        $fullName = trim($firstName.' '.$lastName);

        if ($fullName !== '') {
            return $fullName;
        }

        return 'Telegram chat '.$chat['id'];
    }

    private function normalizeUsername(mixed $value): ?string
    {
        $username = trim((string) ($value ?? ''));

        if ($username === '') {
            return null;
        }

        return '@'.ltrim($username, '@');
    }

    private function isInactiveMembershipStatus(string $status): bool
    {
        return in_array($status, ['left', 'kicked'], true);
    }
}
