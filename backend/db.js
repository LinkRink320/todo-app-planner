const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const { env } = require("./config");

const dbPath = path.isAbsolute(env.DATABASE_PATH)
  ? env.DATABASE_PATH
  : path.join(process.cwd(), env.DATABASE_PATH);
const db = new sqlite3.Database(dbPath);

// Improve concurrency and reduce lock contention timeouts
db.serialize(() => {
  // Wait up to 5s if the database is busy (e.g., concurrent write)
  db.run("PRAGMA busy_timeout = 5000");
  // WAL mode for better read concurrency
  db.run("PRAGMA journal_mode = WAL");
  // Reasonable sync for server workloads
  db.run("PRAGMA synchronous = NORMAL");
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tasks(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    deadline TEXT,
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
    if (!names.has("importance"))
      alters.push("ALTER TABLE tasks ADD COLUMN importance TEXT");
    if (!names.has("sort_order"))
      alters.push("ALTER TABLE tasks ADD COLUMN sort_order INTEGER");
    if (!names.has("repeat"))
      alters.push("ALTER TABLE tasks ADD COLUMN repeat TEXT");
    if (!names.has("estimated_minutes"))
      alters.push("ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER");
    if (!names.has("soft_deadline"))
      alters.push("ALTER TABLE tasks ADD COLUMN soft_deadline TEXT");

    // If deadline column is NOT NULL, migrate to allow NULL (optional deadline)
    const deadlineCol = (cols || []).find((c) => c.name === "deadline");
    const needsDeadlineMigration =
      deadlineCol && Number(deadlineCol.notnull) === 1;

    db.serialize(() => {
      alters.forEach((sql) => db.run(sql));

      if (needsDeadlineMigration) {
        try {
          db.run("BEGIN");
          db.run(`CREATE TABLE IF NOT EXISTS tasks_new(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            line_user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            deadline TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            type TEXT NOT NULL DEFAULT 'short',
            progress INTEGER NOT NULL DEFAULT 0,
            last_progress_at TEXT,
            updated_at TEXT,
            project_id INTEGER,
            importance TEXT
          )`);
          db.run(
            `INSERT INTO tasks_new (id,line_user_id,title,deadline,status,created_at,type,progress,last_progress_at,updated_at,project_id,importance)
             SELECT id,line_user_id,title,deadline,status,created_at,COALESCE(type,'short'),COALESCE(progress,0),last_progress_at,updated_at,project_id,importance FROM tasks`
          );
          db.run("DROP TABLE tasks");
          db.run("ALTER TABLE tasks_new RENAME TO tasks");
          db.run("COMMIT");
        } catch (e) {
          try {
            db.run("ROLLBACK");
          } catch {}
          console.error("[DB MIGRATE deadline nullable ERROR]", e);
        }
      }

      db.run(
        "CREATE INDEX IF NOT EXISTS idx_tasks_user_status_deadline ON tasks(line_user_id, status, deadline)"
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_tasks_user_type ON tasks(line_user_id, type)"
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_tasks_user_project ON tasks(line_user_id, project_id)"
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_tasks_user_importance ON tasks(line_user_id, importance)"
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_tasks_user_status_sort ON tasks(line_user_id, status, sort_order)"
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_tasks_user_soft_deadline ON tasks(line_user_id, soft_deadline)"
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

  // Sub-tasks (Todos) under tasks
  db.run(`CREATE TABLE IF NOT EXISTS todos(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    estimated_minutes INTEGER,
    sort_order INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT
  )`);
  // Ensure estimated_minutes exists on todos even if created earlier
  db.all("PRAGMA table_info('todos')", (err, cols) => {
    if (err) return;
    const names = new Set((cols || []).map((c) => c.name));
    if (!names.has("estimated_minutes")) {
      db.run("ALTER TABLE todos ADD COLUMN estimated_minutes INTEGER");
    }
  });
  db.run("CREATE INDEX IF NOT EXISTS idx_todos_task ON todos(task_id)");
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_todos_task_done ON todos(task_id, done)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_todos_task_sort ON todos(task_id, sort_order)"
  );

  // Saved composite views (filters/layout presets)
  db.run(`CREATE TABLE IF NOT EXISTS saved_views(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    view_order INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT
  )`);
  // Ensure view_order exists even if table was created previously without it
  db.all("PRAGMA table_info('saved_views')", (err, cols) => {
    if (err) return; // skip indexes if pragma fails
    const names = new Set((cols || []).map((c) => c.name));
    const runIndexes = () => {
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_views_user_name ON saved_views(line_user_id, name)"
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_views_user_order ON saved_views(line_user_id, view_order)"
      );
    };
    if (!names.has("view_order")) {
      db.run("ALTER TABLE saved_views ADD COLUMN view_order INTEGER", (e) => {
        if (e) return; // cannot add, skip indexes that use it
        runIndexes();
      });
    } else {
      runIndexes();
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    project_id INTEGER,
    task_id INTEGER,
    type TEXT NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // Daily Plans and Items
  db.run(`CREATE TABLE IF NOT EXISTS plans(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT
  )`);
  db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_user_date ON plans(line_user_id, date)"
  );

  db.run(`CREATE TABLE IF NOT EXISTS plan_items(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    task_id INTEGER,
    todo_id INTEGER,
    order_index INTEGER,
    planned_minutes INTEGER,
    block TEXT, -- 'morning' | 'afternoon' | 'evening'
    rocket INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT
  )`);
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_plan_items_plan_order ON plan_items(plan_id, order_index)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_plan_items_plan_block ON plan_items(plan_id, block)"
  );
  // Ensure todo_id exists for older tables, then create related index
  db.all("PRAGMA table_info('plan_items')", (err, cols) => {
    if (err) return;
    const names = new Set((cols || []).map((c) => c.name));
    const createIdx = () =>
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_plan_items_plan_todo ON plan_items(plan_id, todo_id)"
      );
    if (!names.has("todo_id")) {
      db.run("ALTER TABLE plan_items ADD COLUMN todo_id INTEGER", (e) => {
        if (e) return; // If cannot add, skip index creation silently
        createIdx();
      });
    } else {
      createIdx();
    }
  });
});

module.exports = db;
