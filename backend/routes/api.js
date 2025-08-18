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
  const { line_user_id, project_id, status = "pending", limit } = req.query;
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
  const where = "WHERE " + conds.join(" AND ");
  const lim = Math.min(Math.max(parseInt(limit || 200, 10) || 200, 1), 1000);
  db.all(
    `SELECT id,title,deadline,status,project_id,type,progress,importance FROM tasks ${where} ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC LIMIT ?`,
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
  const { line_user_id, title, deadline, project_id, importance } =
    req.body || {};
  if (!line_user_id || !title)
    return res.status(400).json({ error: "line_user_id and title required" });
  let imp = null;
  if (importance) {
    const v = String(importance).toLowerCase();
    if (["high", "medium", "low"].includes(v)) imp = v;
    else return res.status(400).json({ error: "invalid importance" });
  }
  db.run(
    "INSERT INTO tasks(line_user_id,title,deadline,project_id,importance) VALUES (?,?,?,?,?)",
    [line_user_id, title, deadline || null, project_id || null, imp],
    function (err) {
      if (err)
        return res.status(500).json({ error: "db", detail: String(err) });
      res.json({ id: this?.lastID });
    }
  );
});

router.patch("/tasks/:id", (req, res) => {
  const { id } = req.params;
  const { title, deadline, project_id, importance, status } = req.body || {};

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
    const p = project_id === null || project_id === "none" ? null : Number(project_id) || null;
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
  if (typeof status !== "undefined") {
    const s = String(status);
    if (!["pending", "done", "failed"].includes(s))
      return res.status(400).json({ error: "invalid status" });
    sets.push("status=?");
    args.push(s);
  }

  if (!sets.length) return res.status(400).json({ error: "no fields to update" });

  // always bump updated_at
  const sql = `UPDATE tasks SET ${sets.join(", ")}, updated_at=datetime('now','localtime') WHERE id=?`;
  db.run(sql, [...args, id], function (err) {
    if (err) return res.status(500).json({ error: "db", detail: String(err) });
    res.json({ updated: this?.changes || 0 });
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

module.exports = router;
