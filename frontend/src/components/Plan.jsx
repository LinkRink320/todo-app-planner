import React, { useEffect, useMemo, useState } from "react";

export default function Plan({ userId, getHeaders }) {
  const [date, setDate] = useState(() => today());
  const [plan, setPlan] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [todos, setTodos] = useState([]);
  const [q, setQ] = useState("");
  const [source, setSource] = useState("tasks"); // 'tasks' | 'todos'
  const [blockFilter, setBlockFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    if (!plan?.items) return [];
    return plan.items.filter((i) => !blockFilter || i.block === blockFilter);
  }, [plan, blockFilter]);

  useEffect(() => {
    if (!userId) return;
    ensurePlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, date]);

  async function ensurePlan() {
    await fetch(`/api/plans`, {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify({ line_user_id: userId, date }),
    });
    await load();
  await loadTasks();
  await loadTodos();
  }

  async function load() {
    const r = await fetch(
      `/api/plans?line_user_id=${encodeURIComponent(userId)}&date=${date}`,
      { headers: await getHeaders() }
    );
    if (r.ok) setPlan(await r.json());
  }

  async function loadTasks() {
    const qs = new URLSearchParams({ line_user_id: userId, status: "pending" });
    if (q) qs.set("q", q);
    const r = await fetch(`/api/tasks?${qs.toString()}`, {
      headers: await getHeaders(),
    });
    if (r.ok) setTasks(await r.json());
  }

  async function loadTodos() {
    const qs = new URLSearchParams({ line_user_id: userId });
    const r = await fetch(`/api/todos/by-user?${qs.toString()}`, {
      headers: await getHeaders(),
    });
    if (r.ok) setTodos(await r.json());
  }

  async function addTask(taskId, opts = {}) {
    if (!plan?.id) return;
    setBusy(true);
    await fetch(`/api/plans/${plan.id}/items`, {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify({ task_id: taskId, ...opts }),
    });
    await load();
    setBusy(false);
  }

  async function addTodo(todoId, opts = {}) {
    if (!plan?.id) return;
    setBusy(true);
    await fetch(`/api/plans/${plan.id}/items`, {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify({ todo_id: todoId, ...opts }),
    });
    await load();
    setBusy(false);
  }

  async function remove(itemId) {
    if (!plan?.id) return;
    setBusy(true);
    await fetch(`/api/plans/${plan.id}/items/${itemId}`, {
      method: "DELETE",
      headers: await getHeaders(),
    });
    await load();
    setBusy(false);
  }

  async function reorder(newOrder) {
    if (!plan?.id) return;
    await fetch(`/api/plans/${plan.id}/items/reorder`, {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify({ orderedIds: newOrder }),
    });
    await load();
  }

  async function patchItem(itemId, patch) {
    if (!plan?.id) return;
    await fetch(`/api/plans/${plan.id}/items/${itemId}`, {
      method: "PATCH",
      headers: await getHeaders(),
      body: JSON.stringify(patch),
    });
    await load();
  }

  function move(itemId, dir) {
    if (!plan?.items) return;
    const ids = plan.items.map((i) => i.id);
    const idx = ids.indexOf(itemId);
    if (idx < 0) return;
    const j = idx + (dir === "up" ? -1 : 1);
    if (j < 0 || j >= ids.length) return;
    const arr = [...ids];
    const a = arr[idx];
    arr[idx] = arr[j];
    arr[j] = a;
    reorder(arr);
  }

  return (
    <div className="panel" style={{ marginTop: 8 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <strong>プラン</strong>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="row">
          <select
            value={blockFilter}
            onChange={(e) => setBlockFilter(e.target.value)}
          >
            <option value="">全て</option>
            <option value="morning">午前</option>
            <option value="afternoon">午後</option>
            <option value="evening">夜</option>
          </select>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 8 }}>
        <div>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontWeight: 600 }}>候補（未完了）</div>
            <div className="row">
              <label className="row" style={{ gap: 4 }}>
                <input
                  type="radio"
                  checked={source === "tasks"}
                  onChange={() => setSource("tasks")}
                />
                タスク
              </label>
              <label className="row" style={{ gap: 4 }}>
                <input
                  type="radio"
                  checked={source === "todos"}
                  onChange={() => setSource("todos")}
                />
                Todo
              </label>
            </div>
          </div>
          <div className="grid-2" style={{ marginBottom: 8 }}>
            <input
              placeholder="検索"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && (source === "tasks" ? loadTasks() : loadTodos())
              }
            />
            <button onClick={source === "tasks" ? loadTasks : loadTodos}>検索</button>
          </div>
          {source === "tasks" ? (
            <ul className="list" style={{ maxHeight: 260, overflow: "auto" }}>
              {tasks.map((t) => (
                <li key={t.id} className="row" style={{ justifyContent: "space-between" }}>
                  <span>{t.title}</span>
                  <div className="row">
                    <button disabled={busy} onClick={() => addTask(t.id, { block: "morning" })}>午前</button>
                    <button disabled={busy} onClick={() => addTask(t.id, { block: "afternoon" })}>午後</button>
                    <button disabled={busy} onClick={() => addTask(t.id, { block: "evening" })}>夜</button>
                    <button className="ghost" disabled={busy} onClick={() => addTask(t.id, { rocket: true })}>Rocket</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="list" style={{ maxHeight: 260, overflow: "auto" }}>
              {todos.map((td) => (
                <li key={td.id} className="row" style={{ justifyContent: "space-between" }}>
                  <span>
                    {td.title}
                    <span style={{ color: "#999", marginLeft: 6, fontSize: 12 }}>
                      （{td.task_title}）
                    </span>
                  </span>
                  <div className="row">
                    <button disabled={busy} onClick={() => addTodo(td.id, { block: "morning" })}>午前</button>
                    <button disabled={busy} onClick={() => addTodo(td.id, { block: "afternoon" })}>午後</button>
                    <button disabled={busy} onClick={() => addTodo(td.id, { block: "evening" })}>夜</button>
                    <button className="ghost" disabled={busy} onClick={() => addTodo(td.id, { rocket: true })}>Rocket</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>当日のプラン</div>
          <ul className="list">
            {filtered.map((it, idx) => (
              <li key={it.id} className="row" style={{ alignItems: "stretch" }}>
                <div style={{ flex: 1 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span>#{idx + 1}</span>
                    <div className="row">
                      <button className="ghost" onClick={() => move(it.id, "up")}>↑</button>
                      <button className="ghost" onClick={() => move(it.id, "down")}>↓</button>
                      <button className="ghost" onClick={() => remove(it.id)}>×</button>
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: 4 }}>
                    <select
                      value={it.block || ""}
                      onChange={(e) => patchItem(it.id, { block: e.target.value || null })}
                    >
                      <option value="">未指定</option>
                      <option value="morning">午前</option>
                      <option value="afternoon">午後</option>
                      <option value="evening">夜</option>
                    </select>
                    <div className="row">
                      <input
                        type="number"
                        min={0}
                        placeholder="見積(分)"
                        value={it.planned_minutes || ""}
                        onChange={(e) => patchItem(it.id, { planned_minutes: e.target.value ? Number(e.target.value) : null })}
                        style={{ width: 120 }}
                      />
                      <label className="row" style={{ gap: 4 }}>
                        <input
                          type="checkbox"
                          checked={!!it.rocket}
                          onChange={(e) => patchItem(it.id, { rocket: e.target.checked })}
                        />
                        Rocket
                      </label>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
