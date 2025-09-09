const express = require("express");
const db = require("../db");
const { env } = require("../config");

const router = express.Router();

// API key authentication middleware
router.use((req, res, next) => {
  const k = req.headers["x-api-key"];
  if (!env.API_KEY) return res.status(403).json({ error: "API disabled" });
  if (k !== env.API_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
});

// Create time tracking table if not exists
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS time_entries(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    task_id INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    duration_minutes INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  )`);

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_time_entries_user_date ON time_entries(line_user_id, date(start_time))"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id)"
  );
});

// GET /api/time-entries - List time entries for a user and date
router.get("/", async (req, res) => {
  try {
    const { line_user_id, date } = req.query;
    if (!line_user_id)
      return res.status(400).json({ error: "line_user_id required" });

    let sql = `
      SELECT te.*, t.title as task_title, t.importance, t.estimated_minutes
      FROM time_entries te
      LEFT JOIN tasks t ON te.task_id = t.id
      WHERE te.line_user_id = ?
    `;
    const params = [line_user_id];

    if (date) {
      sql += " AND date(te.start_time) = ?";
      params.push(date);
    }

    sql += " ORDER BY te.start_time DESC";

    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/time-entries - Start time tracking
router.post("/", async (req, res) => {
  try {
    const { line_user_id, task_id, start_time } = req.body;
    if (!line_user_id || !task_id || !start_time) {
      return res
        .status(400)
        .json({ error: "line_user_id, task_id, and start_time required" });
    }

    // Stop any active tracking for this user first
    const stopSql = `
      UPDATE time_entries 
      SET end_time = datetime('now','localtime'),
          duration_minutes = CAST((julianday(datetime('now','localtime')) - julianday(start_time)) * 24 * 60 AS INTEGER)
      WHERE line_user_id = ? AND end_time IS NULL
    `;

    db.run(stopSql, [line_user_id], function (err) {
      if (err) return res.status(500).json({ error: err.message });

      // Start new tracking
      const insertSql = `
        INSERT INTO time_entries (line_user_id, task_id, start_time)
        VALUES (?, ?, ?)
      `;

      db.run(insertSql, [line_user_id, task_id, start_time], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/time-entries - Stop time tracking
router.patch("/", async (req, res) => {
  try {
    const { line_user_id, task_id, end_time, duration_minutes } = req.body;
    if (!line_user_id || !task_id) {
      return res
        .status(400)
        .json({ error: "line_user_id and task_id required" });
    }

    const sql = `
      UPDATE time_entries 
      SET end_time = ?,
          duration_minutes = ?
      WHERE line_user_id = ? AND task_id = ? AND end_time IS NULL
    `;

    db.run(
      sql,
      [end_time, duration_minutes, line_user_id, task_id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });

        if (this.changes === 0) {
          return res.status(404).json({ error: "No active time entry found" });
        }

        // Update task with actual time
        if (duration_minutes) {
          const updateTaskSql = `
          UPDATE tasks 
          SET actual_minutes = COALESCE(actual_minutes, 0) + ?,
              time_entries = json_insert(
                COALESCE(time_entries, '[]'),
                '$[#]',
                json_object('start', ?, 'end', ?, 'duration', ?)
              )
          WHERE id = ?
        `;

          db.run(
            updateTaskSql,
            [
              duration_minutes,
              req.body.start_time ||
                new Date(Date.now() - duration_minutes * 60000).toISOString(),
              end_time,
              duration_minutes,
              task_id,
            ],
            (err) => {
              if (err) console.error("Failed to update task time:", err);
              res.json({ success: true });
            }
          );
        } else {
          res.json({ success: true });
        }
      }
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/time-entries/:id - Delete time entry
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { line_user_id } = req.query;

    if (!line_user_id)
      return res.status(400).json({ error: "line_user_id required" });

    const sql = "DELETE FROM time_entries WHERE id = ? AND line_user_id = ?";

    db.run(sql, [id, line_user_id], function (err) {
      if (err) return res.status(500).json({ error: err.message });

      if (this.changes === 0) {
        return res.status(404).json({ error: "Time entry not found" });
      }

      res.json({ success: true });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
