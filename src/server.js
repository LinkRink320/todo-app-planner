// src/server.js（完成版：DB連動の add / ls / done 対応）
require("dotenv").config();
const express = require("express");
const path = require('path');
const fs = require('fs');
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
// NOTE: Do not use global JSON parser before LINE middleware. Scope to /api only.
app.use('/api', express.json());

// ヘルスチェック
app.get("/", (_, res) => res.send("ok"));
// Static assets for web app
app.use('/static', express.static(path.join(__dirname, 'public')));
app.get('/app', (req, res) => {
  res.setHeader('Content-Type','text/html; charset=utf-8');
  fs.createReadStream(path.join(__dirname, 'app.html')).pipe(res);
});

// ── Minimal REST API (optional): API_KEY required in header x-api-key
const requireKey = (req, res, next) => {
  const k = req.headers['x-api-key'];
  if (!process.env.API_KEY) return res.status(403).json({ error: 'API disabled' });
  if (k !== process.env.API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
};

// Public config (no secrets leaked)
app.get('/api/config', (req, res) => {
  res.json({
    apiKeySet: Boolean(process.env.API_KEY),
    defaultLineUserId: process.env.DEFAULT_LINE_USER_ID || null,
    defaultLineUserName: process.env.DEFAULT_LINE_USER_NAME || null,
  });
});

// PDCA logs
app.post('/api/logs', requireKey, (req, res) => {
  const { line_user_id, project_id, task_id, type, note } = req.body||{};
  if (!line_user_id || !type) return res.status(400).json({ error: 'line_user_id and type required' });
  if (!['plan','do','check','act'].includes(String(type))) return res.status(400).json({ error: 'invalid type' });
  db.run(
    'INSERT INTO logs(line_user_id,project_id,task_id,type,note) VALUES (?,?,?,?,?)',
    [line_user_id, project_id||null, task_id||null, String(type), note||null],
    function(err){
      if (err) return res.status(500).json({ error: 'db', detail: String(err) });
      res.json({ id: this?.lastID });
    }
  );
});

app.get('/api/logs', requireKey, (req, res) => {
  const { line_user_id, project_id, task_id, limit=50 } = req.query;
  const conds = [];
  const args = [];
  if (line_user_id) { conds.push('line_user_id=?'); args.push(line_user_id); }
  if (project_id) { conds.push('project_id=?'); args.push(project_id); }
  if (task_id) { conds.push('task_id=?'); args.push(task_id); }
  const where = conds.length ? ('WHERE '+conds.join(' AND ')) : '';
  db.all(`SELECT * FROM logs ${where} ORDER BY id DESC LIMIT ?`, [...args, Number(limit)||50], (err, rows)=>{
    if (err) return res.status(500).json({ error: 'db', detail: String(err) });
    res.json(rows||[]);
  });
});

// Browse basics
app.get('/api/projects', requireKey, (req, res) => {
  const { line_user_id } = req.query;
  if (!line_user_id) return res.status(400).json({ error: 'line_user_id required' });
  db.all("SELECT id,name,status,created_at,updated_at FROM projects WHERE line_user_id=? AND status='active' ORDER BY id DESC", [line_user_id], (e, rows)=>{
    if (e) return res.status(500).json({ error: 'db', detail: String(e) });
    res.json(rows||[]);
  });
});

app.post('/api/projects', requireKey, (req, res) => {
  const { line_user_id, name } = req.body||{};
  if (!line_user_id || !name) return res.status(400).json({ error: 'line_user_id and name required' });
  db.run("INSERT INTO projects(line_user_id,name) VALUES(?,?)", [line_user_id, name], function(err){
    if (err) return res.status(500).json({ error: 'db', detail: String(err) });
    res.json({ id: this?.lastID, name });
  });
});

app.get('/api/tasks', requireKey, (req, res) => {
  const { line_user_id, project_id, status='pending' } = req.query;
  if (!line_user_id) return res.status(400).json({ error: 'line_user_id required' });
  const conds = ['line_user_id=?'];
  const args = [line_user_id];
  if (project_id) { conds.push('project_id=?'); args.push(project_id); }
  if (status) { conds.push('status=?'); args.push(status); }
  const where = 'WHERE '+conds.join(' AND ');
  db.all(`SELECT id,title,deadline,status,project_id FROM tasks ${where} ORDER BY deadline ASC`, args, (e, rows)=>{
    if (e) return res.status(500).json({ error: 'db', detail: String(e) });
    res.json(rows||[]);
  });
});

app.post('/api/tasks', requireKey, (req, res) => {
  const { line_user_id, title, deadline, project_id } = req.body||{};
  if (!line_user_id || !title || !deadline) return res.status(400).json({ error: 'line_user_id, title, deadline required' });
  db.run("INSERT INTO tasks(line_user_id,title,deadline,project_id) VALUES (?,?,?,?)", [line_user_id, title, deadline, project_id||null], function(err){
    if (err) return res.status(500).json({ error: 'db', detail: String(err) });
    res.json({ id: this?.lastID });
  });
});

// LINE profile lookup (useful to show display name in UI)
app.get('/api/line-profile', requireKey, async (req, res) => {
  try {
    const userId = String(req.query.user_id||'');
    if (!userId) return res.status(400).json({ error: 'user_id required' });
    const p = await client.getProfile(userId);
    res.json(p);
  } catch (e) {
    res.status(500).json({ error: 'line', detail: e?.response?.data || String(e) });
  }
});

app.patch('/api/tasks/:id', requireKey, (req, res) => {
  const { id } = req.params;
  const { status } = req.body||{};
  if (!['pending','done','failed'].includes(String(status))) return res.status(400).json({ error: 'invalid status' });
  db.run("UPDATE tasks SET status=? WHERE id=?", [status, id], function(err){
    if (err) return res.status(500).json({ error: 'db', detail: String(err) });
    res.json({ updated: this?.changes||0 });
  });
});

// ★ここを差し替え（返信"こんにちは"→DB連動コマンド）
app.post("/line/webhook", middleware(config), async (req, res) => {
  const events = req.body.events || [];
  try {
    await Promise.all(
      events.map(async (e) => {
        if (e.type !== "message" || e.message.type !== "text") return;

        const u = e.source.userId;
        const cmd = parse(e.message.text);

        // 自分のLINE User IDを返す
        if (cmd.type === 'whoami') {
          return client.replyMessage(e.replyToken, { type:'text', text:`あなたのLINE User ID: ${u}\nこのIDを /app に入力すると、同じデータが閲覧できます。` });
        }

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

        // プロジェクト作成
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

        // プロジェクト一覧
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

        // プロジェクトにタスク追加
        if (cmd.type === "add_project_task") {
          db.get(
            "SELECT id FROM projects WHERE id=? AND line_user_id=? AND status='active'",
            [cmd.projectId, u],
            (err, row) => {
              if (err || !row) {
                return client.replyMessage(e.replyToken, {
                  type: "text",
                  text: "プロジェクトが見つかりません",
                });
              }
              db.run(
                "INSERT INTO tasks(line_user_id,title,deadline,project_id) VALUES (?,?,?,?)",
                [u, cmd.title, cmd.deadline, cmd.projectId]
              );
              client.replyMessage(e.replyToken, {
                type: "text",
                text: `P${cmd.projectId} に登録OK: ${cmd.deadline} ${cmd.title}`,
              });
            }
          );
          return;
        }

        // プロジェクトのタスク一覧
        if (cmd.type === "list_project_tasks") {
          db.all(
            'SELECT id,title,deadline,status FROM tasks WHERE line_user_id=? AND project_id=? AND status="pending" ORDER BY deadline ASC LIMIT 20',
            [u, cmd.projectId],
            (err, rows) => {
              const text = err
                ? "エラー"
                : rows?.length
                ? rows
                    .map((r) => `${r.id}: [${r.deadline}] ${r.title}`)
                    .join("\n")
                : "未達タスクなし";
              client.replyMessage(e.replyToken, { type: "text", text });
            }
          );
          return;
        }

        // 長期: 追加（type='long'、progress=0）
        if (cmd.type === "add_long") {
          db.run(
            "INSERT INTO tasks(line_user_id,title,deadline,type,progress,last_progress_at) VALUES (?,?,?,?,?,datetime('now','localtime'))",
            [u, cmd.title, cmd.deadline, "long", 0]
          );
          return client.replyMessage(e.replyToken, {
            type: "text",
            text: `長期 追加OK: ${cmd.deadline} ${cmd.title}`,
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

        // 長期: 一覧（type='long' のみ）
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

        // 長期: 進捗更新 prog <id> <0-100>
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
          text: "使い方: whoami(=myid/id) / add YYYY-MM-DD HH:mm タイトル / ls / done {id} / watch here(グループで) / addl YYYY-MM-DD HH:mm タイトル / lsl / prog {id} {0-100%} / padd 名称 / pls / addp {pid} YYYY-MM-DD HH:mm タイトル / lsp {pid}",
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
