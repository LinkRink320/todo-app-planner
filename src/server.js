// src/server.js（完成版：DB連動の add / ls / done 対応）
require('dotenv').config();
const express = require('express');
const { middleware, Client } = require('@line/bot-sdk');
const db = require('./db');                 // ★追加
const { parse } = require('./commands');    // ★追加

const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const client = new Client(config);
const app = express();

// ヘルスチェック
app.get('/', (_, res) => res.send('ok'));

// ★ここを差し替え（返信"こんにちは"→DB連動コマンド）
app.post('/line/webhook', middleware(config), async (req, res) => {
  const events = req.body.events || [];
  try {
    await Promise.all(events.map(async (e) => {
      if (e.type !== 'message' || e.message.type !== 'text') return;

      const u = e.source.userId;
      const cmd = parse(e.message.text);

      if (cmd.type === 'add') {
        db.run('INSERT INTO tasks(line_user_id,title,deadline) VALUES (?,?,?)',
          [u, cmd.title, cmd.deadline]);
        return client.replyMessage(e.replyToken, { type:'text', text:`登録OK: ${cmd.deadline} ${cmd.title}` });
      }

      if (cmd.type === 'list') {
        db.all(
          'SELECT id,title,deadline FROM tasks WHERE line_user_id=? AND status="pending" ORDER BY deadline ASC LIMIT 10',
          [u],
          (err, rows) => {
            const text = err ? 'エラー'
              : (rows.length ? rows.map(r => `${r.id}: [${r.deadline}] ${r.title}`).join('\n') : '未達タスクなし');
            client.replyMessage(e.replyToken, { type:'text', text });
          }
        );
        return;
      }

      if (cmd.type === 'done') {
        db.run('UPDATE tasks SET status="done" WHERE id=? AND line_user_id=?', [cmd.id, u]);
        return client.replyMessage(e.replyToken, { type:'text', text:`完了: ${cmd.id}` });
      }

      if (cmd.type === 'error') {
        return client.replyMessage(e.replyToken, { type:'text', text: cmd.msg });
      }

      return client.replyMessage(e.replyToken, {
        type: 'text',
        text: '使い方: add YYYY-MM-DD HH:mm タイトル / ls / done {id}'
      });
    }));
    res.sendStatus(200);
  } catch (err) {
    console.error('[REPLY ERROR]', err?.statusCode, err?.originalError?.response?.data || err);
    res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => console.log('server ready'));
