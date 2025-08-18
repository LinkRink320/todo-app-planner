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
    'SELECT id, line_user_id, title, deadline FROM tasks WHERE status="pending" AND deadline <= ? ORDER BY deadline ASC LIMIT 100',
    [current],
    async (err, rows) => {
      if (err) return console.error("[CRON DB ERROR]", err);
      if (!rows || !rows.length) return;
      const ids = rows.map((r) => r.id);
      db.run(
        `UPDATE tasks SET status='failed' WHERE id IN (${ids
          .map(() => "?")
          .join(",")})`,
        ids,
        async (uErr) => {
          if (uErr) return console.error("[CRON UPDATE ERROR]", uErr);
          for (const r of rows) {
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
