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

  // 監視用グループ（1ユーザー:1グループを想定・最新を採用）
  db.run(`CREATE TABLE IF NOT EXISTS groups(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    owner_line_user_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
});
module.exports = db;
