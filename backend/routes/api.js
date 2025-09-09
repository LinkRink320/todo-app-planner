const express = require("express");
const { Client } = require("@line/bot-sdk");
const db = require("../db");
const { env, line } = require("../config");
const { handleRecurringTaskCreation } = require("../utils/recurring");

const router = express.Router();
const client = new Client(line);

// Ensure saved_views.view_order column exists to avoid race with startup migrations
function ensureViewOrderColumn(cb) {
  try {
    db.all("PRAGMA table_info('saved_views')", (err, cols) => {
      if (err) return cb && cb();
      const names = new Set((cols || []).map((c) => c.name));
      if (names.has("view_order")) return cb && cb();
      db.run(
        "ALTER TABLE saved_views ADD COLUMN view_order INTEGER",
        () => cb && cb()
      );
    });
  } catch {
    cb && cb();
  }
}

router.use((req, res, next) => {
  const k = req.headers["x-api-key"];
  if (!env.API_KEY) return res.status(403).json({ error: "API disabled" });
  if (k !== env.API_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
});

router.post("/logs", (req, res) => {
  const { line_user_id, project_id, task_id, type, note } = req.body || {};
  if (!line_user_id || !type)
    return res.status(400).json({ error: "line_user_id and type required" });
  if (!["plan", "do", "check", "act"].includes(String(type)))
    return res.status(400).json({ error: "invalid type" });
  db.run(
    "INSERT INTO logs(line_user_id,project_id,task_id,type,note) VALUES (?,?,?,?,?)",
    [
      line_user_id,
      project_id || null,
      task_id || null,
      String(type),
      note || null,
    ],
    function (err) {
      if (err)
        return res.status(500).json({ error: "db", detail: String(err) });
      res.json({ id: this?.lastID });
    }
  );
});

router.get("/logs", (req, res) => {
  const { line_user_id, project_id, task_id, limit = 50 } = req.query;
  const conds = [];
  const args = [];
  if (line_user_id) {
    conds.push("line_user_id=?");
    args.push(line_user_id);
  }
  if (project_id) {
    conds.push("project_id=?");
    args.push(project_id);
  }
  if (task_id) {
    conds.push("task_id=?");
    args.push(task_id);
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  db.all(
    `SELECT * FROM logs ${where} ORDER BY id DESC LIMIT ?`,
    [...args, Number(limit) || 50],
    (err, rows) => {
      if (err)
        return res.status(500).json({ error: "db", detail: String(err) });
      res.json(rows || []);
    }
  );
});

router.get("/projects", (req, res) => {
  const { line_user_id } = req.query;
  if (!line_user_id)
    return res.status(400).json({ error: "line_user_id required" });
  db.all(
    "SELECT id,name,status,goal,description,created_at,updated_at FROM projects WHERE line_user_id=? AND status='active' ORDER BY id DESC",
    [line_user_id],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db", detail: String(e) });
      res.json(rows || []);
    }
  );
});

router.post("/projects", (req, res) => {
  const { line_user_id, name, goal, description } = req.body || {};
  if (!line_user_id || !name)
    return res.status(400).json({ error: "line_user_id and name required" });
  db.run(
    "INSERT INTO projects(line_user_id,name,goal,description) VALUES(?,?,?,?)",
    [line_user_id, name, goal || null, description || null],
    function (err) {
      if (err)
        return res.status(500).json({ error: "db", detail: String(err) });
      res.json({ id: this?.lastID, name });
    }
  );
});

// Update project (name, goal, description, status)
router.patch("/projects/:id", (req, res) => {
  const { id } = req.params;
  const { name, goal, description, status } = req.body || {};
  const sets = [];
  const args = [];
  if (typeof name !== "undefined") {
    if (!String(name).trim())
      return res.status(400).json({ error: "name cannot be empty" });
    sets.push("name=?");
    args.push(String(name));
  }
  if (typeof goal !== "undefined") {
    sets.push("goal=?");
    args.push(goal ? String(goal) : null);
  }
  if (typeof description !== "undefined") {
    sets.push("description=?");
    args.push(description ? String(description) : null);
  }
  if (typeof status !== "undefined") {
    const s = String(status);
    if (!["active", "archived"].includes(s))
      return res.status(400).json({ error: "invalid status" });
    sets.push("status=?");
    args.push(s);
  }
  if (!sets.length)
    return res.status(400).json({ error: "no fields to update" });
  const sql = `UPDATE projects SET ${sets.join(
    ", "
  )}, updated_at=datetime('now','localtime') WHERE id=?`;
  db.run(sql, [...args, id], function (err) {
    if (err) return res.status(500).json({ error: "db", detail: String(err) });
    res.json({ updated: this?.changes || 0 });
  });
});

// --- Project Analytics ---
// Overview KPIs at current time
router.get("/projects/:id/overview", (req, res) => {
  const { id } = req.params;
  db.all(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
            SUM(COALESCE(estimated_minutes,0)) AS est_total,
            SUM(CASE WHEN status='done' THEN COALESCE(estimated_minutes,0) ELSE 0 END) AS est_done
     FROM tasks WHERE project_id=?`,
    [id],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db", detail: String(e) });
      const r = rows && rows[0];
      const total = Number(r?.total || 0);
      const estTotal = Number(r?.est_total || 0);
      const estDone = Number(r?.est_done || 0);
      // Fallback: if no estimates, use count ratio
      const pct =
        estTotal > 0
          ? Math.round((estDone / estTotal) * 100)
          : total > 0
          ? Math.round((Number(r?.done || 0) / total) * 100)
          : 0;
      res.json({
        total,
        pending: Number(r?.pending || 0),
        done: Number(r?.done || 0),
        est_total: estTotal,
        est_done: estDone,
        progress_percent: pct,
      });
    }
  );
});

// Weekly metrics time series for a project
router.get("/projects/:id/weekly-metrics", (req, res) => {
  const { id } = req.params;
  const weeks = Math.min(
    Math.max(parseInt(req.query.weeks || "12", 10), 1),
    52
  );
  // compute Monday as week start (local time). TZ relies on SQLite localtime
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const toDateStr = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const weekday = now.getDay(); // 0=Sun..6=Sat
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - ((weekday + 6) % 7)
  );
  const starts = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() - i * 7
    );
    starts.push(toDateStr(d));
  }
  const endDates = starts.map((s) => {
    const d = new Date(s + "T00:00:00");
    d.setDate(d.getDate() + 7);
    return toDateStr(d);
  });
  // Pre-fetch denominator (project estimates total) once
  db.get(
    `SELECT SUM(COALESCE(estimated_minutes,0)) AS est_total, COUNT(*) AS total
     FROM tasks WHERE project_id=?`,
    [id],
    (e0, base) => {
      if (e0) return res.status(500).json({ error: "db", detail: String(e0) });
      const estTotal = Number(base?.est_total || 0);
      const totalCount = Number(base?.total || 0);
      const placeholders = starts.map(() => "(?, ?, ?)").join(",");
      const params = [];
      for (let i = 0; i < starts.length; i++) {
        params.push(id, starts[i], endDates[i]);
      }
      // Aggregate per-week done metrics
      const sql = `
        WITH ranges(project_id, start_d, end_d) AS (
          VALUES ${placeholders}
        )
        SELECT r.start_d AS week_start,
               COUNT(t.id) AS completed_count,
               SUM(COALESCE(t.estimated_minutes,0)) AS completed_estimated_minutes
        FROM ranges r
        LEFT JOIN tasks t ON t.project_id=r.project_id AND t.done_at >= r.start_d AND t.done_at < r.end_d
        GROUP BY r.start_d
        ORDER BY r.start_d`;
      db.all(sql, params, (e1, rows) => {
        if (e1)
          return res.status(500).json({ error: "db", detail: String(e1) });
        // Build cumulative progress percent per week (using estimates if available else count ratio)
        let cumEstDone = 0;
        let cumCountDone = 0;
        const out = (rows || []).map((r) => {
          const cnt = Number(r.completed_count || 0);
          const est = Number(r.completed_estimated_minutes || 0);
          cumEstDone += est;
          cumCountDone += cnt;
          const pct =
            estTotal > 0
              ? Math.round((cumEstDone / estTotal) * 100)
              : totalCount > 0
              ? Math.round((cumCountDone / totalCount) * 100)
              : 0;
          return {
            week_start: r.week_start,
            completed_count: cnt,
            completed_estimated_minutes: est,
            cumulative_progress_percent: pct,
          };
        });
        res.json(out);
      });
    }
  );
});

// --- Habits (repeating daily/weekday tasks) API ---
router.get("/habits", (req, res) => {
  const { line_user_id, repeats = "daily,weekdays", days = 14 } = req.query;
  if (!line_user_id)
    return res.status(400).json({ error: "line_user_id required" });
  const reps = String(repeats)
    .split(",")
    .map((x) => x.trim())
    .filter((x) => ["daily", "weekdays"].includes(x));
  if (!reps.length) return res.status(400).json({ error: "invalid repeats" });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const toDateStr = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = toDateStr(now);
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (Math.max(parseInt(days || 14, 10), 1) - 1)
  );
  const startStr = toDateStr(start);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const endStr = toDateStr(end);
  const dateAxis = [];
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    dateAxis.push(toDateStr(d));
  }
  const ph = reps.map(() => "?").join(",");
  // Fetch repeating tasks for user
  db.all(
    `SELECT id,title,repeat,project_id,importance,estimated_minutes,url,details_md,deadline,status,updated_at
     FROM tasks WHERE line_user_id=? AND repeat IN (${ph})`,
    [line_user_id, ...reps],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db", detail: String(e) });
      const all = rows || [];
      // Group by project_id|repeat|title
      const keyOf = (t) => `${t.project_id || "none"}|${t.repeat}|${t.title}`;
      const groups = new Map();
      for (const t of all) {
        const k = keyOf(t);
        const g = groups.get(k) || { items: [], rep: t };
        g.items.push(t);
        // rep: prefer a pending item if any, else latest updated
        const better = () => {
          if (g.rep.status !== "pending" && t.status === "pending") return true;
          const a = Date.parse((g.rep.updated_at || "").replace(" ", "T")) || 0;
          const b = Date.parse((t.updated_at || "").replace(" ", "T")) || 0;
          return b > a;
        };
        if (!g.rep || better()) g.rep = t;
        groups.set(k, g);
      }
      // Fetch done marks in range for these repeats
      db.all(
        `SELECT title,repeat,project_id,substr(done_at,1,10) AS day
         FROM tasks
         WHERE line_user_id=? AND repeat IN (${ph}) AND done_at >= ? AND done_at < ?`,
        [line_user_id, ...reps, startStr, endStr],
        (e2, doneRows) => {
          if (e2)
            return res.status(500).json({ error: "db", detail: String(e2) });
          const marks = new Map(); // key -> Set(days)
          for (const r of doneRows || []) {
            const k = `${r.project_id || "none"}|${r.repeat}|${r.title}`;
            if (!marks.has(k)) marks.set(k, new Set());
            marks.get(k).add(r.day);
          }
          const out = [];
          for (const [k, g] of groups.entries()) {
            const rep = g.rep;
            const daysArr = dateAxis.map((d) => ({ date: d, done: false }));
            const set = marks.get(k);
            if (set) {
              for (const dd of daysArr) dd.done = set.has(dd.date);
            }
            // compute current streak ending today
            let streak = 0;
            for (let i = daysArr.length - 1; i >= 0; i--) {
              if (!daysArr[i].done) break;
              streak++;
            }
            out.push({
              key: k,
              title: rep.title,
              repeat: rep.repeat,
              project_id: rep.project_id || null,
              task_id: rep.id,
              importance: rep.importance || null,
              estimated_minutes: rep.estimated_minutes || null,
              url: rep.url || null,
              details_md: rep.details_md || null,
              deadline: rep.deadline || null,
              status: rep.status,
              recent: daysArr,
              streak,
            });
          }
          // sort by repeat then title
          out.sort((a, b) =>
            a.repeat === b.repeat
              ? a.title.localeCompare(b.title)
              : a.repeat.localeCompare(b.repeat)
          );
          res.json(out);
        }
      );
    }
  );
});

// Delete a task (scoped to user)
router.delete("/tasks/:id", (req, res) => {
  const { id } = req.params;
  const { line_user_id } = req.query;
  if (!line_user_id)
    return res.status(400).json({ error: "line_user_id required" });
  db.run(
    "DELETE FROM tasks WHERE id=? AND line_user_id=?",
    [id, line_user_id],
    function (err) {
      if (err)
        return res.status(500).json({ error: "db", detail: String(err) });
      res.json({ deleted: this?.changes || 0 });
    }
  );
});

router.get("/tasks", (req, res) => {
  const {
    line_user_id,
    project_id,
    status = "pending",
    limit,
    q,
    importance,
    deadline_from,
    deadline_to,
    with_todo_counts,
  } = req.query;
  if (!line_user_id)
    return res.status(400).json({ error: "line_user_id required" });
  const conds = ["line_user_id=?"];
  const args = [line_user_id];
  if (typeof project_id !== "undefined") {
    if (project_id === "none") {
      conds.push("project_id IS NULL");
    } else if (String(project_id).length) {
      conds.push("project_id=?");
      args.push(project_id);
    }
  }
  if (status && status !== "all") {
    conds.push("status=?");
    args.push(status);
  }
  if (q && String(q).trim()) {
    conds.push("title LIKE ?");
    args.push(`%${String(q).trim()}%`);
  }
  if (importance && ["high", "medium", "low"].includes(String(importance))) {
    conds.push("importance=?");
    args.push(String(importance));
  }
  if (deadline_from) {
    conds.push("deadline >= ?");
    args.push(String(deadline_from));
  }
  if (deadline_to) {
    conds.push("deadline <= ?");
    args.push(String(deadline_to));
  }
  const where = "WHERE " + conds.join(" AND ");
  const lim = Math.min(Math.max(parseInt(limit || 200, 10) || 200, 1), 1000);
  db.all(
    `SELECT id,title,deadline,soft_deadline,status,project_id,type,progress,importance,sort_order,repeat,estimated_minutes,url,details_md FROM tasks ${where} ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC LIMIT ?`,
    [...args, lim],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db", detail: String(e) });
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      let list = (rows || []).map((r) => {
        let urgency = "low"; // default
        if (r.deadline) {
          const t = Date.parse(r.deadline.replace(" ", "T"));
          if (!Number.isNaN(t)) {
            const diffDays = (t - now) / dayMs;
            if (diffDays <= 3) urgency = "high";
            else if (diffDays <= 7) urgency = "medium";
            else urgency = "low";
          }
        } else {
          urgency = "low";
        }
        return { ...r, urgency };
      });
      const needsCounts =
        String(with_todo_counts || "").toLowerCase() === "true";
      if (!needsCounts || list.length === 0) return res.json(list);
      const ids = list.map((x) => x.id);
      const ph = ids.map(() => "?").join(",");
      db.all(
        `SELECT task_id, SUM(CASE WHEN done=1 THEN 1 ELSE 0 END) AS done_count, COUNT(*) AS total_count FROM todos WHERE task_id IN (${ph}) GROUP BY task_id`,
        ids,
        (e2, counts) => {
          if (!e2 && Array.isArray(counts)) {
            const map = new Map(counts.map((c) => [c.task_id, c]));
            list = list.map((t) => ({
              ...t,
              todos_done: map.get(t.id)?.done_count || 0,
              todos_total: map.get(t.id)?.total_count || 0,
            }));
          }
          res.json(list);
        }
      );
    }
  );
});

router.post("/tasks", (req, res) => {
  const {
    line_user_id,
    title,
    deadline,
    project_id,
    importance,
    repeat,
    estimated_minutes,
    soft_deadline,
    url,
    details_md,
  } = req.body || {};
  if (!line_user_id || !title)
    return res.status(400).json({ error: "line_user_id and title required" });
  if (!deadline && !soft_deadline)
    return res
      .status(400)
      .json({ error: "deadline or soft_deadline required" });
  let imp = null;
  if (importance) {
    const v = String(importance).toLowerCase();
    if (["high", "medium", "low"].includes(v)) imp = v;
    else return res.status(400).json({ error: "invalid importance" });
  }
  const rep = repeat ? String(repeat) : null;
  const est = Number.isFinite(Number(estimated_minutes))
    ? Number(estimated_minutes)
    : null;
  db.run(
    "INSERT INTO tasks(line_user_id,title,deadline,soft_deadline,project_id,importance,repeat,estimated_minutes,url,details_md) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      line_user_id,
      title,
      deadline || null,
      soft_deadline || null,
      project_id || null,
      imp,
      rep,
      est,
      url || null,
      details_md || null,
    ],
    function (err) {
      if (err)
        return res.status(500).json({ error: "db", detail: String(err) });
      res.json({ id: this?.lastID });
    }
  );
});

router.patch("/tasks/:id", (req, res) => {
  const { id } = req.params;
  const {
    title,
    deadline,
    soft_deadline,
    project_id,
    importance,
    status,
    repeat,
    sort_order,
    estimated_minutes,
    url,
    details_md,
  } = req.body || {};

  const sets = [];
  const args = [];

  if (typeof title !== "undefined") {
    if (!String(title).trim())
      return res.status(400).json({ error: "title cannot be empty" });
    sets.push("title=?");
    args.push(String(title));
  }
  if (typeof deadline !== "undefined") {
    // allow null/empty to clear deadline
    const d = deadline ? String(deadline) : null;
    sets.push("deadline=?");
    args.push(d);
  }
  if (typeof project_id !== "undefined") {
    const p =
      project_id === null || project_id === "none"
        ? null
        : Number(project_id) || null;
    sets.push("project_id=?");
    args.push(p);
  }
  if (typeof soft_deadline !== "undefined") {
    const sd = soft_deadline ? String(soft_deadline) : null;
    sets.push("soft_deadline=?");
    args.push(sd);
  }
  if (typeof importance !== "undefined") {
    let imp = null;
    if (importance) {
      const v = String(importance).toLowerCase();
      if (!["high", "medium", "low"].includes(v))
        return res.status(400).json({ error: "invalid importance" });
      imp = v;
    }
    sets.push("importance=?");
    args.push(imp);
  }
  if (typeof repeat !== "undefined") {
    const rep = repeat ? String(repeat) : null;
    sets.push("repeat=?");
    args.push(rep);
  }
  if (typeof sort_order !== "undefined") {
    const so = Number.isFinite(Number(sort_order)) ? Number(sort_order) : null;
    sets.push("sort_order=?");
    args.push(so);
  }
  if (typeof estimated_minutes !== "undefined") {
    const est = Number.isFinite(Number(estimated_minutes))
      ? Number(estimated_minutes)
      : null;
    sets.push("estimated_minutes=?");
    args.push(est);
  }
  if (typeof url !== "undefined") {
    sets.push("url=?");
    args.push(url ? String(url) : null);
  }
  if (typeof details_md !== "undefined") {
    sets.push("details_md=?");
    args.push(details_md ? String(details_md) : null);
  }
  if (typeof status !== "undefined") {
    const s = String(status);
    if (!["pending", "done", "failed"].includes(s))
      return res.status(400).json({ error: "invalid status" });
    sets.push("status=?");
    args.push(s);
    if (s === "done") {
      sets.push("done_at=datetime('now','localtime')");
    } else {
      sets.push("done_at=NULL");
    }
  }

  if (!sets.length)
    return res.status(400).json({ error: "no fields to update" });

  // always bump updated_at
  const sql = `UPDATE tasks SET ${sets.join(
    ", "
  )}, updated_at=datetime('now','localtime') WHERE id=?`;
  db.run(sql, [...args, id], function (err) {
    if (err) return res.status(500).json({ error: "db", detail: String(err) });
    const updated = this?.changes || 0;
    // If marked done and task has repeat and deadline, create next occurrence
    if (updated && typeof status !== "undefined" && String(status) === "done") {
      db.get("SELECT * FROM tasks WHERE id=?", [id], async (gErr, row) => {
        if (gErr || !row) return res.json({ updated });
        const rep = row.repeat ? String(row.repeat) : null;
        if (!rep || !row.deadline) return res.json({ updated });

        try {
          const result = await handleRecurringTaskCreation(id, row);
          if (result.success) {
            return res.json({
              updated,
              repeated: true,
              copied_todos: result.copied_todos || 0,
              next_task_id: result.taskId,
            });
          } else {
            return res.json({
              updated,
              repeated: false,
              reason: result.reason,
            });
          }
        } catch (e) {
          console.error("[RECURRING task creation ERROR]", e);
          return res.json({ updated, repeated: false, error: e.message });
        }
      });
    } else {
      res.json({ updated });
    }
  });
});

function calcNextDeadline(deadline, rep) {
  // deadline: "YYYY-MM-DD HH:mm"
  const iso = deadline.replace(" ", "T");
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const copy = new Date(d.getTime());
  const pad = (n) => String(n).padStart(2, "0");
  const toStr = (dt) =>
    `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(
      dt.getHours()
    )}:${pad(dt.getMinutes())}`;
  switch (rep) {
    case "daily":
      copy.setDate(copy.getDate() + 1);
      return toStr(copy);
    case "weekdays": {
      // next business day (Mon-Fri)
      do {
        copy.setDate(copy.getDate() + 1);
      } while ([0, 6].includes(copy.getDay()));
      return toStr(copy);
    }
    case "weekly":
      copy.setDate(copy.getDate() + 7);
      return toStr(copy);
    case "monthly":
      copy.setMonth(copy.getMonth() + 1);
      return toStr(copy);
    default:
      return null;
  }
}

// Reorder tasks within a status column
router.post("/tasks/reorder", (req, res) => {
  const { line_user_id, status, orderedIds } = req.body || {};
  if (!line_user_id || !status || !Array.isArray(orderedIds))
    return res
      .status(400)
      .json({ error: "line_user_id, status, orderedIds required" });
  if (!["pending", "done", "failed"].includes(String(status)))
    return res.status(400).json({ error: "invalid status" });
  const updates = orderedIds.map((id, idx) => ({
    id: Number(id),
    so: idx + 1,
  }));
  const stmt = db.prepare(
    "UPDATE tasks SET sort_order=? WHERE id=? AND line_user_id=? AND status=?"
  );
  db.run("BEGIN");
  for (const u of updates) stmt.run([u.so, u.id, line_user_id, status]);
  stmt.finalize((e) => {
    if (e) {
      try {
        db.run("ROLLBACK");
      } catch {}
      return res.status(500).json({ error: "db", detail: String(e) });
    }
    db.run("COMMIT", (e2) => {
      if (e2) return res.status(500).json({ error: "db", detail: String(e2) });
      res.json({ updated: updates.length });
    });
  });
});

router.get("/line-profile", async (req, res) => {
  try {
    const userId = String(req.query.user_id || "");
    if (!userId) return res.status(400).json({ error: "user_id required" });
    const p = await client.getProfile(userId);
    res.json(p);
  } catch (e) {
    res
      .status(500)
      .json({ error: "line", detail: e?.response?.data || String(e) });
  }
});

// Saved Views CRUD
router.get("/views", (req, res) => {
  const { line_user_id } = req.query;
  if (!line_user_id)
    return res.status(400).json({ error: "line_user_id required" });
  ensureViewOrderColumn(() => {
    db.all(
      "SELECT id,name,payload,view_order,created_at,updated_at FROM saved_views WHERE line_user_id=? ORDER BY COALESCE(view_order, 1e9), id DESC",
      [line_user_id],
      (e, rows) => {
        if (e) return res.status(500).json({ error: "db", detail: String(e) });
        res.json(
          (rows || []).map((r) => ({ ...r, payload: safeParse(r.payload) }))
        );
      }
    );
  });
});

router.post("/views", (req, res) => {
  const { line_user_id, name, payload } = req.body || {};
  if (!line_user_id || !name)
    return res.status(400).json({ error: "line_user_id and name required" });
  const json = JSON.stringify(payload || {});
  db.run(
    "INSERT INTO saved_views(line_user_id,name,payload) VALUES (?,?,?)",
    [line_user_id, name, json],
    function (err) {
      if (err)
        return res.status(500).json({ error: "db", detail: String(err) });
      res.json({ id: this?.lastID });
    }
  );
});

router.patch("/views/:id", (req, res) => {
  const { id } = req.params;
  const { name, payload } = req.body || {};
  const sets = [];
  const args = [];
  if (typeof name !== "undefined") {
    if (!String(name).trim())
      return res.status(400).json({ error: "name cannot be empty" });
    sets.push("name=?");
    args.push(String(name));
  }
  if (typeof payload !== "undefined") {
    sets.push("payload=?");
    args.push(JSON.stringify(payload || {}));
  }
  if (!sets.length)
    return res.status(400).json({ error: "no fields to update" });
  const sql = `UPDATE saved_views SET ${sets.join(
    ", "
  )}, updated_at=datetime('now','localtime') WHERE id=?`;
  db.run(sql, [...args, id], function (err) {
    if (err) return res.status(500).json({ error: "db", detail: String(err) });
    res.json({ updated: this?.changes || 0 });
  });
});

router.delete("/views/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM saved_views WHERE id=?", [id], function (err) {
    if (err) return res.status(500).json({ error: "db", detail: String(err) });
    res.json({ deleted: this?.changes || 0 });
  });
});

router.post("/views/reorder", (req, res) => {
  const { line_user_id, orderedIds } = req.body || {};
  if (!line_user_id || !Array.isArray(orderedIds))
    return res
      .status(400)
      .json({ error: "line_user_id and orderedIds required" });
  ensureViewOrderColumn(() => {
    const stmt = db.prepare(
      "UPDATE saved_views SET view_order=? WHERE id=? AND line_user_id=?"
    );
    db.run("BEGIN");
    orderedIds.forEach((id, idx) => stmt.run([idx + 1, id, line_user_id]));
    stmt.finalize((e) => {
      if (e) {
        try {
          db.run("ROLLBACK");
        } catch {}
        return res.status(500).json({ error: "db", detail: String(e) });
      }
      db.run("COMMIT", (e2) => {
        if (e2)
          return res.status(500).json({ error: "db", detail: String(e2) });
        res.json({ updated: orderedIds.length });
      });
    });
  });
});

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

module.exports = router;

// --- Todos (subtasks) API ---
// Create todo
router.post("/todos", (req, res) => {
  const { task_id, title, estimated_minutes, url, details_md } = req.body || {};
  if (!task_id || !title)
    return res.status(400).json({ error: "task_id and title required" });
  db.run(
    "INSERT INTO todos(task_id,title,estimated_minutes,url,details_md) VALUES(?,?,?,?,?)",
    [
      Number(task_id),
      String(title),
      Number.isFinite(Number(estimated_minutes))
        ? Number(estimated_minutes)
        : null,
      url || null,
      details_md || null,
    ],
    function (err) {
      if (err)
        return res.status(500).json({ error: "db", detail: String(err) });
      res.json({ id: this?.lastID });
    }
  );
});

// List todos for a task
router.get("/todos", (req, res) => {
  const { task_id } = req.query || {};
  if (!task_id) return res.status(400).json({ error: "task_id required" });
  db.all(
    "SELECT id,task_id,title,done,estimated_minutes,url,details_md,sort_order,created_at,updated_at FROM todos WHERE task_id=? ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order, id",
    [Number(task_id)],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db", detail: String(e) });
      res.json(rows || []);
    }
  );
});

// List todos by user across tasks
router.get("/todos/by-user", (req, res) => {
  const { line_user_id, done, project_id } = req.query || {};
  if (!line_user_id)
    return res.status(400).json({ error: "line_user_id required" });
  const conds = ["t.line_user_id=?"]; // join alias t for tasks
  const args = [line_user_id];
  if (typeof done !== "undefined") {
    conds.push("td.done=?");
    args.push(String(done) === "true" ? 1 : 0);
  }
  if (typeof project_id !== "undefined") {
    if (project_id === "none") conds.push("t.project_id IS NULL");
    else if (String(project_id).length) {
      conds.push("t.project_id=?");
      args.push(project_id);
    }
  }
  const where = "WHERE " + conds.join(" AND ");
  const sql = `SELECT td.id, td.task_id, td.title, td.done, td.estimated_minutes, td.sort_order,
                      t.title AS task_title, t.deadline, t.importance
               FROM todos td
               JOIN tasks t ON t.id = td.task_id
               ${where}
               ORDER BY CASE WHEN td.sort_order IS NULL THEN 1 ELSE 0 END, td.sort_order, td.id`;
  db.all(sql, args, (e, rows) => {
    if (e) return res.status(500).json({ error: "db", detail: String(e) });
    res.json(rows || []);
  });
});

// Update todo (title, done, sort_order)
router.patch("/todos/:id", (req, res) => {
  const { id } = req.params;
  const { title, done, sort_order, estimated_minutes, url, details_md } =
    req.body || {};
  const sets = [];
  const args = [];
  if (typeof title !== "undefined") {
    if (!String(title).trim())
      return res.status(400).json({ error: "title cannot be empty" });
    sets.push("title=?");
    args.push(String(title));
  }
  if (typeof done !== "undefined") {
    sets.push("done=?");
    args.push(Number(done ? 1 : 0));
  }
  if (typeof sort_order !== "undefined") {
    const so = Number.isFinite(Number(sort_order)) ? Number(sort_order) : null;
    sets.push("sort_order=?");
    args.push(so);
  }
  if (typeof estimated_minutes !== "undefined") {
    const est = Number.isFinite(Number(estimated_minutes))
      ? Number(estimated_minutes)
      : null;
    sets.push("estimated_minutes=?");
    args.push(est);
  }
  if (typeof url !== "undefined") {
    sets.push("url=?");
    args.push(url ? String(url) : null);
  }
  if (typeof details_md !== "undefined") {
    sets.push("details_md=?");
    args.push(details_md ? String(details_md) : null);
  }
  if (!sets.length)
    return res.status(400).json({ error: "no fields to update" });
  const sql = `UPDATE todos SET ${sets.join(
    ", "
  )}, updated_at=datetime('now','localtime') WHERE id=?`;
  db.run(sql, [...args, id], function (err) {
    if (err) return res.status(500).json({ error: "db", detail: String(err) });
    res.json({ updated: this?.changes || 0 });
  });
});

// Delete todo
router.delete("/todos/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM todos WHERE id=?", [id], function (err) {
    if (err) return res.status(500).json({ error: "db", detail: String(err) });
    res.json({ deleted: this?.changes || 0 });
  });
});

// Reorder todos within a task
router.post("/todos/reorder", (req, res) => {
  const { task_id, orderedIds } = req.body || {};
  if (!task_id || !Array.isArray(orderedIds))
    return res.status(400).json({ error: "task_id and orderedIds required" });
  const updates = orderedIds.map((id, idx) => ({
    id: Number(id),
    so: idx + 1,
  }));
  const stmt = db.prepare(
    "UPDATE todos SET sort_order=? WHERE id=? AND task_id=?"
  );
  db.run("BEGIN");
  for (const u of updates) stmt.run([u.so, u.id, Number(task_id)]);
  stmt.finalize((e) => {
    if (e) {
      try {
        db.run("ROLLBACK");
      } catch {}
      return res.status(500).json({ error: "db", detail: String(e) });
    }
    db.run("COMMIT", (e2) => {
      if (e2) return res.status(500).json({ error: "db", detail: String(e2) });
      res.json({ updated: updates.length });
    });
  });
});

// --- Plans API ---
// Get or create plan for a date
router.get("/plans", (req, res) => {
  const { line_user_id, date } = req.query || {};
  if (!line_user_id || !date)
    return res.status(400).json({ error: "line_user_id and date required" });
  db.get(
    "SELECT id,line_user_id,date,created_at,updated_at FROM plans WHERE line_user_id=? AND date=?",
    [line_user_id, date],
    (e, row) => {
      if (e) return res.status(500).json({ error: "db", detail: String(e) });
      if (!row) return res.json(null);
      db.all(
        `SELECT pi.id, pi.task_id, pi.todo_id, pi.order_index, pi.planned_minutes, pi.block, pi.rocket,
                COALESCE(td.title, t.title) AS title,
                CASE WHEN pi.todo_id IS NOT NULL THEN 'todo' ELSE 'task' END AS kind
         FROM plan_items pi
         LEFT JOIN todos td ON td.id = pi.todo_id
         LEFT JOIN tasks t ON t.id = pi.task_id
         WHERE pi.plan_id=?
         ORDER BY COALESCE(pi.order_index, 1e9), pi.id`,
        [row.id],
        (e2, items) => {
          if (e2)
            return res.status(500).json({ error: "db", detail: String(e2) });
          res.json({ ...row, items: items || [] });
        }
      );
    }
  );
});

// Create or upsert plan shell
router.post("/plans", (req, res) => {
  const { line_user_id, date } = req.body || {};
  if (!line_user_id || !date)
    return res.status(400).json({ error: "line_user_id and date required" });
  db.run(
    "INSERT OR IGNORE INTO plans(line_user_id,date) VALUES(?,?)",
    [line_user_id, date],
    function (err) {
      if (err)
        return res.status(500).json({ error: "db", detail: String(err) });
      db.get(
        "SELECT id FROM plans WHERE line_user_id=? AND date=?",
        [line_user_id, date],
        (e2, r) => {
          if (e2 || !r)
            return res.status(500).json({ error: "db", detail: String(e2) });
          res.json({ id: r.id });
        }
      );
    }
  );
});

// Add item to plan
router.post("/plans/:id/items", (req, res) => {
  const { id } = req.params;
  const { task_id, todo_id, planned_minutes, block, rocket } = req.body || {};
  if (!task_id && !todo_id)
    return res.status(400).json({ error: "task_id or todo_id required" });
  if (task_id && todo_id)
    return res
      .status(400)
      .json({ error: "provide only one of task_id or todo_id" });
  db.run(
    "INSERT INTO plan_items(plan_id,task_id,todo_id,planned_minutes,block,rocket) VALUES (?,?,?,?,?,?)",
    [
      Number(id),
      task_id ? Number(task_id) : null,
      todo_id ? Number(todo_id) : null,
      Number.isFinite(Number(planned_minutes)) ? Number(planned_minutes) : null,
      block || null,
      rocket ? 1 : 0,
    ],
    function (err) {
      if (err)
        return res.status(500).json({ error: "db", detail: String(err) });
      res.json({ id: this?.lastID });
    }
  );
});

// Reorder items within a plan
router.post("/plans/:id/items/reorder", (req, res) => {
  const { id } = req.params;
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds))
    return res.status(400).json({ error: "orderedIds required" });
  const stmt = db.prepare(
    "UPDATE plan_items SET order_index=? WHERE id=? AND plan_id=?"
  );
  db.run("BEGIN");
  orderedIds.forEach((pid, idx) =>
    stmt.run([idx + 1, Number(pid), Number(id)])
  );
  stmt.finalize((e) => {
    if (e) {
      try {
        db.run("ROLLBACK");
      } catch {}
      return res.status(500).json({ error: "db", detail: String(e) });
    }
    db.run("COMMIT", (e2) => {
      if (e2) return res.status(500).json({ error: "db", detail: String(e2) });
      res.json({ updated: orderedIds.length });
    });
  });
});

// Update plan item
router.patch("/plans/:id/items/:itemId", (req, res) => {
  const { id, itemId } = req.params;
  const { planned_minutes, block, rocket } = req.body || {};
  const sets = [];
  const args = [];
  if (typeof planned_minutes !== "undefined") {
    const pm = Number.isFinite(Number(planned_minutes))
      ? Number(planned_minutes)
      : null;
    sets.push("planned_minutes=?");
    args.push(pm);
  }
  if (typeof block !== "undefined") {
    sets.push("block=?");
    args.push(block || null);
  }
  if (typeof rocket !== "undefined") {
    sets.push("rocket=?");
    args.push(rocket ? 1 : 0);
  }
  if (!sets.length)
    return res.status(400).json({ error: "no fields to update" });
  const sql = `UPDATE plan_items SET ${sets.join(
    ", "
  )}, updated_at=datetime('now','localtime') WHERE id=? AND plan_id=?`;
  db.run(sql, [...args, Number(itemId), Number(id)], function (err) {
    if (err) return res.status(500).json({ error: "db", detail: String(err) });
    res.json({ updated: this?.changes || 0 });
  });
});

// Delete plan item
router.delete("/plans/:id/items/:itemId", (req, res) => {
  const { id, itemId } = req.params;
  db.run(
    "DELETE FROM plan_items WHERE id=? AND plan_id=?",
    [Number(itemId), Number(id)],
    function (err) {
      if (err)
        return res.status(500).json({ error: "db", detail: String(err) });
      res.json({ deleted: this?.changes || 0 });
    }
  );
});
