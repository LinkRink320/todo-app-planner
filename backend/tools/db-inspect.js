#!/usr/bin/env node
/*
 Simple DB inspector for todo-app-planner.
 Usage:
   node backend/tools/db-inspect.js [--user <LINE_USER_ID>] [--limit 20]
*/
const db = require("../db");

function getArg(name, def = undefined) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return def;
}

const user = getArg("--user", null);
const limit = Number(getArg("--limit", 20)) || 20;

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

(async () => {
  try {
    console.log("== Database quick info ==\n");
    const tables = await all(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    console.log("Tables:", tables.map((t) => t.name).join(", "));

    const taskCounts = await all(
      "SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status ORDER BY status"
    ).catch(() => []);
    console.log("\nTask counts by status:");
    if (taskCounts.length === 0) console.log("  (no tasks table or no rows)");
    for (const r of taskCounts) console.log(`  ${r.status}: ${r.cnt}`);

    const unassigned = await get(
      "SELECT COUNT(*) as cnt FROM tasks WHERE project_id IS NULL"
    ).catch(() => ({ cnt: 0 }));
    console.log(`Unassigned tasks: ${unassigned.cnt}`);

    if (user) {
      console.log(`\nProjects for user ${user}:`);
      const projects = await all(
        "SELECT id,name,status,created_at FROM projects WHERE line_user_id=? ORDER BY id DESC LIMIT ?",
        [user, 50]
      ).catch(() => []);
      for (const p of projects)
        console.log(`  [${p.id}] ${p.name} (${p.status})`);
    }

    console.log(`\nRecent tasks${user ? ` for ${user}` : ""}:`);
    const taskSql = user
      ? "SELECT id,title,deadline,status,project_id FROM tasks WHERE line_user_id=? ORDER BY id DESC LIMIT ?"
      : "SELECT id,title,deadline,status,project_id,line_user_id FROM tasks ORDER BY id DESC LIMIT ?";
    const taskParams = user ? [user, limit] : [limit];
    const tasks = await all(taskSql, taskParams).catch(() => []);
    if (tasks.length === 0) console.log("  (no rows)");
    for (const t of tasks) {
      const suffix = user ? "" : ` uid=${t.line_user_id}`;
      console.log(
        `  [${t.id}] ${t.title} | ${t.deadline} | ${t.status} | proj=${
          t.project_id ?? "null"
        }${suffix}`
      );
    }

    console.log("\nDone.");
    process.exit(0);
  } catch (e) {
    console.error("Inspector error:", e);
    process.exit(1);
  }
})();
