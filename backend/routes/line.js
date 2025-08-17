const express = require("express");
const { middleware, Client } = require("@line/bot-sdk");
const db = require("../db");
const { env, line } = require("../config");
const { parse } = require("../commands");

const router = express.Router();
const client = new Client(line);

router.post("/webhook", middleware(line), async (req, res) => {
  const events = req.body.events || [];
  // Respond immediately to avoid LINE retries/timeouts; handle events async
  res.sendStatus(200);
  if (!events.length) return;
  try {
    await Promise.all(
  events.map(async (e) => {
        if (e.type !== "message" || e.message.type !== "text") return;
        const u = e.source.userId;
        const cmd = parse(e.message.text);
        if (cmd.type === "app_url") {
          // Prefer explicit PUBLIC_APP_URL; fallback to inferring from Host header
          const host = req.headers["x-forwarded-host"] || req.headers.host;
          const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
          const base = env.PUBLIC_APP_URL || (host ? `${proto}://${host}` : null);
          const text = base ? `アプリURL: ${base}` : "アプリURLが未設定です (PUBLIC_APP_URL を設定してください)";
          return client.replyMessage(e.replyToken, { type: "text", text });
        }

        if (cmd.type === "whoami") {
          return client.replyMessage(e.replyToken, {
            type: "text",
            text: `あなたのLINE User ID: ${u}\nこのIDを /app に入力すると、同じデータが閲覧できます。`,
          });
        }

        if (cmd.type === "watch_here") {
          if (e.source.type !== "group" || !e.source.groupId) {
            return client.replyMessage(e.replyToken, {
              type: "text",
              text: 'このコマンドはグループで実行してください（Botを招待の上、"watch here"）。',
            });
          }
          const gid = e.source.groupId;
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
            [u, cmd.title, cmd.deadline || null]
          );
          return client.replyMessage(e.replyToken, {
            type: "text",
            text: `登録OK: ${(cmd.deadline || "(期限なし)")} ${cmd.title}`,
          });
        }

        if (cmd.type === "project_add") {
          db.run(
            "INSERT INTO projects(line_user_id,name) VALUES(?,?)",
            [u, cmd.name],
            function () {
              const id = this?.lastID;
              client.replyMessage(e.replyToken, {
                type: "text",
                text: `P追加OK: ${id}: ${cmd.name}`,
              });
            }
          );
          return;
        }

        if (cmd.type === "project_list") {
          db.all(
            "SELECT id,name,status FROM projects WHERE line_user_id=? AND status='active' ORDER BY id DESC LIMIT 20",
            [u],
            (err, rows) => {
              const text = err
                ? "エラー"
                : rows?.length
                ? rows.map((r) => `${r.id}: ${r.name}`).join("\n")
                : "プロジェクトなし";
              client.replyMessage(e.replyToken, { type: "text", text });
            }
          );
          return;
        }

        if (cmd.type === "add_project_task") {
          db.get(
            "SELECT id FROM projects WHERE id=? AND line_user_id=? AND status='active'",
            [cmd.projectId, u],
            (err, row) => {
              if (err || !row)
                return client.replyMessage(e.replyToken, {
                  type: "text",
                  text: "プロジェクトが見つかりません",
                });
              db.run(
                "INSERT INTO tasks(line_user_id,title,deadline,project_id) VALUES (?,?,?,?)",
                [u, cmd.title, cmd.deadline || null, cmd.projectId]
              );
              client.replyMessage(e.replyToken, {
                type: "text",
                text: `P${cmd.projectId} に登録OK: ${(cmd.deadline || "(期限なし)")} ${cmd.title}`,
              });
            }
          );
          return;
        }

        if (cmd.type === "list_project_tasks") {
          db.all(
            'SELECT id,title,deadline,status FROM tasks WHERE line_user_id=? AND project_id=? AND status="pending" ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC LIMIT 20',
            [u, cmd.projectId],
            (err, rows) => {
              const text = err
                ? "エラー"
                : rows?.length
                ? rows
                    .map((r) => `${r.id}: [${r.deadline || "-"}] ${r.title}`)
                    .join("\n")
                : "未達タスクなし";
              client.replyMessage(e.replyToken, { type: "text", text });
            }
          );
          return;
        }

        if (cmd.type === "add_long") {
          db.run(
            "INSERT INTO tasks(line_user_id,title,deadline,type,progress,last_progress_at) VALUES (?,?,?,?,?,datetime('now','localtime'))",
            [u, cmd.title, cmd.deadline || null, "long", 0]
          );
          return client.replyMessage(e.replyToken, {
            type: "text",
            text: `長期 追加OK: ${(cmd.deadline || "(期限なし)")} ${cmd.title}`,
          });
        }

        if (cmd.type === "list") {
          db.all(
            'SELECT id,title,deadline FROM tasks WHERE line_user_id=? AND status="pending" ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC LIMIT 10',
            [u],
            (err, rows) => {
              const text = err
                ? "エラー"
                : rows.length
                ? rows
                    .map((r) => `${r.id}: [${r.deadline || "-"}] ${r.title}`)
                    .join("\n")
                : "未達タスクなし";
              client.replyMessage(e.replyToken, { type: "text", text });
            }
          );
          return;
        }

        if (cmd.type === "list_long") {
          db.all(
            'SELECT id,title,progress,deadline,updated_at FROM tasks WHERE line_user_id=? AND type="long" AND status!="done" ORDER BY COALESCE(updated_at, created_at) DESC, id DESC LIMIT 10',
            [u],
            (err, rows) => {
              let text = "長期なし";
              if (!err && rows?.length) {
                text = rows
                  .map(
                    (r) =>
                      `${r.id}: [${r.progress}%] ${r.title} (次の目安: ${r.deadline})`
                  )
                  .join("\n");
              }
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

        if (cmd.type === "progress") {
          db.run(
            "UPDATE tasks SET progress=?, updated_at=datetime('now','localtime'), last_progress_at=datetime('now','localtime') WHERE id=? AND line_user_id=? AND type='long'",
            [cmd.progress, cmd.id, u]
          );
          return client.replyMessage(e.replyToken, {
            type: "text",
            text: `進捗更新: ${cmd.id} → ${cmd.progress}%`,
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
          text:
            "使い方: whoami(=myid/id) / URL / add [YYYY-MM-DD HH:mm] タイトル / ls / done {id} / watch here(グループで) / addl [YYYY-MM-DD HH:mm] タイトル / lsl / prog {id} {0-100%} / padd 名称 / pls / addp {pid} [YYYY-MM-DD HH:mm] タイトル / lsp {pid}",
        });
      })
    );
  } catch (err) {
    console.error(
      "[REPLY ERROR]",
      err?.statusCode,
      err?.originalError?.response?.data || err
    );
  }
});

module.exports = router;
