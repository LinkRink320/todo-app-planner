import React, { useEffect, useState } from "react";

export default function Todos({ taskId, getHeaders, onChanged }) {
  const [todos, setTodos] = useState([]);
  const [newTitle, setNewTitle] = useState("");
  const [newEst, setNewEst] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newDetails, setNewDetails] = useState("");
  const [err, setErr] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editVals, setEditVals] = useState({
    title: "",
    estimated_minutes: "",
    url: "",
    details_md: "",
  });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function load() {
    try {
      const r = await fetch(`/api/todos?task_id=${taskId}`, {
        headers: await getHeaders(),
      });
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
      body: JSON.stringify({
        task_id: taskId,
        title,
        estimated_minutes: newEst ? Number(newEst) : null,
        url: newUrl || null,
        details_md: newDetails || null,
      }),
    });
    if (!r.ok) return;
    setNewTitle("");
    setNewEst("");
    setNewUrl("");
    setNewDetails("");
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
    const r = await fetch(`/api/todos/${id}`, {
      method: "DELETE",
      headers: await getHeaders(),
    });
    if (!r.ok) return;
    await load();
    onChanged && onChanged();
  }

  function startEdit(td) {
    setEditingId(td.id);
    setEditVals({
      title: td.title || "",
      estimated_minutes:
        typeof td.estimated_minutes === "number" ? td.estimated_minutes : "",
      url: td.url || "",
      details_md: td.details_md || "",
    });
  }

  async function saveEdit(id) {
    const body = {
      title: editVals.title?.trim() || null,
      estimated_minutes:
        editVals.estimated_minutes === "" || editVals.estimated_minutes == null
          ? null
          : Number(editVals.estimated_minutes),
      url: editVals.url || null,
      details_md: editVals.details_md || null,
    };
    const r = await fetch(`/api/todos/${id}`, {
      method: "PATCH",
      headers: await getHeaders(),
      body: JSON.stringify(body),
    });
    if (!r.ok) return;
    setEditingId(null);
    await load();
    onChanged && onChanged();
  }

  return (
    <div
      style={{
        padding: 8,
        background: "#fafafa",
        borderRadius: 8,
        border: "1px solid #eee",
        marginTop: 6,
      }}
    >
      {err && (
        <div className="alert error" style={{ marginBottom: 6 }}>
          {err}
        </div>
      )}
      <div className="grid-2" style={{ marginBottom: 8 }}>
        <input
          placeholder="Todo を追加"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <button onClick={add}>追加</button>
      </div>
      <div className="grid-2" style={{ marginBottom: 8 }}>
        <input
          type="number"
          min="0"
          placeholder="所要時間(分) 任意"
          value={newEst}
          onChange={(e) => setNewEst(e.target.value)}
        />
        <span />
      </div>
      <div className="grid-2" style={{ marginBottom: 8 }}>
        <input
          placeholder="関連URL(任意)"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
        />
        <span />
      </div>
      <div style={{ marginBottom: 8 }}>
        <textarea
          rows={3}
          placeholder="詳細(マークダウン可) 任意"
          value={newDetails}
          onChange={(e) => setNewDetails(e.target.value)}
        />
      </div>
      <ul className="list" style={{ margin: 0 }}>
        {todos.length === 0 ? (
          <li style={{ color: "#777", padding: "6px 0" }}>Todoはありません</li>
        ) : (
          todos.map((td) => (
            <li
              key={td.id}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <input
                type="checkbox"
                checked={!!td.done}
                onChange={() => toggle(td.id, !!td.done)}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    textDecoration: td.done ? "line-through" : "none",
                    color: td.done ? "#999" : undefined,
                  }}
                >
                  {td.title}
                  {typeof td.estimated_minutes === "number"
                    ? ` ・ ${td.estimated_minutes}分`
                    : ""}
                  {td.url ? " ・ 🔗" : ""}
                </div>
                {editingId === td.id && (
                  <div
                    style={{
                      marginTop: 6,
                      background: "#fff",
                      border: "1px solid #eee",
                      borderRadius: 6,
                      padding: 6,
                    }}
                  >
                    <div className="grid-2" style={{ marginBottom: 6 }}>
                      <input
                        placeholder="タイトル"
                        value={editVals.title}
                        onChange={(e) =>
                          setEditVals({ ...editVals, title: e.target.value })
                        }
                      />
                      <input
                        type="number"
                        min="0"
                        placeholder="所要時間(分)"
                        value={editVals.estimated_minutes}
                        onChange={(e) =>
                          setEditVals({
                            ...editVals,
                            estimated_minutes: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="grid-2" style={{ marginBottom: 6 }}>
                      <input
                        placeholder="関連URL"
                        value={editVals.url}
                        onChange={(e) =>
                          setEditVals({ ...editVals, url: e.target.value })
                        }
                      />
                      <span />
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <textarea
                        rows={3}
                        placeholder="詳細(マークダウン可)"
                        value={editVals.details_md}
                        onChange={(e) =>
                          setEditVals({
                            ...editVals,
                            details_md: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => saveEdit(td.id)}>保存</button>
                      <button
                        className="ghost"
                        onClick={() => setEditingId(null)}
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {editingId === td.id ? null : (
                <button
                  className="ghost"
                  onClick={() => startEdit(td)}
                  title="編集"
                >
                  ✎
                </button>
              )}
              <button
                className="ghost"
                onClick={() => remove(td.id)}
                title="削除"
              >
                ×
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
