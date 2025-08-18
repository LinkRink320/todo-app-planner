import React, { useEffect, useState } from "react";

export default function Todos({ taskId, getHeaders, onChanged }) {
  const [todos, setTodos] = useState([]);
  const [newTitle, setNewTitle] = useState("");
  const [newEst, setNewEst] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function load() {
    try {
      const r = await fetch(`/api/todos?task_id=${taskId}`, { headers: await getHeaders() });
      if (!r.ok) throw new Error(`todos ${r.status}`);
      setTodos(await r.json());
    } catch (e) {
      setErr(String(e.message || e));
      setTimeout(() => setErr(""), 3000);
    }
  }

  async function add() {
    const title = newTitle.trim();
    if (!title) return;
    const r = await fetch("/api/todos", {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify({ task_id: taskId, title, estimated_minutes: newEst ? Number(newEst) : null }),
    });
    if (!r.ok) return;
    setNewTitle("");
    setNewEst("");
    await load();
    onChanged && onChanged();
  }

  async function toggle(id, done) {
    const r = await fetch(`/api/todos/${id}`, {
      method: "PATCH",
      headers: await getHeaders(),
      body: JSON.stringify({ done: !done }),
    });
    if (!r.ok) return;
    await load();
    onChanged && onChanged();
  }

  async function remove(id) {
    const r = await fetch(`/api/todos/${id}`, { method: "DELETE", headers: await getHeaders() });
    if (!r.ok) return;
    await load();
    onChanged && onChanged();
  }

  return (
    <div style={{ padding: 8, background: "#fafafa", borderRadius: 8, border: "1px solid #eee", marginTop: 6 }}>
      {err && <div className="alert error" style={{ marginBottom: 6 }}>{err}</div>}
      <div className="grid-2" style={{ marginBottom: 8 }}>
        <input placeholder="Todo を追加" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
        <button onClick={add}>追加</button>
      </div>
      <div className="grid-2" style={{ marginBottom: 8 }}>
        <input type="number" min="0" placeholder="所要時間(分) 任意" value={newEst} onChange={(e) => setNewEst(e.target.value)} />
        <span />
      </div>
      <ul className="list" style={{ margin: 0 }}>
        {todos.length === 0 ? (
          <li style={{ color: "#777", padding: "6px 0" }}>Todoはありません</li>
        ) : (
          todos.map((td) => (
            <li key={td.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={!!td.done} onChange={() => toggle(td.id, !!td.done)} />
              <div style={{ flex: 1, textDecoration: td.done ? "line-through" : "none", color: td.done ? "#999" : undefined }}>
                {td.title}
                {typeof td.estimated_minutes === 'number' ? ` ・ ${td.estimated_minutes}分` : ''}
              </div>
              <button className="ghost" onClick={() => remove(td.id)} title="削除">×</button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
