// backend/server.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const { Client } = require("@line/bot-sdk");
const cron = require("node-cron");
const db = require("./db");
const { env, line: lineCfg } = require("./config");
const apiRouter = require("./routes/api");
const lineRouter = require("./routes/line");
const timeTrackingRouter = require("./routes/timeTracking");
const { handleRecurringTaskCreation } = require("./utils/recurring");

const client = new Client(lineCfg);
const app = express();

app.get("/healthz", (_, res) => res.send("ok"));
// Basic request timeout for API routes to avoid hanging connections
function withTimeout(ms) {
  return function (req, res, next) {
    req.setTimeout(ms);
    res.setTimeout(ms);
    next();
  };
}
app.use("/api", withTimeout(10000), express.json());
app.get("/api/config", (req, res) => {
  res.json({
    apiKeySet: Boolean(env.API_KEY),
    defaultLineUserId: env.DEFAULT_LINE_USER_ID || null,
    defaultLineUserName: env.DEFAULT_LINE_USER_NAME || null,
  });
});
app.use("/api", apiRouter);
app.use("/api/time-entries", timeTrackingRouter);
app.use("/line", lineRouter);

const reactDist = path.join(__dirname, "..", "frontend", "dist");
if (fs.existsSync(reactDist)) {
  app.use(express.static(reactDist));
  // Use RegExp catch-all to avoid path-to-regexp string parsing pitfalls
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(reactDist, "index.html"));
  });
} else {
  app.get("/", (_, res) =>
    res.send("SPA not built. Run web:dev or web:build.")
  );
}

app.listen(env.PORT, () => console.log("server ready"));

// Evening planning reminder (default 21:00). Override with env.EVENING_PLAN_REMINDER_CRON.
const EVENING_PLAN_REMINDER_CRON =
  env.EVENING_PLAN_REMINDER_CRON || "0 21 * * *";
