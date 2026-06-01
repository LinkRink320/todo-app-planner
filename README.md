# Todo Planner（LINE + React + SQLite）

LINE で「追加・一覧・完了」ができ、締切超過を自動検知して本人＋監視グループに通知する ToDo アプリです。
短期タスク・長期目標・プロジェクト管理に加え、繰り返しタスク（習慣）・時間計測・生産性分析・PDCA ログ・デイリープランまで対応した React フロントエンド付きの構成になっています。

## スタック

**バックエンド**
- Node.js + Express 5
- @line/bot-sdk（Messaging API）
- sqlite3（ローカル DB）
- node-cron（締切チェック・リマインド）

**フロントエンド**
- React 18 + React Router v6
- Vite（ビルドツール）

**開発・デプロイ**
- Docker + Docker Compose
- VPS（ConoHa等）+ Nginx + Let's Encrypt

## ディレクトリ構成

```
todo-app-planner/
├── backend/
│   ├── server.js          # エントリポイント・cron 設定
│   ├── commands.js        # LINE コマンドパーサー
│   ├── db.js              # DB 初期化・マイグレーション
│   ├── config.js          # 環境変数管理
│   ├── routes/
│   │   ├── api.js         # REST API（タスク・プロジェクト・Todos・プラン・習慣・ビュー）
│   │   ├── line.js        # LINE Webhook ハンドラ
│   │   ├── analytics.js   # 生産性分析 API（完了率・パターン・AI振り返り）
│   │   └── timeTracking.js # 時間計測 API
│   └── utils/
│       ├── aiReflection.js # AI 振り返り生成（OpenAI / Anthropic / Gemini）
│       └── recurring.js    # 繰り返しタスクの次期締切計算
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── App.jsx    # メインアプリ（タスク・ビュー切替）
│       │   └── Login.jsx  # ログイン画面
│       └── components/
│           ├── Board.jsx          # カンバンボード
│           ├── Calendar.jsx       # カレンダービュー
│           ├── Week.jsx           # 週間ビュー
│           ├── Timeline.jsx       # タイムラインビュー
│           ├── Todos.jsx          # サブタスク（チェックリスト）
│           ├── Plan.jsx           # デイリープラン
│           ├── Habits.jsx         # 習慣トラッカー
│           ├── ProductivityAnalytics.jsx # 生産性分析ダッシュボード
│           └── ProjectAnalytics.jsx      # プロジェクト分析
└── legacy/                # 旧実装（参照用）
```

## データスキーマ

| テーブル | 主なカラム |
|---------|-----------|
| tasks | id, line_user_id, title, deadline, soft_deadline, status（pending\|done\|failed）, type（short\|long）, progress, repeat, importance（high\|medium\|low）, estimated_minutes, sort_order, url, details_md |
| todos | id, task_id, title, done, estimated_minutes, sort_order, url, details_md |
| groups | id, group_id, owner_line_user_id |
| projects | id, line_user_id, name, status（active\|archived）, goal, description |
| saved_views | id, line_user_id, name, payload, view_order |
| plans | id, line_user_id, date（UNIQUE per user）|
| plan_items | id, plan_id, task_id, sort_order |
| time_entries | id, line_user_id, task_id, start_time, end_time, duration_minutes |
| logs | id, line_user_id, project_id, task_id, type（plan\|do\|check\|act）, note |

## LINE コマンド

### 短期タスク
```
add 2025-08-12 23:00 レポート仕上げ   # 締切あり
add レポート仕上げ                     # 締切なしでも登録可
ls                                     # 一覧表示
done 3                                 # ID=3 を完了
```

### 長期目標
```
addl 2025-12-31 23:59 英語B2    # 長期目標追加（初期 progress=0%）
lsl                              # 長期目標一覧（最新更新順）
prog 10 45%                      # ID=10 の進捗を 45% に更新
```

### プロジェクト
```
padd 新規事業A                             # プロジェクト追加
pls                                        # プロジェクト一覧
addp 3 2025-09-01 09:00 企画書ドラフト     # プロジェクト配下にタスク追加
lsp 3                                      # プロジェクト配下のタスク一覧
```

