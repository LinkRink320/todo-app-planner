const express = require("express");
const db = require("../db");
const { env } = require("../config");
const { generateAIReflection } = require("../utils/aiReflection");

const router = express.Router();

// API key authentication middleware
router.use((req, res, next) => {
  const k = req.headers["x-api-key"];
  if (!env.API_KEY) return res.status(403).json({ error: "API disabled" });
  if (k !== env.API_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
});

// 完了率の推移グラフ（日別）
router.get("/completion-rate", (req, res) => {
  const { line_user_id, days = 30 } = req.query;
  if (!line_user_id)
    return res.status(400).json({ error: "line_user_id required" });

  const sql = `
    WITH RECURSIVE dates(date) AS (
      SELECT date('now', 'localtime', '-${
        Math.max(parseInt(days) || 30, 1) - 1
      } days')
      UNION ALL
      SELECT date(date, '+1 day')
      FROM dates
      WHERE date < date('now', 'localtime')
    )
    SELECT 
      d.date,
      COALESCE(t.total, 0) as total_tasks,
      COALESCE(t.completed, 0) as completed_tasks,
      COALESCE(t.failed, 0) as failed_tasks,
      CASE 
        WHEN COALESCE(t.total, 0) = 0 THEN 0
        ELSE ROUND(CAST(COALESCE(t.completed, 0) AS FLOAT) / t.total * 100, 1)
      END as completion_rate
    FROM dates d
    LEFT JOIN (
      SELECT 
        date(
          CASE 
            WHEN status = 'done' THEN done_at
            WHEN status = 'failed' THEN failed_at
            ELSE created_at
          END
        ) as date,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM tasks 
      WHERE line_user_id = ?
        AND date(
          CASE 
            WHEN status = 'done' THEN done_at
            WHEN status = 'failed' THEN failed_at
            ELSE created_at
          END
        ) >= date('now', 'localtime', '-${
          Math.max(parseInt(days) || 30, 1) - 1
        } days')
      GROUP BY date
    ) t ON d.date = t.date
    ORDER BY d.date
  `;

  db.all(sql, [line_user_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// 時間別・曜日別生産性分析
router.get("/productivity-patterns", (req, res) => {
  const { line_user_id, days = 30 } = req.query;
  if (!line_user_id)
    return res.status(400).json({ error: "line_user_id required" });

  // 時間別分析
  const hourlyQuery = `
    SELECT 
      CAST(strftime('%H', start_time) AS INTEGER) as hour,
      COUNT(*) as sessions,
      COALESCE(SUM(duration_minutes), 0) as total_minutes,
      COALESCE(AVG(duration_minutes), 0) as avg_duration
    FROM time_entries 
    WHERE line_user_id = ?
      AND date(start_time) >= date('now', 'localtime', '-${
        Math.max(parseInt(days) || 30, 1) - 1
      } days')
      AND end_time IS NOT NULL
    GROUP BY hour
    ORDER BY hour
  `;

  // 曜日別分析
  const weeklyQuery = `
    SELECT 
      CASE CAST(strftime('%w', start_time) AS INTEGER)
        WHEN 0 THEN '日'
        WHEN 1 THEN '月'
        WHEN 2 THEN '火'
        WHEN 3 THEN '水'
        WHEN 4 THEN '木'
        WHEN 5 THEN '金'
        WHEN 6 THEN '土'
      END as day_of_week,
      CAST(strftime('%w', start_time) AS INTEGER) as day_index,
      COUNT(*) as sessions,
      COALESCE(SUM(duration_minutes), 0) as total_minutes,
      COALESCE(AVG(duration_minutes), 0) as avg_duration
    FROM time_entries 
    WHERE line_user_id = ?
      AND date(start_time) >= date('now', 'localtime', '-${
        Math.max(parseInt(days) || 30, 1) - 1
      } days')
      AND end_time IS NOT NULL
    GROUP BY day_index
    ORDER BY day_index
  `;

  db.all(hourlyQuery, [line_user_id], (err, hourlyData) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all(weeklyQuery, [line_user_id], (err, weeklyData) => {
      if (err) return res.status(500).json({ error: err.message });

      res.json({
        hourly: hourlyData || [],
        weekly: weeklyData || [],
      });
    });
  });
});

// 見積vs実績時間の精度分析
router.get("/estimation-accuracy", (req, res) => {
  const { line_user_id, days = 30 } = req.query;
  if (!line_user_id)
    return res.status(400).json({ error: "line_user_id required" });

  const sql = `
    SELECT 
      t.id,
      t.title,
      t.estimated_minutes,
      t.actual_minutes,
      date(t.done_at) as completion_date,
      CASE 
        WHEN t.estimated_minutes > 0 AND t.actual_minutes > 0 THEN
          ROUND(CAST(t.actual_minutes AS FLOAT) / t.estimated_minutes * 100, 1)
        ELSE NULL
      END as accuracy_ratio,
      CASE 
        WHEN t.estimated_minutes > 0 AND t.actual_minutes > 0 THEN
          t.actual_minutes - t.estimated_minutes
        ELSE NULL
      END as time_difference
    FROM tasks t
    WHERE t.line_user_id = ?
      AND t.status = 'done'
      AND t.estimated_minutes > 0
      AND t.actual_minutes > 0
      AND date(t.done_at) >= date('now', 'localtime', '-${
        Math.max(parseInt(days) || 30, 1) - 1
      } days')
    ORDER BY t.done_at DESC
  `;

  db.all(sql, [line_user_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const data = rows || [];
    const summary = {
      total_tasks: data.length,
      avg_accuracy:
        data.length > 0
          ? Math.round(
              (data.reduce((sum, task) => sum + (task.accuracy_ratio || 0), 0) /
                data.length) *
                10
            ) / 10
          : 0,
      underestimated: data.filter((t) => t.time_difference > 0).length,
      overestimated: data.filter((t) => t.time_difference < 0).length,
      accurate: data.filter(
        (t) => Math.abs(t.time_difference) <= t.estimated_minutes * 0.1
      ).length,
    };

    res.json({
      tasks: data,
      summary,
    });
  });
});

// プロジェクト別進捗レポート
router.get("/project-progress", (req, res) => {
  const { line_user_id, days = 30 } = req.query;
  if (!line_user_id)
    return res.status(400).json({ error: "line_user_id required" });

  const sql = `
    SELECT 
      p.id as project_id,
      p.name as project_name,
      COUNT(t.id) as total_tasks,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as completed_tasks,
      SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) as pending_tasks,
      SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) as failed_tasks,
      COALESCE(SUM(t.estimated_minutes), 0) as total_estimated_minutes,
      COALESCE(SUM(t.actual_minutes), 0) as total_actual_minutes,
      CASE 
        WHEN COUNT(t.id) = 0 THEN 0
        ELSE ROUND(CAST(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(t.id) * 100, 1)
      END as completion_rate
    FROM projects p
    LEFT JOIN tasks t ON p.id = t.project_id 
      AND date(t.created_at) >= date('now', 'localtime', '-${
        Math.max(parseInt(days) || 30, 1) - 1
      } days')
    WHERE p.line_user_id = ? AND p.status = 'active'
    GROUP BY p.id, p.name
    ORDER BY completion_rate DESC, total_tasks DESC
  `;

  db.all(sql, [line_user_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// 1日の振り返りデータ取得
router.get("/daily-reflection", (req, res) => {
  const { line_user_id, date } = req.query;
  if (!line_user_id)
    return res.status(400).json({ error: "line_user_id required" });

  const targetDate = date || new Date().toISOString().split("T")[0];

  // タスクの完了状況
  const tasksQuery = `
    SELECT 
      id, title, status, importance, estimated_minutes, actual_minutes,
      deadline, done_at, failed_at
    FROM tasks 
    WHERE line_user_id = ? 
      AND (
        date(deadline) = ? OR
        date(done_at) = ? OR 
        date(failed_at) = ?
      )
    ORDER BY 
      CASE status 
        WHEN 'done' THEN 1 
        WHEN 'failed' THEN 2 
        ELSE 3 
      END,
      deadline
  `;

  // 時間追跡データ
  const timeQuery = `
    SELECT 
      te.*, t.title as task_title, t.importance
    FROM time_entries te
    LEFT JOIN tasks t ON te.task_id = t.id
    WHERE te.line_user_id = ?
      AND date(te.start_time) = ?
      AND te.end_time IS NOT NULL
    ORDER BY te.start_time
  `;

  db.all(
    tasksQuery,
    [line_user_id, targetDate, targetDate, targetDate],
    (err, tasks) => {
      if (err) return res.status(500).json({ error: err.message });

      db.all(timeQuery, [line_user_id, targetDate], (err, timeEntries) => {
        if (err) return res.status(500).json({ error: err.message });

        const reflection = {
          date: targetDate,
          tasks: tasks || [],
          timeEntries: timeEntries || [],
          summary: {
            total_tasks: tasks.length,
            completed_tasks: tasks.filter((t) => t.status === "done").length,
            failed_tasks: tasks.filter((t) => t.status === "failed").length,
            total_work_time: timeEntries.reduce(
              (sum, te) => sum + (te.duration_minutes || 0),
              0
            ),
            work_sessions: timeEntries.length,
          },
        };

        res.json(reflection);
      });
    }
  );
});

// AI振り返り生成API
router.post("/ai-reflection", async (req, res) => {
  const { line_user_id, date } = req.body;
  if (!line_user_id)
    return res.status(400).json({ error: "line_user_id required" });

  const targetDate = date || new Date().toISOString().split("T")[0];

  try {
    // 日次振り返りデータを取得
    const tasksQuery = `
      SELECT 
        id, title, status, importance, estimated_minutes, actual_minutes,
        deadline, done_at, failed_at
      FROM tasks 
      WHERE line_user_id = ? 
        AND (
          date(deadline) = ? OR
          date(done_at) = ? OR 
          date(failed_at) = ?
        )
      ORDER BY 
        CASE status 
          WHEN 'done' THEN 1 
          WHEN 'failed' THEN 2 
          ELSE 3 
        END,
        deadline
    `;

    const timeQuery = `
      SELECT 
        te.*, t.title as task_title, t.importance
      FROM time_entries te
      LEFT JOIN tasks t ON te.task_id = t.id
      WHERE te.line_user_id = ?
        AND date(te.start_time) = ?
        AND te.end_time IS NOT NULL
      ORDER BY te.start_time
    `;

    const tasks = await new Promise((resolve, reject) => {
      db.all(
        tasksQuery,
        [line_user_id, targetDate, targetDate, targetDate],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    const timeEntries = await new Promise((resolve, reject) => {
      db.all(timeQuery, [line_user_id, targetDate], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const reflectionData = {
      date: targetDate,
      tasks,
      timeEntries,
      summary: {
        total_tasks: tasks.length,
        completed_tasks: tasks.filter((t) => t.status === "done").length,
        failed_tasks: tasks.filter((t) => t.status === "failed").length,
        total_work_time: timeEntries.reduce(
          (sum, te) => sum + (te.duration_minutes || 0),
          0
        ),
        work_sessions: timeEntries.length,
      },
    };

    // AI振り返りを生成
    const aiReflection = await generateAIReflection(reflectionData);

    res.json({
      date: targetDate,
      reflection: aiReflection,
      data: reflectionData,
    });
  } catch (error) {
    console.error("AI reflection generation error:", error);
    res.status(500).json({
      error: "AI reflection generation failed",
      message: error.message,
    });
  }
});

module.exports = router;
