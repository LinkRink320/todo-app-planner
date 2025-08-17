// src/server.js（完成版：DB連動の add / ls / done 対応）
require("dotenv").config();
const express = require("express");
const { middleware, Client } = require("@line/bot-sdk");
const cron = require("node-cron");
const db = require("./db"); // ★追加
const { parse } = require("./commands"); // ★追加

const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const client = new Client(config);
const app = express();

// ヘルスチェック
app.get("/", (_, res) => res.send("ok"));

// ★ここを差し替え（返信"こんにちは"→DB連動コマンド）
app.post("/line/webhook", middleware(config), async (req, res) => {
  const events = req.body.events || [];
  try {
    await Promise.all(
      events.map(async (e) => {
        if (e.type !== "message" || e.message.type !== "text") return;

        const u = e.source.userId;
        const cmd = parse(e.message.text);

        // グループ内での監視登録
        if (cmd.type === "watch_here") {
          if (e.source.type !== "group" || !e.source.groupId) {
            return client.replyMessage(e.replyToken, {
              type: "text",
              text: 'このコマンドはグループで実行してください（Botを招待の上、"watch here"）。',
            });
          }
          const gid = e.source.groupId;
          // 既存を削除して最新を保存（1ユーザー:1グループ運用）
          await new Promise((resolve) =>
            db.run(
              "DELETE FROM groups WHERE owner_line_user_id=?",
              [u],
              resolve
            )
          );
          await new Promise((resolve) =>
            db.run(
              "INSERT INTO groups(group_id, owner_line_user_id) VALUES (?,?)",
              [gid, u],
              resolve
            )
          );
          return client.replyMessage(e.replyToken, {
            type: "text",
            text: "このグループを監視先に登録しました。",
          });
        }

        if (cmd.type === "add") {
          db.run(
            "INSERT INTO tasks(line_user_id,title,deadline) VALUES (?,?,?)",
            [u, cmd.title, cmd.deadline]
          );
          return client.replyMessage(e.replyToken, {
            type: "text",
            text: `登録OK: ${cmd.deadline} ${cmd.title}`,
          });
        }

        if (cmd.type === "list") {
          db.all(
            'SELECT id,title,deadline FROM tasks WHERE line_user_id=? AND status="pending" ORDER BY deadline ASC LIMIT 10',
            [u],
            (err, rows) => {
              const text = err
                ? "エラー"
                : rows.length
                ? rows
                    .map((r) => `${r.id}: [${r.deadline}] ${r.title}`)
                    .join("\n")
                : "未達タスクなし";
              client.replyMessage(e.replyToken, { type: "text", text });
            }
          );
          return;
        }

        if (cmd.type === "done") {
          db.run(
            'UPDATE tasks SET status="done" WHERE id=? AND line_user_id=?',
            [cmd.id, u]
          );
          return client.replyMessage(e.replyToken, {
            type: "text",
            text: `完了: ${cmd.id}`,
          });
        }

        if (cmd.type === "error") {
          return client.replyMessage(e.replyToken, {
            type: "text",
            text: cmd.msg,
          });
        }

        return client.replyMessage(e.replyToken, {
          type: "text",
          text: "使い方: add YYYY-MM-DD HH:mm タイトル / ls / done {id} / watch here(グループで)",
        });
      })
    );
    res.sendStatus(200);
  } catch (err) {
    console.error(
      "[REPLY ERROR]",
      err?.statusCode,
      err?.originalError?.response?.data || err
    );
    res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => console.log("server ready"));

// ───────────────────────────────────────────────────────────────
// 期限チェック（毎分）: 期限超過 & pending → failed に更新し通知
// 保存フォーマットは "YYYY-MM-DD HH:mm"（ローカル時刻として比較）
cron.schedule("* * * * *", async () => {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  // ローカルのYYYY-MM-DD HH:mmに丸め
  const current = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  // 30分前/5分前リマインド
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
          try { await client.pushMessage(r.line_user_id, { type: 'text', text }); } catch (e) { console.error('[PUSH remind ERROR]', e?.response?.data || e); }
        }
      }
    );
  };
  sendReminders(target30, '30分前');
  sendReminders(target05, '5分前');
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
            // 本人へ
            try {
              await client.pushMessage(r.line_user_id, msg);
            } catch (e) {
              console.error("[PUSH user ERROR]", e?.response?.data || e);
            }
            // 監視グループへ
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