### その他
```
watch here    # グループ内で実行 → 監視グループとして登録
whoami        # 自分の LINE User ID を確認（myid / id でも可）
url           # Web UI の URL を取得
help          # コマンド一覧を表示
```

## Web UI（React）の機能

ログイン後（`/app`）から以下のビューに切り替えられます。

| ビュー | 説明 |
|--------|------|
| リスト | タスク一覧・フィルタ・ドラッグ並び替え |
| カンバン | ステータス別ボード（Board.jsx） |
| カレンダー | 月間カレンダー表示 |
| 週間 | 週次タスク管理 |
| タイムライン | 時系列タスク表示 |
| プラン | デイリープラン作成・編集 |
| 習慣 | 繰り返しタスクのチェック状況 |
| 分析（プロジェクト） | 完了率・週次メトリクス |
| 分析（生産性） | 完了率推移・生産性パターン・AI 振り返り |

## 通知・自動処理（cron）

| タイミング | 内容 |
|-----------|------|
| 毎分 | 締切超過タスクを `failed` に更新し、本人と監視グループに Push 通知 |
| 締切 30 分前 / 5 分前 | 短期タスクのリマインド通知（本人のみ） |
| 翌朝（デフォルト 08:00） | 前日未達タスクに削除/延期の確認メッセージ送信 |
| 毎朝（デフォルト 08:30） | 当日タスクのサマリー通知 |
| 毎晩（デフォルト 21:00） | 翌日タスクの計画リマインド通知 |

未達タスクへの返信選択肢：「削除する」「延期: 明日 9 時」「延期: 次営業日 9 時」

## セットアップ

### ローカル開発（Docker）

1. 環境変数を設定

```bash
cp .env.example .env
# .env に必要な値を設定
```

2. Docker で起動

```bash
docker compose up --build -d
```

3. ブラウザで `http://localhost:3000` を開く

> **注意**: ローカルでは LINE Webhook は使えません。本番デプロイ後に設定してください。

### 本番デプロイ（VPS + Docker + Nginx）

1. VPS（Ubuntu 22.04）に Docker をインストール

```bash
apt update && apt install -y ca-certificates curl && \
install -m 0755 -d /etc/apt/keyrings && \
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc && \
chmod a+r /etc/apt/keyrings/docker.asc && \
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

2. リポジトリをクローンして `.env` を作成

```bash
git clone https://github.com/LinkRink320/todo-app-planner.git /opt/todo-app
cd /opt/todo-app
nano .env
```

3. 起動

```bash
docker compose up --build -d
```

4. Nginx + Let's Encrypt で HTTPS 化

```bash
apt install -y nginx certbot python3-certbot-nginx
ufw allow 'Nginx Full'
```

`/etc/nginx/sites-available/todo-app` を作成：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/todo-app /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d your-domain.com
```

5. LINE Developers コンソールで Webhook URL を設定

```
https://your-domain.com/line/webhook
```

## 動作確認の流れ

1. 個チャで `add 2025-08-12 23:00 テスト` → 「登録 OK」返信
2. `ls` → タスク一覧を確認
3. `done 1` → 完了
4. Bot をグループに招待して `watch here` → 監視グループ登録
5. 期限超過 → `pending → failed` に更新され、本人と監視グループに Push 通知が届く
6. ブラウザで `https://<ドメイン>/login` → API_KEY・LINE User ID を入力 → `/app` でフル機能の Web UI を利用

## 環境変数

### 必須

| 変数名 | 説明 |
|--------|------|
| LINE_CHANNEL_SECRET | LINE チャンネルシークレット |
| LINE_CHANNEL_ACCESS_TOKEN | LINE チャンネルアクセストークン |

### オプション

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| PORT | 3000 | サーバーポート |
| DATABASE_PATH | ./data.db | SQLite ファイルパス |
| TZ | 未設定 | クラウド環境では `Asia/Tokyo` を推奨 |
| API_KEY | なし | REST API / Web UI 認証キー（未設定時は API 無効） |
| DEFAULT_LINE_USER_ID | なし | Web UI ログイン画面の初期入力値 |
| MORNING_SUMMARY_CRON | `30 8 * * *` | 朝のサマリー cron |
| MORNING_DELETE_CONFIRM_CRON | `0 8 * * *` | 前日未達の確認 cron |
| EVENING_PLAN_REMINDER_CRON | `0 21 * * *` | 夜の計画リマインド cron |

