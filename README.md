# Todo Planner（LINE + SQLite, MVP）

LINE で「追加・一覧・完了」ができ、締切超過を自動検知して本人＋監視グループに通知する最小実行可能な ToDo アプリです。

## スタック

- Node.js + Express
- @line/bot-sdk（Messaging API）
- sqlite3（ローカル DB）
- node-cron（締切チェック）
- ngrok（ローカル Webhook 公開）

## データスキーマ（MVP）

- tasks: id, line_user_id, title, deadline（YYYY-MM-DD HH:mm）, status（pending|done|failed）, created_at
- groups: id, group_id, owner_line_user_id, created_at

## LINE コマンド（個チャ/グループ）

- 追加: `add 2025-08-12 23:00 レポート仕上げ`
- 一覧: `ls`
- 完了: `done 3`
- 監視グループ登録（グループ内で実行）: `watch here`

## セットアップ

1. 環境変数を設定

```bash
cp .env.example .env
# .env に LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN を設定
```

2. 依存関係のインストール

```bash
npm install
```

3. ローカル起動

```bash
npm run dev
```

4. ngrok で Webhook を公開し、LINE コンソール（Messaging API 設定）に登録

```bash
ngrok http 3000
# Webhook URL: https://<ngrokドメイン>/line/webhook
# Webhookを「有効化」し、Botを友だち追加
```

## 動作確認の流れ

1. 個チャで `add 2025-08-12 23:00 テスト` → 「登録 OK」返信
2. `ls` → 登録済みタスクの一覧が見える
3. `done 1` → 完了
4. Bot をグループに招待して、グループ内で `watch here` → 監視先グループとして登録
5. 期限を過ぎると、毎分のチェックで `pending -> failed` に更新され、
   - 本人: `⚠️未達成「タイトル」（期限: YYYY-MM-DD HH:mm）`
   - 監視グループ: `📢未達成: タイトル（期限超過）`
     が Push 通知で届きます。

## 注意点（MVP の割り切り）

- 日時は `YYYY-MM-DD HH:mm` のみ対応（ローカル時刻）
- 監視は「ユーザー 1 ↔ グループ 1」を想定（最新登録を採用）
- 締切チェックは毎分実行（厳密な秒単位は考慮しません）
- DB ファイルは既定で `./data.db`（`.env` の `DATABASE_PATH` で変更可）

## 環境変数

- LINE_CHANNEL_SECRET
- LINE_CHANNEL_ACCESS_TOKEN
- PORT（省略時 3000）
- DATABASE_PATH（省略時 ./data.db）

## ヘルスチェック

- GET `/` → `ok`

## デプロイ（参考）

- API: Render/Railway 等でデプロイし、Webhook URL を本番に設定
- フロントエンド（Next.js）は次スプリントで追加予定
