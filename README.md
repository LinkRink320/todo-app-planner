# Todo Planner（LINE + SQLite, MVP）

LINE で「追加・一覧・完了」ができ、締切超過を自動検知して本人＋監視グループに通知する最小実行可能な ToDo アプリです。30 分前/5 分前の事前リマインドも行います。短期タスクに加えて、長期目標（進捗%）とプロジェクト（長期の器）＋紐づくタスクの管理をサポートします。

## スタック

- Node.js + Express
- @line/bot-sdk（Messaging API）
- sqlite3（ローカル DB）
- node-cron（締切チェック）
- ngrok（ローカル Webhook 公開）
- 最小REST + 簡易Web UI（PDCA ログ）

## データスキーマ

- tasks: id, line_user_id, title, deadline（YYYY-MM-DD HH:mm）, status（pending|done|failed）, created_at,
  - type（short|long）, progress（0-100）, last_progress_at, updated_at
- groups: id, group_id, owner_line_user_id, created_at
- projects: id, line_user_id, name, status（active|archived）, created_at, updated_at
- tasks.project_id: INTEGER（任意。プロジェクトに紐づくタスク）

## LINE コマンド（個チャ/グループ）

- 追加: `add 2025-08-12 23:00 レポート仕上げ`
- 一覧: `ls`
- 完了: `done 3`
- 監視グループ登録（グループ内で実行）: `watch here`

長期目標:

- 追加（長期）: `addl 2025-12-31 23:59 英語B2`（初期 progress=0%）
- 一覧（長期）: `lsl`
- 進捗更新: `prog 10 45%`（ID=10 の目標を 45% に更新）

プロジェクト:

- 追加: `padd 新規事業A`
- 一覧: `pls`
- タスク追加（プロジェクト配下）: `addp 3 2025-09-01 09:00 企画書ドラフト`
- タスク一覧（プロジェクト配下）: `lsp 3`

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
6. 事前リマインド: 期限の 30 分前と 5 分前に、本人にリマインドが届きます（短期タスク）

長期目標の確認:

1. 個チャで `addl 2025-12-31 23:59 英語B2`
2. `lsl` で進捗一覧（最新更新順）
3. `prog 1 30%` で更新 → `lsl` に反映

## 注意点（割り切り）

- 日時は `YYYY-MM-DD HH:mm` のみ対応（ローカル時刻）
- 監視は「ユーザー 1 ↔ グループ 1」を想定（最新登録を採用）
- 締切チェックは毎分実行（厳密な秒単位は考慮しません）
- DB ファイルは既定で `./data.db`（`.env` の `DATABASE_PATH` で変更可）
- リマインドは同一分に一致したものに送信（再起動直後などの重複送信は稀に起こる可能性あり）

## 環境変数

- LINE_CHANNEL_SECRET
- LINE_CHANNEL_ACCESS_TOKEN
- PORT（省略時 3000）
- DATABASE_PATH（省略時 ./data.db）
- TZ（省略時 未設定。クラウドでは `Asia/Tokyo` を推奨）
- API_KEY（REST/簡易UI 用。任意）
- DEFAULT_LINE_USER_ID（任意。/app 初期入力に使用）
- DEFAULT_LINE_USER_NAME（任意。将来用途）

## ヘルスチェック

- GET `/` → `ok`
- GET `/app` → 簡易PDCA UI（.env の API_KEY を `x-api-key` に設定して利用）
- GET `/api/config` → クライアント初期化用の公開設定（APIキーは返しません）
- GET `/api/line-profile?user_id=...`（要 `x-api-key`）→ LINEのdisplayName参照

## 最小 REST（PDCA）

- POST `/api/logs`（要 `x-api-key`）
  - body: { line_user_id: string, project_id?: number, task_id?: number, type: 'plan'|'do'|'check'|'act', note?: string }
- GET `/api/logs?line_user_id=...&project_id=...&task_id=...&limit=50`（要 `x-api-key`）
- GET `/api/projects?line_user_id=...`（要 `x-api-key`）
- GET `/api/tasks?line_user_id=...&project_id=...&status=pending`（要 `x-api-key`）

## デプロイ（参考）

- API: Render/Railway 等でデプロイし、Webhook URL を本番に設定
- フロントエンド（Next.js）は次スプリントで追加予定

## Railway へのデプロイ（推奨）

1. GitHub 連携でこのリポジトリを選択して新規 Service を作成
2. Variables（環境変数）を追加

- LINE_CHANNEL_SECRET
- LINE_CHANNEL_ACCESS_TOKEN
- PORT=3000
- TZ=Asia/Tokyo
- DATABASE_PATH=/data/data.db

3. Volumes を追加（例: Name=data, Mount Path=/data, Size=1GB）
4. スケール設定でインスタンス数を 1 に固定（Auto-scale OFF）
5. Start Command は package.json の `start`（= `node src/server.js`）が使われます
6. デプロイ完了後の URL を LINE の Webhook に設定

- https://<railway-url>/line/webhook

7. 動作確認（LINE で add / ls / done、グループで watch here）

注意:

- 無料枠ではスリープの可能性あり → 即応性が必要なら有料プランや Keep-Alive を検討
- Volume 未設定だと SQLite ファイルが消えるため、必ず /data にマウントし DATABASE_PATH を合わせる
