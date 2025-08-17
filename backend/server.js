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
