const express = require("express");
const { middleware, Client } = require("@line/bot-sdk");
const db = require("../db");
const { env, line } = require("../config");
const { parse } = require("../commands");
const { URLSearchParams } = require("url");

const router = express.Router();
const client = new Client(line);
// In-memory lightweight session for guided add flow
const addSessions = new Map(); // key: userId -> { step: 'wait_title'|'choose_deadline', title: string }

function appBaseFromReq(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return env.PUBLIC_APP_URL || (host ? `${proto}://${host}` : null);
}

function quickReplyDefaults() {
  return {
    items: [
      {
        type: "action",
        action: { type: "message", label: "追加", text: "追加" },
      },
      {
        type: "action",
        action: { type: "message", label: "未完了", text: "ls" },
      },
      {
        type: "action",
        action: { type: "message", label: "長期", text: "lsl" },
      },
      {
        type: "action",
        action: { type: "message", label: "URL", text: "url" },
      },
      {
        type: "action",
        action: { type: "message", label: "MyID", text: "whoami" },
      },
    ],
  };
}

async function replyTextWithQuick(client, replyToken, text) {
  return client.replyMessage(replyToken, {
    type: "text",
    text,
    quickReply: quickReplyDefaults(),
  });
}

router.post("/webhook", middleware(line), async (req, res) => {
  const events = req.body.events || [];
  // Respond immediately to avoid LINE retries/timeouts; handle events async
  res.sendStatus(200);
  if (!events.length) return;
  try {
    await Promise.all(
      events.map(async (e) => {
        // Postback quick actions (e.g., done?id=123)
        if (e.type === "postback" && e.postback?.data) {
          const params = new URLSearchParams(e.postback.data);
          const action = params.get("action");
          const u = e.source.userId;
          // Guided Add: create task from preset or datetimepicker
          if (action === "add-create") {
            const sess = addSessions.get(u);
            const title = sess?.title;
            if (!title) {
              return replyTextWithQuick(
                client,
                e.replyToken,
                "タイトルが未設定です。\n『追加』→ タイトル送信の順で操作してください。"
              );
            }
            // Compute deadline
            let deadline = null;
            const preset = params.get("preset");
            const now = new Date();
            const pad = (n) => String(n).padStart(2, "0");
            const fmt = (d, hh = "09", mm = "00") =>
              `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
                d.getDate()
              )} ${hh}:${mm}`;
            const nextWeekday = () => {
              const d = new Date();
              do {
                d.setDate(d.getDate() + 1);
              } while ([0, 6].includes(d.getDay()));
              return d;
            };
            if (e.postback.params?.datetime) {
              const dt = new Date(e.postback.params.datetime);
              if (!isNaN(dt.getTime())) {
                deadline = fmt(dt, pad(dt.getHours()), pad(dt.getMinutes()));
              }
            } else if (preset === "today21") {
              deadline = fmt(now, "21", "00");
            } else if (preset === "tomorrow09") {
              const d = new Date(now.getTime());
              d.setDate(d.getDate() + 1);
              deadline = fmt(d, "09", "00");
            } else if (preset === "nextweekday09") {
              const d = nextWeekday();
              deadline = fmt(d, "09", "00");
            } else if (preset === "none") {
              deadline = null;
            }
            db.run(
              "INSERT INTO tasks(line_user_id,title,deadline) VALUES (?,?,?)",
              [u, title, deadline],
              () => {
                addSessions.delete(u);
                replyTextWithQuick(
                  client,
                  e.replyToken,
                  `登録OK: ${deadline || "(期限なし)"} ${title}`
                );
              }
            );
            return;
          }
          if (action === "delete-task") {
            const id = Number(params.get("id"));
            if (id) {
              db.run("DELETE FROM tasks WHERE id=? AND line_user_id=?", [
                id,
                u,
              ]);
              return replyTextWithQuick(
                client,
                e.replyToken,
                `削除しました: ${id}`
              );
            }
          }
          if (action === "cancel") {
            return replyTextWithQuick(
              client,
              e.replyToken,
              "キャンセルしました。"
            );
          }
          if (action === "done") {
            const id = Number(params.get("id"));
            if (id) {
              db.run(
                'UPDATE tasks SET status="done" WHERE id=? AND line_user_id=?',
                [id, u]
              );
              return replyTextWithQuick(client, e.replyToken, `完了: ${id}`);
            }
          }
          if (action === "open-app") {
            const base = appBaseFromReq(req);
            const text = base
              ? `アプリURL: ${base}`
              : "アプリURLが未設定です (PUBLIC_APP_URL を設定してください)";
            return replyTextWithQuick(client, e.replyToken, text);
          }
          // Fallback menu
          return client.replyMessage(e.replyToken, {
            type: "template",
            altText: "メニュー",
            template: {
              type: "buttons",
              title: "操作メニュー",
              text: "よく使う操作を選択",
              actions: [
                { type: "message", label: "未完了", text: "ls" },
                { type: "message", label: "長期", text: "lsl" },
                { type: "message", label: "MyID", text: "whoami" },
                {
                  type: "uri",
                  label: "アプリ",
                  uri: appBaseFromReq(req) || "https://example.com",
                },
              ],
            },
          });
        }
        if (e.type !== "message" || e.message.type !== "text") return;
        const u = e.source.userId;
        const textRaw = (e.message.text || "").trim();
        // Guided Add flow: start
        if (["追加", "+"].includes(textRaw)) {
          addSessions.set(u, { step: "wait_title" });
          return client.replyMessage(e.replyToken, {
            type: "text",
            text: "タイトルを送ってください (例: 資料作成)",
            quickReply: {
              items: [
                {
                  type: "action",
                  action: {
                    type: "message",
                    label: "キャンセル",
                    text: "キャンセル",
                  },
                },
              ],
            },
          });
        }
        if (["キャンセル", "cancel"].includes(textRaw)) {
          if (addSessions.has(u)) addSessions.delete(u);
          return replyTextWithQuick(
            client,
            e.replyToken,
            "キャンセルしました。"
          );
        }
        // If waiting for title, capture and ask for deadline
        const sess = addSessions.get(u);
        if (sess?.step === "wait_title") {
          const title = textRaw;
          if (!title)
            return replyTextWithQuick(
              client,
              e.replyToken,
              "タイトルが空です。"
            );
          addSessions.set(u, { step: "choose_deadline", title });
          return client.replyMessage(e.replyToken, {
            type: "template",
            altText: "期限を選択",
            template: {
              type: "buttons",
              title: "期限を選択",
              text: `『${title}』の期限を選んでください`,
              actions: [
                {
                  type: "postback",
                  label: "期限なし",
                  data: "action=add-create&preset=none",
                },
                {
                  type: "postback",
                  label: "今日21時",
                  data: "action=add-create&preset=today21",
                },
                {
                  type: "postback",
                  label: "明日9時",
                  data: "action=add-create&preset=tomorrow09",
                },
                {
                  type: "datetimepicker",
                  label: "日時指定",
                  data: "action=add-create",
                  mode: "datetime",
                },
              ],
            },
          });
        }
        const cmd = parse(textRaw);
        if (cmd.type === "app_url") {
          // Prefer explicit PUBLIC_APP_URL; fallback to inferring from Host header
          const base = appBaseFromReq(req);
          const text = base
            ? `アプリURL: ${base}`
            : "アプリURLが未設定です (PUBLIC_APP_URL を設定してください)";
          return replyTextWithQuick(client, e.replyToken, text);
        }

        if (cmd.type === "whoami") {
          return replyTextWithQuick(
            client,
            e.replyToken,
            `あなたのLINE User ID: ${u}\nこのIDを /app に入力すると、同じデータが閲覧できます。`
          );
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
          return replyTextWithQuick(
            client,
            e.replyToken,
            "このグループを監視先に登録しました。"
          );
        }

        if (cmd.type === "add") {
          db.run(
            "INSERT INTO tasks(line_user_id,title,deadline) VALUES (?,?,?)",
            [u, cmd.title, cmd.deadline || null]
          );
          return replyTextWithQuick(
            client,
            e.replyToken,
            `登録OK: ${cmd.deadline || "(期限なし)"} ${cmd.title}`
          );
        }

        if (cmd.type === "project_add") {
          db.run(
            "INSERT INTO projects(line_user_id,name) VALUES(?,?)",
            [u, cmd.name],
            function () {
              const id = this?.lastID;
              replyTextWithQuick(
                client,
                e.replyToken,
                `P追加OK: ${id}: ${cmd.name}`
              );
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
              replyTextWithQuick(client, e.replyToken, text);
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
              replyTextWithQuick(
                client,
                e.replyToken,
                `P${cmd.projectId} に登録OK: ${cmd.deadline || "(期限なし)"} ${
                  cmd.title
                }`
              );
            }
          );
          return;
        }

        if (cmd.type === "list_project_tasks") {
          db.all(
            'SELECT id,title,deadline,status,importance FROM tasks WHERE line_user_id=? AND project_id=? AND status="pending" ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC LIMIT 20',
            [u, cmd.projectId],
            (err, rows) => {
              const text = err
                ? "エラー"
                : rows?.length
                ? rows
                    .map((r) => {
                      const urgency = (() => {
                        if (!r.deadline) return "低";
                        const t = Date.parse(
                          String(r.deadline).replace(" ", "T")
                        );
                        if (Number.isNaN(t)) return "低";
                        const diffDays =
                          (t - Date.now()) / (24 * 60 * 60 * 1000);
                        if (diffDays <= 3) return "高";
                        if (diffDays <= 7) return "中";
                        return "低";
                      })();
                      const imp = r.importance
                        ? `・重要度:${r.importance}`
                        : "";
                      return `${r.id}: [${r.deadline || "-"}] ${
                        r.title
                      } ・緊急度:${urgency}${imp}`;
                    })
                    .join("\n")
                : "未達タスクなし";
              replyTextWithQuick(client, e.replyToken, text);
            }
          );
          return;
        }

        if (cmd.type === "add_long") {
          db.run(
            "INSERT INTO tasks(line_user_id,title,deadline,type,progress,last_progress_at) VALUES (?,?,?,?,?,datetime('now','localtime'))",
            [u, cmd.title, cmd.deadline || null, "long", 0]
          );
          return replyTextWithQuick(
            client,
            e.replyToken,
            `長期 追加OK: ${cmd.deadline || "(期限なし)"} ${cmd.title}`
          );
        }

        if (cmd.type === "list") {
          db.all(
            'SELECT id,title,deadline,importance FROM tasks WHERE line_user_id=? AND status="pending" ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC LIMIT 10',
            [u],
            (err, rows) => {
              const text = err
                ? "エラー"
                : rows.length
                ? rows
                    .map((r) => {
                      const urgency = (() => {
                        if (!r.deadline) return "低";
                        const t = Date.parse(
                          String(r.deadline).replace(" ", "T")
                        );
                        if (Number.isNaN(t)) return "低";
                        const diffDays =
                          (t - Date.now()) / (24 * 60 * 60 * 1000);
                        if (diffDays <= 3) return "高";
                        if (diffDays <= 7) return "中";
                        return "低";
                      })();
                      const imp = r.importance
                        ? `・重要度:${r.importance}`
                        : "";
                      return `${r.id}: [${r.deadline || "-"}] ${
                        r.title
                      } ・緊急度:${urgency}${imp}`;
                    })
                    .join("\n")
                : "未達タスクなし";
              replyTextWithQuick(client, e.replyToken, text);
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
          return replyTextWithQuick(client, e.replyToken, `完了: ${cmd.id}`);
        }

        if (cmd.type === "progress") {
          db.run(
            "UPDATE tasks SET progress=?, updated_at=datetime('now','localtime'), last_progress_at=datetime('now','localtime') WHERE id=? AND line_user_id=? AND type='long'",
            [cmd.progress, cmd.id, u]
          );
          return replyTextWithQuick(
            client,
            e.replyToken,
            `進捗更新: ${cmd.id} → ${cmd.progress}%`
          );
        }

        if (cmd.type === "error") {
          return replyTextWithQuick(client, e.replyToken, cmd.msg);
        }

        // Fallback: show a buttons menu for easier discovery
        const base = appBaseFromReq(req) || "";
        return client.replyMessage(e.replyToken, {
          type: "template",
          altText: "メニュー: よく使う操作",
          template: {
            type: "buttons",
            title: "操作メニュー",
            text: "ボタンから選べます",
            actions: [
              { type: "message", label: "未完了", text: "ls" },
              { type: "message", label: "長期", text: "lsl" },
              { type: "message", label: "MyID", text: "whoami" },
              {
                type: "uri",
                label: "アプリ",
                uri: base || "https://example.com",
              },
            ],
          },
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
