const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const { env } = require("./config");

const dbPath = path.isAbsolute(env.DATABASE_PATH)
  ? env.DATABASE_PATH
  : path.join(process.cwd(), env.DATABASE_PATH);
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tasks(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    deadline TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

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

    db.serialize(() => {
      alters.forEach((sql) => db.run(sql));
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_tasks_user_status_deadline ON tasks(line_user_id, status, deadline)"
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_tasks_user_type ON tasks(line_user_id, type)"
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_tasks_user_project ON tasks(line_user_id, project_id)"
      );
    });
  });

  db.run(`CREATE TABLE IF NOT EXISTS groups(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    owner_line_user_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS projects(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT
  )`);
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(line_user_id)"
  );

  db.run(`CREATE TABLE IF NOT EXISTS logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    project_id INTEGER,
    task_id INTEGER,
    type TEXT NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
});

module.exports = db;
