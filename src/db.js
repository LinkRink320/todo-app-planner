const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database(process.env.DATABASE_PATH || "./data.db");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tasks(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    deadline TEXT NOT NULL,              -- "YYYY-MM-DD HH:mm"
    status TEXT NOT NULL DEFAULT 'pending', -- pending|done|failed
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── 軽量マイグレーション（既存テーブルに列が無ければ追加）＋依存インデックス
  db.all("PRAGMA table_info('tasks')", (err, cols) => {
    if (err) return;
    const names = new Set((cols || []).map((c) => c.name));
    const alters = [];
    if (!names.has("type"))
      alters.push(
        "ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'short'"
      );
    if (!names.has("progress"))
      alters.push(
        "ALTER TABLE tasks ADD COLUMN progress INTEGER NOT NULL DEFAULT 0"
      );
    if (!names.has("last_progress_at"))
      alters.push("ALTER TABLE tasks ADD COLUMN last_progress_at TEXT");
    if (!names.has("updated_at"))
      alters.push("ALTER TABLE tasks ADD COLUMN updated_at TEXT");
    if (!names.has("project_id"))
      alters.push("ALTER TABLE tasks ADD COLUMN project_id INTEGER");

    // 順序を保証して適用
    db.serialize(() => {
      alters.forEach((sql) => db.run(sql));
      // よく使う検索のインデックス（既存列のみ）
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_tasks_user_status_deadline ON tasks(line_user_id, status, deadline)"
      );
      // 依存インデックス（列が追加済みである前提）
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_tasks_user_type ON tasks(line_user_id, type)"
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_tasks_user_project ON tasks(line_user_id, project_id)"
      );
    });
  });

  // 監視用グループ（1ユーザー:1グループを想定・最新を採用）
  db.run(`CREATE TABLE IF NOT EXISTS groups(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    owner_line_user_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // プロジェクト: 長期目標の器（ユーザー所有）
  db.run(`CREATE TABLE IF NOT EXISTS projects(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- active|archived
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT
  )`);

  // 参照・一覧用インデックス
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(line_user_id)"
  );

  // PDCA ログ（任意で task / project 紐付け）
  db.run(`CREATE TABLE IF NOT EXISTS logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    project_id INTEGER,
    task_id INTEGER,
    type TEXT NOT NULL,                 -- plan|do|check|act
    note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
});
module.exports = db;