cron.schedule(EVENING_PLAN_REMINDER_CRON, async () => {
  try {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )}`;
    // tomorrow y-m-d
    const tm = new Date(now);
    tm.setDate(tm.getDate() + 1);
    const tomorrow = `${tm.getFullYear()}-${pad(tm.getMonth() + 1)}-${pad(
      tm.getDate()
    )}`;
    // Select users who interacted or have tasks recently to limit spam: anyone with pending tasks or any project
    const userIds = await new Promise((resolve) => {
      db.all(
        `SELECT DISTINCT line_user_id FROM tasks WHERE status='pending' LIMIT 1000`,
        [],
        (e, rows) => resolve(e ? [] : rows.map((r) => r.line_user_id))
      );
    });
    for (const uid of userIds) {
      // Count pending tasks today and tomorrow for brief context
      const [todays, tomorrows] = await Promise.all([
        new Promise((resolve) =>
          db.all(
            `SELECT id,title,deadline FROM tasks WHERE line_user_id=? AND status='pending' AND deadline LIKE ? ORDER BY deadline LIMIT 5`,
            [uid, `${today} %`],
            (e, rows) => resolve(e ? [] : rows)
          )
        ),
        new Promise((resolve) =>
          db.all(
            `SELECT id,title,deadline FROM tasks WHERE line_user_id=? AND status='pending' AND deadline LIKE ? ORDER BY deadline LIMIT 5`,
            [uid, `${tomorrow} %`],
            (e, rows) => resolve(e ? [] : rows)
          )
        ),
      ]);
      const lines = [];
      lines.push(`一日の振り返りと明日の準備をしませんか？`);
      if (todays.length)
        lines.push(
          `今日の残り (${todays.length}):\n` +
            todays
              .map((t) => `・${t.title} (${t.deadline.slice(11, 16)})`)
              .join("\n")
        );
      if (tomorrows.length)
        lines.push(
          `明日の期限 (${tomorrows.length}):\n` +
            tomorrows
              .map((t) => `・${t.title} (${t.deadline.slice(11, 16)})`)
              .join("\n")
        );
      lines.push("明日のタスクを追加・調整しましょう。");
      try {
        await client.pushMessage(uid, {
          type: "text",
          text: lines.join("\n\n"),
        });
      } catch (e) {
        console.error("[PUSH evening reminder ERROR]", e?.response?.data || e);
      }
    }
  } catch (e) {
    console.error("[CRON evening reminder ERROR]", e);
  }
});

cron.schedule("* * * * *", async () => {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const current = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const fmt = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  const t30 = new Date(now.getTime() + 30 * 60 * 1000);
  const t05 = new Date(now.getTime() + 5 * 60 * 1000);
  const target30 = fmt(t30);
  const target05 = fmt(t05);

  const sendReminders = (target, label) => {
    db.all(
      'SELECT id, line_user_id, title, deadline FROM tasks WHERE status="pending" AND deadline = ? ORDER BY id ASC LIMIT 100',
      [target],
      async (err, rows) => {
        if (err || !rows?.length) return;
        for (const r of rows) {
          const text = `⏰${label}リマインド「${r.title}」(期限: ${r.deadline})`;
          try {
            await client.pushMessage(r.line_user_id, { type: "text", text });
          } catch (e) {
            console.error("[PUSH remind ERROR]", e?.response?.data || e);
          }
        }
      }
    );
  };
  sendReminders(target30, "30分前");
  sendReminders(target05, "5分前");
  db.all(
    'SELECT id, line_user_id, title, deadline, repeat FROM tasks WHERE status="pending" AND deadline <= ? ORDER BY deadline ASC LIMIT 100',
    [current],
    async (err, rows) => {
      if (err) return console.error("[CRON DB ERROR]", err);
      if (!rows || !rows.length) return;
      const ids = rows.map((r) => r.id);
      db.run(
        `UPDATE tasks SET status='failed', failed_at=datetime('now','localtime') WHERE id IN (${ids
          .map(() => "?")
          .join(",")})`,
        ids,
        async (uErr) => {
          if (uErr) return console.error("[CRON UPDATE ERROR]", uErr);
          for (const r of rows) {
            // Send notification to user and group
            const msg = {
              type: "text",
              text: `⚠️未達成「${r.title}」(期限: ${r.deadline})`,
            };
            try {
              await client.pushMessage(r.line_user_id, msg);
            } catch (e) {
              console.error("[PUSH user ERROR]", e?.response?.data || e);
            }
            db.get(
              "SELECT group_id FROM groups WHERE owner_line_user_id=? ORDER BY id DESC LIMIT 1",
              [r.line_user_id],
              async (gErr, gRow) => {
                if (gErr || !gRow) return;
                try {
                  await client.pushMessage(gRow.group_id, {
                    type: "text",
                    text: `📢未達成: ${r.title}（期限超過）`,
                  });
                } catch (e) {
                  console.error("[PUSH group ERROR]", e?.response?.data || e);
                }
              }
            );

            // Handle recurring task generation for failed tasks
            if (r.repeat) {
              try {
                // Get full task details for recurring task creation
                db.get(
                  "SELECT * FROM tasks WHERE id=?",
                  [r.id],
                  async (taskErr, taskRow) => {
                    if (taskErr || !taskRow) return;

                    // Create next recurring task with 1-day delay for failed tasks
                    const result = await handleRecurringTaskCreation(
                      r.id,
                      taskRow,
                      { skipDays: 1 }
                    );
                    if (result.success) {
                      console.log(
                        `[RECURRING] Created next task for failed recurring task: ${r.title} (original: ${r.id}, new: ${result.taskId})`
                      );

                      // Notify user about next occurrence
                      try {
                        await client.pushMessage(r.line_user_id, {
                          type: "text",
                          text: `🔄 繰り返しタスク「${r.title}」の次回分を明日に設定しました`,
                        });
                      } catch (e) {
                        console.error(
                          "[PUSH recurring notification ERROR]",
                          e?.response?.data || e
                        );
                      }
                    }
                  }
                );
              } catch (e) {
                console.error("[RECURRING task creation ERROR]", e);
              }
            }
          }
        }
      );
    }
  );
});

// Morning summary (default 08:30 local time). Override with env.MORNING_SUMMARY_CRON.
const MORNING_SUMMARY_CRON = env.MORNING_SUMMARY_CRON || "30 8 * * *";
cron.schedule(MORNING_SUMMARY_CRON, async () => {
  try {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )}`;
    const current = `${today} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    // Get users who have relevant tasks (today's deadlines/soft_deadlines or overdue)
    const userIds = await new Promise((resolve) => {
      db.all(
        `SELECT DISTINCT line_user_id FROM tasks WHERE status='pending' AND (
           (deadline LIKE ?)
           OR (soft_deadline LIKE ?)
           OR (deadline IS NOT NULL AND deadline < ?)
         ) LIMIT 1000`,
        [`${today} %`, `${today}%`, current],
        (e, rows) => resolve(e ? [] : rows.map((r) => r.line_user_id))
      );
    });
    for (const uid of userIds) {
      // Today's tasks by hard deadline
      const todays = await new Promise((resolve) => {
        db.all(
          `SELECT id,title,deadline FROM tasks WHERE line_user_id=? AND status='pending' AND deadline LIKE ?
           ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline LIMIT 10`,
          [uid, `${today} %`],
          (e, rows) => resolve(e ? [] : rows)
        );
      });
      // Today's soft deadlines
      const softs = await new Promise((resolve) => {
        db.all(
          `SELECT id,title,soft_deadline FROM tasks WHERE line_user_id=? AND status='pending' AND soft_deadline LIKE ?
           ORDER BY soft_deadline LIMIT 10`,
          [uid, `${today}%`],
          (e, rows) => resolve(e ? [] : rows)
        );
      });
      // Overdue tasks
      const overdue = await new Promise((resolve) => {
        db.all(
          `SELECT id,title,deadline FROM tasks WHERE line_user_id=? AND status='pending' AND deadline IS NOT NULL AND deadline < ?
           ORDER BY deadline ASC LIMIT 10`,
          [uid, current],
          (e, rows) => resolve(e ? [] : rows)
        );
      });
      const lines = [];
      lines.push(`おはようございます！本日のサマリー`);
      if (todays.length)
        lines.push(
          `今日の期限 (${todays.length}):\n` +
            todays
              .map((t) => `・${t.title} (${t.deadline.slice(11, 16)})`)
              .join("\n")
        );
      if (softs.length)
        lines.push(
          `内締切 (${softs.length}):\n` +
            softs
              .map(
                (t) =>
                  `・${t.title}${
                    t.soft_deadline?.slice(10)
                      ? ` (${t.soft_deadline.slice(11, 16)})`
                      : ""
                  }`
              )
              .join("\n")
        );
      if (overdue.length)
        lines.push(
          `超過中 (${overdue.length}):\n` +
            overdue.map((t) => `・${t.title} [${t.deadline}]`).join("\n")
        );
      if (!todays.length && !softs.length && !overdue.length)
        lines.push("今日は期限のタスクはありません 🎉");
      try {
        await client.pushMessage(uid, {
          type: "text",
          text: lines.join("\n\n"),
        });
      } catch (e) {
        console.error("[PUSH morning summary ERROR]", e?.response?.data || e);
      }
      // For up to 5 overdue tasks, send a confirm template with delete option
      for (const t of overdue.slice(0, 5)) {
        try {
          await client.pushMessage(uid, {
            type: "template",
            altText: `超過削除: ${t.title}`,
            template: {
              type: "confirm",
              text: `超過:『${t.title}』\n削除しますか？`,
              actions: [
                {
                  type: "postback",
                  label: "削除する",
                  data: `action=delete-task&id=${t.id}`,
                },
                { type: "postback", label: "やめる", data: "action=cancel" },
              ],
            },
          });
        } catch (e) {
          console.error("[PUSH overdue confirm ERROR]", e?.response?.data || e);
        }
      }
    }
  } catch (e) {
    console.error("[CRON morning summary ERROR]", e);
  }
});

// Morning deletion confirmation for tasks that failed yesterday (default 08:00). Override with env.MORNING_DELETE_CONFIRM_CRON.
const MORNING_DELETE_CONFIRM_CRON =
  env.MORNING_DELETE_CONFIRM_CRON || "0 8 * * *";
cron.schedule(MORNING_DELETE_CONFIRM_CRON, async () => {
  try {
    const now = new Date();
    // Compute "yesterday" date string in local time (YYYY-MM-DD)
    const pad = (n) => String(n).padStart(2, "0");
    const y = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
      0,
      0,
      0,
      0
    );
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )}`;
    const ymd = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(
      y.getDate()
    )}`;
    // Collect users who had tasks fail yesterday
    const userIds = await new Promise((resolve) =>
      db.all(
        `SELECT DISTINCT line_user_id FROM tasks WHERE status='failed' AND failed_at LIKE ? LIMIT 1000`,
        [`${ymd}%`],
        (e, rows) => resolve(e ? [] : rows.map((r) => r.line_user_id))
      )
    );
    for (const uid of userIds) {
      // fetch up to 5 failed-yesterday tasks
      const failedYesterday = await new Promise((resolve) =>
        db.all(
          `SELECT id,title,deadline FROM tasks WHERE line_user_id=? AND status='failed' AND failed_at LIKE ? ORDER BY failed_at ASC LIMIT 5`,
          [uid, `${ymd}%`],
          (e, rows) => resolve(e ? [] : rows)
        )
      );
      if (!failedYesterday.length) continue;
      try {
        await client.pushMessage(uid, {
          type: "text",
          text: `おはようございます。昨日( ${ymd} )に未達となったタスクの整理をしますか？`,
        });
      } catch {}
      for (const t of failedYesterday) {
        try {
          await client.pushMessage(uid, {
            type: "template",
            altText: `昨日の未達: ${t.title}`,
            template: {
              type: "buttons",
              title: "昨日の未達",
              text: `『${t.title}』どうしますか？`,
              actions: [
                {
                  type: "postback",
                  label: "延期: 明日9時",
                  data: `action=postpone-task&id=${t.id}&preset=tomorrow09`,
                },
                {
                  type: "postback",
                  label: "延期: 次平日9時",
                  data: `action=postpone-task&id=${t.id}&preset=nextweekday09`,
                },
                {
                  type: "postback",
                  label: "削除する",
                  data: `action=delete-task&id=${t.id}`,
                },
                { type: "postback", label: "やめる", data: "action=cancel" },
              ],
            },
          });
        } catch (e) {
          console.error(
            "[PUSH failed-yesterday confirm ERROR]",
            e?.response?.data || e
          );
        }
      }
    }
  } catch (e) {
    console.error("[CRON morning delete confirm ERROR]", e);
  }
});

// Daily recurring tasks check (default 06:00). Override with env.DAILY_RECURRING_CHECK_CRON.
const DAILY_RECURRING_CHECK_CRON =
  env.DAILY_RECURRING_CHECK_CRON || "0 6 * * *";
cron.schedule(DAILY_RECURRING_CHECK_CRON, async () => {
  try {
    console.log(
      "[CRON recurring check] Starting daily recurring tasks check..."
    );

    // Find recurring tasks that should have next occurrences but don't
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )}`;
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStr = `${yesterday.getFullYear()}-${pad(
      yesterday.getMonth() + 1
    )}-${pad(yesterday.getDate())}`;

    // Find completed or failed recurring tasks from yesterday that might need next occurrence
    const tasksToCheck = await new Promise((resolve) => {
      db.all(
        `SELECT DISTINCT t1.line_user_id, t1.title, t1.repeat, t1.project_id
         FROM tasks t1 
         WHERE t1.repeat IS NOT NULL 
           AND t1.repeat != ''
           AND (
             (t1.status = 'done' AND date(t1.done_at) = ?)
             OR (t1.status = 'failed' AND date(t1.failed_at) = ?)
           )
           AND NOT EXISTS (
             SELECT 1 FROM tasks t2 
             WHERE t2.line_user_id = t1.line_user_id 
               AND t2.title = t1.title 
               AND t2.repeat = t1.repeat
               AND COALESCE(t2.project_id, -1) = COALESCE(t1.project_id, -1)
               AND t2.status = 'pending'
               AND date(t2.deadline) >= ?
           )`,
        [yesterdayStr, yesterdayStr, today],
        (e, rows) => resolve(e ? [] : rows)
      );
    });

    console.log(
      `[CRON recurring check] Found ${tasksToCheck.length} recurring task patterns to check`
    );

    for (const pattern of tasksToCheck) {
      try {
        // Get the most recent task for this pattern to use as template
        const templateTask = await new Promise((resolve) => {
          db.get(
            `SELECT * FROM tasks 
             WHERE line_user_id = ? 
               AND title = ? 
               AND repeat = ?
               AND COALESCE(project_id, -1) = COALESCE(?, -1)
             ORDER BY 
               CASE 
                 WHEN status = 'done' THEN done_at
                 WHEN status = 'failed' THEN failed_at
                 ELSE created_at
               END DESC
             LIMIT 1`,
            [
              pattern.line_user_id,
              pattern.title,
              pattern.repeat,
              pattern.project_id,
            ],
            (e, row) => resolve(e ? null : row)
          );
        });

        if (!templateTask || !templateTask.deadline) continue;

        // Create next occurrence from today
        const result = await handleRecurringTaskCreation(
          templateTask.id,
          templateTask,
          { skipToNextInterval: true }
        );
        if (result.success) {
          console.log(
            `[CRON recurring check] Created missing recurring task: ${pattern.title} for user ${pattern.line_user_id}`
          );

          // Optionally notify user about auto-created task
          try {
            await client.pushMessage(pattern.line_user_id, {
              type: "text",
              text: `🔄 繰り返しタスク「${pattern.title}」の今日分を自動作成しました`,
            });
          } catch (e) {
            console.error(
              "[PUSH recurring auto-create notification ERROR]",
              e?.response?.data || e
            );
          }
        }
      } catch (e) {
        console.error(
          `[CRON recurring check] Error processing pattern ${pattern.title}:`,
          e
        );
      }
    }
  } catch (e) {
    console.error("[CRON recurring check ERROR]", e);
  }
});