## REST API

すべてのエンドポイントに `x-api-key` ヘッダーが必要です。

### タスク

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/tasks` | タスク一覧（`line_user_id`, `project_id`, `status`, `importance` でフィルタ可） |
| POST | `/api/tasks` | タスク作成（`repeat` で繰り返し設定可: `daily` / `weekdays` / `weekly` / `monthly`） |
| PATCH | `/api/tasks/:id` | タスク更新（`soft_deadline`, `importance`, `sort_order` 等） |
| DELETE | `/api/tasks/:id` | タスク削除 |
| POST | `/api/tasks/reorder` | ドラッグ並び替え |

### サブタスク（Todos）

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/todos` | サブタスク一覧 |
| GET | `/api/todos/by-user` | ユーザー単位で全サブタスク取得 |
| POST | `/api/todos` | サブタスク作成 |
| PATCH | `/api/todos/:id` | サブタスク更新 |
| DELETE | `/api/todos/:id` | サブタスク削除 |
| POST | `/api/todos/reorder` | 並び替え |

### プロジェクト

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/projects` | プロジェクト一覧 |
| POST | `/api/projects` | プロジェクト作成 |
| PATCH | `/api/projects/:id` | プロジェクト更新 |
| GET | `/api/projects/:id/overview` | プロジェクト概要（タスク数・完了率など） |
| GET | `/api/projects/:id/weekly-metrics` | 週次メトリクス |

### デイリープラン

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/plans` | プラン一覧 |
| POST | `/api/plans` | プラン作成 |
| POST | `/api/plans/:id/items` | プランにタスク追加 |
| PATCH | `/api/plans/:id/items/:itemId` | プランアイテム更新 |
| DELETE | `/api/plans/:id/items/:itemId` | プランアイテム削除 |
| POST | `/api/plans/:id/items/reorder` | プランアイテム並び替え |

### 習慣（繰り返しタスク）

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/habits` | 繰り返しタスクの達成状況一覧（`repeats`, `days` でフィルタ） |

### 時間計測

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/time-tracking` | 計測履歴一覧 |
| GET | `/api/time-tracking/active` | 計測中のエントリ取得 |
| POST | `/api/time-tracking` | 計測開始 |
| PATCH | `/api/time-tracking` | 計測更新 |
| POST | `/api/time-tracking/stop` | 計測停止 |
| DELETE | `/api/time-tracking/:id` | 計測履歴削除 |

### 分析

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/analytics/completion-rate` | 日別完了率推移 |
| GET | `/api/analytics/productivity-patterns` | 生産性パターン分析 |
| GET | `/api/analytics/estimation-accuracy` | 見積もり精度 |
| GET | `/api/analytics/project-progress` | プロジェクト別進捗 |
| GET | `/api/analytics/daily-reflection` | デイリー振り返り |
| POST | `/api/analytics/ai-reflection` | AI 振り返り生成 |

### PDCA ログ

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/logs` | ログ記録（type: `plan`\|`do`\|`check`\|`act`） |
| GET | `/api/logs` | ログ一覧 |

### ビュー（保存済みフィルタ）

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/views` | ビュー一覧 |
| POST | `/api/views` | ビュー保存 |
| PATCH | `/api/views/:id` | ビュー更新 |
| DELETE | `/api/views/:id` | ビュー削除 |
| POST | `/api/views/reorder` | ビュー並び替え |

### その他

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/line-profile` | LINE displayName 取得 |
| GET | `/api/config` | フロントエンド初期化用の公開設定 |
| GET | `/` | ヘルスチェック（`ok` を返す） |

## 環境変数（docker-compose.yml）

`DATABASE_PATH` と `TZ` は `docker-compose.yml` の `environment` に設定済みです。その他は `.env` で管理してください。

## 注意点（割り切り）

- 日時フォーマットは `YYYY-MM-DD HH:mm` のみ（ローカル時刻）
- 監視グループは「ユーザー 1 ↔ グループ 1」を想定（最新登録を採用）
- 締切チェックは毎分実行（秒単位の精度は保証しない）
- 再起動直後などにリマインドが重複して届く場合がある
