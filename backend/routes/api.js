const express = require('express');
const { Client } = require('@line/bot-sdk');
const db = require('../db');
const { env, line } = require('../config');

const router = express.Router();
const client = new Client(line);

router.use((req, res, next)=>{
  const k = req.headers['x-api-key'];
  if (!env.API_KEY) return res.status(403).json({ error: 'API disabled' });
  if (k !== env.API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
});

router.post('/logs', (req, res) => {
  const { line_user_id, project_id, task_id, type, note } = req.body||{};
  if (!line_user_id || !type) return res.status(400).json({ error: 'line_user_id and type required' });
  if (!['plan','do','check','act'].includes(String(type))) return res.status(400).json({ error: 'invalid type' });
  db.run('INSERT INTO logs(line_user_id,project_id,task_id,type,note) VALUES (?,?,?,?,?)', [line_user_id, project_id||null, task_id||null, String(type), note||null], function(err){
    if (err) return res.status(500).json({ error: 'db', detail: String(err) });
    res.json({ id: this?.lastID });
  });
});

router.get('/logs', (req, res) => {
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

router.get('/projects', (req, res) => {
  const { line_user_id } = req.query;
  if (!line_user_id) return res.status(400).json({ error: 'line_user_id required' });
  db.all("SELECT id,name,status,created_at,updated_at FROM projects WHERE line_user_id=? AND status='active' ORDER BY id DESC", [line_user_id], (e, rows)=>{
    if (e) return res.status(500).json({ error: 'db', detail: String(e) });
    res.json(rows||[]);
  });
});

router.post('/projects', (req, res) => {
  const { line_user_id, name } = req.body||{};
  if (!line_user_id || !name) return res.status(400).json({ error: 'line_user_id and name required' });
  db.run("INSERT INTO projects(line_user_id,name) VALUES(?,?)", [line_user_id, name], function(err){
    if (err) return res.status(500).json({ error: 'db', detail: String(err) });
    res.json({ id: this?.lastID, name });
  });
});

router.get('/tasks', (req, res) => {
  const { line_user_id, project_id, status='pending' } = req.query;
  if (!line_user_id) return res.status(400).json({ error: 'line_user_id required' });
  const conds = ['line_user_id=?'];
  const args = [line_user_id];
  if (project_id) { conds.push('project_id=?'); args.push(project_id); }
  if (status && status !== 'all') { conds.push('status=?'); args.push(status); }
  const where = 'WHERE '+conds.join(' AND ');
  db.all(`SELECT id,title,deadline,status,project_id,type,progress FROM tasks ${where} ORDER BY deadline ASC`, args, (e, rows)=>{
    if (e) return res.status(500).json({ error: 'db', detail: String(e) });
    res.json(rows||[]);
  });
});

router.post('/tasks', (req, res) => {
  const { line_user_id, title, deadline, project_id } = req.body||{};
  if (!line_user_id || !title || !deadline) return res.status(400).json({ error: 'line_user_id, title, deadline required' });
  db.run("INSERT INTO tasks(line_user_id,title,deadline,project_id) VALUES (?,?,?,?)", [line_user_id, title, deadline, project_id||null], function(err){
    if (err) return res.status(500).json({ error: 'db', detail: String(err) });
    res.json({ id: this?.lastID });
  });
});

router.patch('/tasks/:id', (req, res) => {
  const { id } = req.params;
  const { status } = req.body||{};
  if (!['pending','done','failed'].includes(String(status))) return res.status(400).json({ error: 'invalid status' });
  db.run("UPDATE tasks SET status=? WHERE id=?", [status, id], function(err){
    if (err) return res.status(500).json({ error: 'db', detail: String(err) });
    res.json({ updated: this?.changes||0 });
  });
});

router.get('/line-profile', async (req, res) => {
  try {
    const userId = String(req.query.user_id||'');
    if (!userId) return res.status(400).json({ error: 'user_id required' });
    const p = await client.getProfile(userId);
    res.json(p);
  } catch (e) {
    res.status(500).json({ error: 'line', detail: e?.response?.data || String(e) });
  }
});

module.exports = router;
