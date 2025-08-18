const express = require("express");
const { Client } = require("@line/bot-sdk");
const db = require("../db");
const { env, line } = require("../config");

const router = express.Router();
const client = new Client(line);

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
    "SELECT id,name,status,created_at,updated_at FROM projects WHERE line_user_id=? AND status='active' ORDER BY id DESC",
    [line_user_id],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db", detail: String(e) });
      res.json(rows || []);
    }
  );
});

router.post("/projects", (req, res) => {
  const { line_user_id, name } = req.body || {};
  if (!line_user_id || !name)
    return res.status(400).json({ error: "line_user_id and name required" });
  db.run(
    "INSERT INTO projects(line_user_id,name) VALUES(?,?)",
    [line_user_id, name],
    function (err) {
      if (err)
        return res.status(500).json({ error: "db", detail: String(err) });
      res.json({ id: this?.lastID, name });
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
    `SELECT id,title,deadline,status,project_id,type,progress,importance,sort_order,repeat FROM tasks ${where} ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC LIMIT ?`,
    [...args, lim],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db", detail: String(e) });
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const withUrgency = (rows || []).map((r) => {
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
      res.json(withUrgency);
    }
  );
});

router.post("/tasks", (req, res) => {
  const { line_user_id, title, deadline, project_id, importance, repeat } =
    req.body || {};
  if (!line_user_id || !title)
    return res.status(400).json({ error: "line_user_id and title required" });
  let imp = null;
  if (importance) {
    const v = String(importance).toLowerCase();
    if (["high", "medium", "low"].includes(v)) imp = v;
    else return res.status(400).json({ error: "invalid importance" });
  }
  const rep = repeat ? String(repeat) : null;
  db.run(
    "INSERT INTO tasks(line_user_id,title,deadline,project_id,importance,repeat) VALUES (?,?,?,?,?,?)",
    [line_user_id, title, deadline || null, project_id || null, imp, rep],
    function (err) {
      if (err)
        return res.status(500).json({ error: "db", detail: String(err) });
      res.json({ id: this?.lastID });
    }
  );
});

router.patch("/tasks/:id", (req, res) => {
  const { id } = req.params;
  const { title, deadline, project_id, importance, status, repeat, sort_order } = req.body || {};

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
  if (typeof status !== "undefined") {
    const s = String(status);
    if (!["pending", "done", "failed"].includes(s))
      return res.status(400).json({ error: "invalid status" });
    sets.push("status=?");
    args.push(s);
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
      db.get(
        "SELECT line_user_id,title,deadline,project_id,importance,repeat FROM tasks WHERE id=?",
        [id],
        (gErr, row) => {
          if (gErr || !row) return res.json({ updated });
          const rep = row.repeat ? String(row.repeat) : null;
          if (!rep || !row.deadline) return res.json({ updated });
          const next = calcNextDeadline(row.deadline, rep);
          if (!next) return res.json({ updated });
          db.run(
            "INSERT INTO tasks(line_user_id,title,deadline,project_id,importance,repeat) VALUES (?,?,?,?,?,?)",
            [
              row.line_user_id,
              row.title,
              next,
              row.project_id || null,
              row.importance || null,
              rep,
            ],
            () => res.json({ updated, repeated: true })
          );
        }
      );
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
    return res.status(400).json({ error: "line_user_id, status, orderedIds required" });
  if (!["pending", "done", "failed"].includes(String(status)))
    return res.status(400).json({ error: "invalid status" });
  const updates = orderedIds.map((id, idx) => ({ id: Number(id), so: idx + 1 }));
  const stmt = db.prepare("UPDATE tasks SET sort_order=? WHERE id=? AND line_user_id=? AND status=?");
  db.run("BEGIN");
  for (const u of updates) stmt.run([u.so, u.id, line_user_id, status]);
  stmt.finalize((e) => {
    if (e) {
      try { db.run("ROLLBACK"); } catch {}
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
  if (!line_user_id) return res.status(400).json({ error: "line_user_id required" });
  db.all(
    "SELECT id,name,payload,created_at,updated_at FROM saved_views WHERE line_user_id=? ORDER BY id DESC",
    [line_user_id],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db", detail: String(e) });
      res.json((rows || []).map((r) => ({ ...r, payload: safeParse(r.payload) })));
    }
  );
});

router.post("/views", (req, res) => {
  const { line_user_id, name, payload } = req.body || {};
  if (!line_user_id || !name) return res.status(400).json({ error: "line_user_id and name required" });
  const json = JSON.stringify(payload || {});
  db.run(
    "INSERT INTO saved_views(line_user_id,name,payload) VALUES (?,?,?)",
    [line_user_id, name, json],
    function (err) {
      if (err) return res.status(500).json({ error: "db", detail: String(err) });
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
    if (!String(name).trim()) return res.status(400).json({ error: "name cannot be empty" });
    sets.push("name=?");
    args.push(String(name));
  }
  if (typeof payload !== "undefined") {
    sets.push("payload=?");
    args.push(JSON.stringify(payload || {}));
  }
  if (!sets.length) return res.status(400).json({ error: "no fields to update" });
  const sql = `UPDATE saved_views SET ${sets.join(", ")}, updated_at=datetime('now','localtime') WHERE id=?`;
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

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

module.exports = router;
