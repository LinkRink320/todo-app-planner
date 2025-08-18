import React, { useEffect, useMemo, useState } from "react";
import Board from "../components/Board.jsx";
import Calendar from "../components/Calendar.jsx";
import Week from "../components/Week.jsx";
import Todos from "../components/Todos.jsx";

function getSession(k) {
  try {
    return window.sessionStorage.getItem(k) || "";
  } catch {
    return "";
  }
}
function setSession(k, v) {
  try {
    window.sessionStorage.setItem(k, v);
  } catch {}
}

export default function App() {
  const [api, setApi] = useState(getSession("API_KEY"));
  const [uid, setUid] = useState(getSession("LINE_USER_ID"));
  const [projects, setProjects] = useState([]);
  const [pid, setPid] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [status, setStatus] = useState(getSession("TASK_STATUS") || "all");
  const [view, setView] = useState(getSession("VIEW_MODE") || "list"); // list | board | calendar | week
  const [pname, setPname] = useState("");
  const [ttitle, setTtitle] = useState("");
  const [tdeadline, setTdeadline] = useState("");
  const [timportance, setTimportance] = useState("");
  const [trepeat, setTrepeat] = useState("");
  const [testimated, setTestimated] = useState("");
  const [q, setQ] = useState("");
  const [fImportance, setFImportance] = useState("");
  const [views, setViews] = useState([]);
  const [viewName, setViewName] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [openTodos, setOpenTodos] = useState(() => new Set());
  const [editVals, setEditVals] = useState({
    title: "",
    deadline: "",
    importance: "",
  estimated_minutes: "",
  });

  const isMobile = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia && window.matchMedia("(max-width: 800px)").matches;
  }, []);

  useEffect(() => {
    setSession("API_KEY", api);
  }, [api]);
  useEffect(() => {
    setSession("LINE_USER_ID", uid);
  }, [uid]);
  useEffect(() => {
    setSession("TASK_STATUS", status);
  }, [status]);
  useEffect(() => {
    setSession("VIEW_MODE", view);
  }, [view]);

  useEffect(() => {
    bootstrap();
  }, []);
  useEffect(() => {
    if (api && uid) loadProjects();
  }, [api, uid]);
  useEffect(() => {
    if (api && uid) loadTasks();
  }, [api, uid, pid, status, view]);
  useEffect(() => {
    if (api && uid) loadViews();
  }, [api, uid]);

  async function h() {
    return { "x-api-key": api, "Content-Type": "application/json" };
  }
  function showErr(e) {
    const text = typeof e === "string" ? e : e?.message || "Error";
    setErr(text);
    setTimeout(() => setErr(""), 4000);
  }
  function showMsg(text) {
    setMsg(text);
    setTimeout(() => setMsg(""), 2000);
  }

  async function bootstrap() {
    try {
      const r = await fetch("/api/config");
      if (r.ok) {
        const c = await r.json();
        if (!uid && c.defaultLineUserId) setUid(c.defaultLineUserId);
      }
    } catch {}
    setLoading(false);
  }

  async function loadProjects() {
    if (!uid) return;
    const r = await fetch(
      `/api/projects?line_user_id=${encodeURIComponent(uid)}`,
      { headers: await h() }
    );
    if (!r.ok) return showErr(`projects ${r.status}`);
    setProjects(await r.json());
  }
  async function createProject() {
    if (!uid) return showErr("LINE User IDを入力してください");
    if (!pname) return showErr("プロジェクト名を入力してください");
    const r = await fetch("/api/projects", {
      method: "POST",
      headers: await h(),
      body: JSON.stringify({ line_user_id: uid, name: pname }),
    });
    if (!r.ok) return showErr(`create project ${r.status}`);
    setPname("");
    loadProjects();
    showMsg("プロジェクトを追加しました");
  }
  async function loadViews() {
    const r = await fetch(`/api/views?line_user_id=${encodeURIComponent(uid)}`, { headers: await h() });
    if (!r.ok) return; // silent
    setViews(await r.json());
  }
  async function saveCurrentView() {
    if (!viewName.trim()) return showErr("ビュー名を入力してください");
    const payload = {
      pid,
      viewMode: view,
      status,
      q,
      importance: fImportance,
    };
    const r = await fetch(`/api/views`, {
      method: "POST",
      headers: await h(),
      body: JSON.stringify({ line_user_id: uid, name: viewName.trim(), payload }),
    });
    if (!r.ok) return showErr(`save view ${r.status}`);
    setViewName("");
    loadViews();
    showMsg("ビューを保存しました");
  }
  async function deleteView(id) {
    const r = await fetch(`/api/views/${id}`, { method: "DELETE", headers: await h() });
    if (!r.ok) return showErr(`delete view ${r.status}`);
    loadViews();
  }
  async function reorderViews(newOrder) {
    await fetch(`/api/views/reorder`, {
      method: "POST",
      headers: await h(),
      body: JSON.stringify({ line_user_id: uid, orderedIds: newOrder }),
    });
    loadViews();
  }
  function applyViewPayload(p) {
    if (!p) return;
    if (typeof p.pid !== "undefined") setPid(p.pid);
    if (p.viewMode) setView(p.viewMode);
    if (p.status) setStatus(p.status);
    setQ(p.q || "");
    setFImportance(p.importance || "");
    // tasks will reload via effects
  }
  async function loadTasks() {
    if (!uid) return;
    const qs = new URLSearchParams({ line_user_id: uid });
    if (pid === null) {
      // no filter
    } else if (pid === "none") qs.set("project_id", "none");
    else if (pid) qs.set("project_id", String(pid));
    // In board/calendar view, fetch all statuses to populate columns/cells
    if (view !== "list") qs.set("status", "all");
    else if (status) qs.set("status", status);
  if (q) qs.set("q", q);
  if (fImportance) qs.set("importance", fImportance);
  // include todo counts for list view (cheap aggregate)
  if (view === "list") qs.set("with_todo_counts", "true");
  const r = await fetch(`/api/tasks?${qs.toString()}`, {
      headers: await h(),
    });
    if (!r.ok) return showErr(`tasks ${r.status}`);
    setTasks(await r.json());
  }
  async function createTask() {
    if (!uid) return showErr("LINE User IDを入力してください");
    if (!ttitle) return showErr("タスク名を入力してください");
    let deadlineOut = tdeadline;
    if (deadlineOut && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(deadlineOut))
      deadlineOut = deadlineOut.replace("T", " ");
    const body = {
      line_user_id: uid,
      title: ttitle,
      deadline: deadlineOut,
      project_id: typeof pid === "number" ? pid : null,
  importance: timportance || null,
  repeat: trepeat || null,
  estimated_minutes: testimated ? Number(testimated) : null,
    };
    const r = await fetch("/api/tasks", {
      method: "POST",
      headers: await h(),
      body: JSON.stringify(body),
    });
    if (!r.ok) return showErr(`create task ${r.status}`);
    setTtitle("");
  setTimportance("");
  setTestimated("");
    loadTasks();
    showMsg("タスクを追加しました");
  }
  async function updateTask(id, newStatus) {
    const r = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: await h(),
      body: JSON.stringify({ status: newStatus }),
    });
    if (!r.ok) return showErr(`update task ${r.status}`);
    loadTasks();
  }
  function startEdit(t) {
    setEditingId(t.id);
    setEditVals({
      title: t.title,
      deadline: t.deadline ? t.deadline.replace(" ", "T") : "",
  importance: t.importance || "",
  estimated_minutes: t.estimated_minutes || "",
    });
    if (view === "board") setView("list");
  }
  function cancelEdit() {
    setEditingId(null);
    setEditVals({ title: "", deadline: "", importance: "" });
  }
  async function saveEdit(id) {
    const body = {
      title: editVals.title,
      deadline: editVals.deadline ? editVals.deadline.replace("T", " ") : null,
      importance: editVals.importance || null,
  estimated_minutes: editVals.estimated_minutes ? Number(editVals.estimated_minutes) : null,
    };
    const r = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: await h(),
      body: JSON.stringify(body),
    });
    if (!r.ok) return showErr(`update task ${r.status}`);
    setEditingId(null);
    loadTasks();
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (!api || !uid) {
    try {
      window.location.replace("/login");
    } catch {}
    return null;
  }

  return (
    <div className="container">
      {(msg || err) && (
        <div style={{ marginBottom: 8 }}>
          {msg && <div className="alert success">{msg}</div>}
          {err && <div className="alert error">{err}</div>}
        </div>
      )}
      <header className="app-header">
        {isMobile && (
          <button className="ghost" onClick={() => setDrawerOpen(true)}>
            メニュー
          </button>
        )}
        <strong>Todo Planner (React)</strong>
        <span className="user">
          ユーザー: {String(uid).slice(0, 6)}…
          <a href="/login" style={{ marginRight: 12 }}>
            ログイン
          </a>
          <button
            onClick={() => {
              try {
                sessionStorage.removeItem("API_KEY");
                sessionStorage.removeItem("LINE_USER_ID");
              } catch {}
              window.location.replace("/login");
            }}
          >
            ログアウト
          </button>
        </span>
      </header>

      <div className="layout">
        {!isMobile && (
          <aside className="panel">
            <div style={{ fontWeight: 600, marginBottom: 8 }}>プロジェクト</div>
            <ul className="list">
              {projects.map((p) => (
                <li
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 0",
                    borderBottom: "1px solid #eee",
                  }}
                >
                  <div>{p.name}</div>
                  <button onClick={() => setPid(p.id)}>開く</button>
                </li>
              ))}
            </ul>
            <div style={{ height: 1, background: "#eee", margin: "12px 0" }} />
            <div className="row">
              <button onClick={() => setPid(null)}>すべて</button>
              <button onClick={() => setPid("none")}>未分類</button>
            </div>
            <div className="grid-2">
              <input
                placeholder="新規プロジェクト名"
                value={pname}
                onChange={(e) => setPname(e.target.value)}
              />
              <button onClick={createProject}>追加</button>
            </div>
          </aside>
        )}

        <main className="panel">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>
                タスク {pid ? `- P${pid}` : ""}
              </div>
              <div style={{ color: "#777" }}>期限は YYYY-MM-DD HH:mm</div>
            </div>
            <div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button
                  className={view === "list" ? "ghost" : ""}
                  onClick={() => setView("list")}
                >
                  リスト
                </button>
                <button
                  className={view === "board" ? "ghost" : ""}
                  onClick={() => setView("board")}
                >
                  ボード
                </button>
                <button
                  className={view === "calendar" ? "ghost" : ""}
                  onClick={() => setView("calendar")}
                >
                  カレンダー
                </button>
                <button
                  className={view === "week" ? "ghost" : ""}
                  onClick={() => setView("week")}
                >
                  週
                </button>
              </div>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={view !== "list"}
              >
                <option value="pending">未完了</option>
                <option value="all">すべて</option>
                <option value="done">完了</option>
                <option value="failed">未達</option>
              </select>
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 8 }}>
            <input
              placeholder="タスク名"
              value={ttitle}
              onChange={(e) => setTtitle(e.target.value)}
            />
            <input
              type="datetime-local"
              placeholder="任意: 2025-09-01 09:00"
              value={tdeadline}
              onChange={(e) => setTdeadline(e.target.value)}
            />
          </div>
          <div className="grid-2" style={{ marginTop: 8 }}>
            <input
              type="number"
              min="0"
              placeholder="所要時間(分) 任意"
              value={testimated}
              onChange={(e) => setTestimated(e.target.value)}
            />
            <span />
          </div>
          <div className="grid-2" style={{ marginTop: 8 }}>
            <select
              value={timportance}
              onChange={(e) => setTimportance(e.target.value)}
            >
              <option value="">重要度(任意)</option>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
            <select value={trepeat} onChange={(e) => setTrepeat(e.target.value)}>
              <option value="">繰り返し(任意)</option>
              <option value="daily">毎日</option>
              <option value="weekdays">平日</option>
              <option value="weekly">毎週</option>
              <option value="monthly">毎月</option>
            </select>
          </div>
          <div className="row stack-sm" style={{ marginTop: 8 }}>
            <button onClick={createTask}>タスク追加</button>
            <button onClick={loadTasks}>更新</button>
          </div>
          <div className="grid-2" style={{ marginTop: 8 }}>
            <input placeholder="検索 (タイトル)" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={fImportance} onChange={(e) => setFImportance(e.target.value)}>
              <option value="">重要度: すべて</option>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </div>
          <div className="grid-2" style={{ marginTop: 8 }}>
            <input placeholder="保存名 (複合ビュー)" value={viewName} onChange={(e) => setViewName(e.target.value)} />
            <button onClick={saveCurrentView}>保存</button>
          </div>
          {views.length > 0 && (
            <div className="panel" style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>保存ビュー</div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {views.map((v, idx) => (
                  <div key={v.id} className="row" style={{ gap: 4 }}>
                    <button className="ghost" onClick={() => applyViewPayload(v.payload)}>{v.name}</button>
                    <button className="ghost" onClick={() => deleteView(v.id)} title="削除">×</button>
                    {idx > 0 && (
                      <button className="ghost" title="↑" onClick={() => {
                        const ids = views.map(x => x.id);
                        const a = ids[idx - 1]; ids[idx - 1] = ids[idx]; ids[idx] = a;
                        reorderViews(ids);
                      }}>↑</button>
                    )}
                    {idx < views.length - 1 && (
                      <button className="ghost" title="↓" onClick={() => {
                        const ids = views.map(x => x.id);
                        const a = ids[idx + 1]; ids[idx + 1] = ids[idx]; ids[idx] = a;
                        reorderViews(ids);
                      }}>↓</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {view === "list" ? (
            <>
            <ul className="list" style={{ marginTop: 12 }}>
              {tasks.length === 0 ? (
                <li style={{ color: "#777", padding: "8px 0" }}>
                  タスクがありません。以下を確認してください：
                  <ul>
                    <li>ステータスを「すべて」にする</li>
                    <li>「未分類」/「すべて」フィルタを切り替える</li>
                    <li>
                      ログインのLINE User ID が正しいか（右上のログインで再設定）
                    </li>
                  </ul>
                  <div className="row stack-sm" style={{ marginTop: 8 }}>
                    <button onClick={() => setStatus("all")}>すべて表示</button>
                    <button onClick={() => setPid(null)}>プロジェクト解除</button>
                  </div>
                </li>
              ) : (
                tasks.map((t) => (
                  <li
                    key={t.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 0",
                      borderBottom: "1px solid #eee",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={t.status === "done"}
                      onChange={(e) =>
                        updateTask(t.id, e.target.checked ? "done" : "pending")
                      }
                    />
                    <div style={{ flex: 1 }}>
                      {editingId === t.id ? (
                        <>
                          <input
                            value={editVals.title}
                            onChange={(e) =>
                              setEditVals({ ...editVals, title: e.target.value })
                            }
                            style={{ width: "100%", marginBottom: 6 }}
                          />
                          <div className="grid-2" style={{ marginBottom: 6 }}>
                            <input
                              type="datetime-local"
                              value={editVals.deadline}
                              onChange={(e) =>
                                setEditVals({
                                  ...editVals,
                                  deadline: e.target.value,
                                })
                              }
                            />
                            <select
                              value={editVals.importance}
                              onChange={(e) =>
                                setEditVals({
                                  ...editVals,
                                  importance: e.target.value,
                                })
                              }
                            >
                              <option value="">重要度(任意)</option>
                              <option value="high">高</option>
                              <option value="medium">中</option>
                              <option value="low">低</option>
                            </select>
                          </div>
                          <div className="grid-2" style={{ marginBottom: 6 }}>
                            <input
                              type="number"
                              min="0"
                              placeholder="所要時間(分) 任意"
                              value={editVals.estimated_minutes}
                              onChange={(e) =>
                                setEditVals({
                                  ...editVals,
                                  estimated_minutes: e.target.value,
                                })
                              }
                            />
                            <span />
                          </div>
                        </>
                      ) : (
                        <>
                          <div>{t.title}</div>
                          <div style={{ color: "#777", fontSize: 12 }}>
                            {t.deadline || "-"} ・ {t.status}
                            {typeof t.estimated_minutes === "number" ? ` ・ 目安:${t.estimated_minutes}分` : ""}
                            {t.urgency
                              ? ` ・ 緊急度:${
                                  t.urgency === "high"
                                    ? "高"
                                    : t.urgency === "medium"
                                    ? "中"
                                    : "低"
                                }`
                              : ""}
                            {t.importance
                              ? ` ・ 重要度:${
                                  t.importance === "high"
                                    ? "高"
                                    : t.importance === "medium"
                                    ? "中"
                                    : "低"
                                }`
                              : ""}
                            {typeof t.todos_total === "number" && t.todos_total > 0
                              ? ` ・ ✓ ${t.todos_done || 0}/${t.todos_total}`
                              : ""}
                            {t.type === "long" && typeof t.progress === "number"
                              ? ` ・ 進捗 ${t.progress}%`
                              : ""}
                          </div>
                        </>
                      )}
                    </div>
                    {editingId === t.id ? (
                      <div className="row stack-sm">
                        <button onClick={() => saveEdit(t.id)}>保存</button>
                        <button className="ghost" onClick={cancelEdit}>
                          キャンセル
                        </button>
                      </div>
                    ) : (
                      <div className="row stack-sm">
                        <button onClick={() => startEdit(t)}>編集</button>
                        <button onClick={() => updateTask(t.id, "done")}>
                          完了
                        </button>
                        <button
                          className="ghost"
                          onClick={() => {
                            const next = new Set(openTodos);
                            if (next.has(t.id)) next.delete(t.id);
                            else next.add(t.id);
                            setOpenTodos(next);
                          }}
                        >
                          Todos
                        </button>
                      </div>
                    )}
                  </li>
                ))
              )}
            </ul>
            {tasks.map((t) => (
              openTodos.has(t.id) ? (
                <div key={`todos-${t.id}`} style={{ marginLeft: 32 }}>
                  <Todos
                    taskId={t.id}
                    getHeaders={h}
                    onChanged={loadTasks}
                  />
                </div>
              ) : null
            ))}
            </>
          ) : view === "board" ? (
            <Board
              tasksByStatus={{
                pending: tasks.filter((t) => t.status === "pending"),
                done: tasks.filter((t) => t.status === "done"),
                failed: tasks.filter((t) => t.status === "failed"),
              }}
              onDropStatus={(id, s) => updateTask(id, s)}
              onEdit={(t) => startEdit(t)}
              onToggleDone={(id, done) => updateTask(id, done ? "done" : "pending")}
              onReorder={async (status, orderedIds) => {
                await fetch("/api/tasks/reorder", {
                  method: "POST",
                  headers: await h(),
                  body: JSON.stringify({ line_user_id: uid, status, orderedIds }),
                });
                loadTasks();
              }}
            />
          ) : view === "calendar" ? (
            <Calendar
              tasks={tasks}
              onDropDate={async (taskId, dateStr) => {
                try {
                  const t = tasks.find((x) => x.id === taskId);
                  if (!t) return;
                  let deadline = null;
                  if (dateStr) {
                    // preserve original time when available, else default 09:00
                    let hhmm = "09:00";
                    if (t.deadline) {
                      const m = t.deadline.match(/\d{2}:\d{2}$/);
                      if (m) hhmm = m[0];
                    }
                    deadline = `${dateStr} ${hhmm}`;
                  }
                  const r = await fetch(`/api/tasks/${taskId}`, {
                    method: "PATCH",
                    headers: await h(),
                    body: JSON.stringify({ deadline }),
                  });
                  if (!r.ok) return showErr(`update task ${r.status}`);
                  loadTasks();
                } catch (e) {
                  showErr(e);
                }
              }}
            />
          ) : (
            <Week
              tasks={tasks}
              onDropDate={async (taskId, dateStr) => {
                try {
                  const t = tasks.find((x) => x.id === taskId);
                  if (!t) return;
                  let deadline = null;
                  if (dateStr) {
                    let hhmm = "09:00";
                    if (t.deadline) {
                      const m = t.deadline.match(/\d{2}:\d{2}$/);
                      if (m) hhmm = m[0];
                    }
                    deadline = `${dateStr} ${hhmm}`;
                  }
                  const r = await fetch(`/api/tasks/${taskId}`, {
                    method: "PATCH",
                    headers: await h(),
                    body: JSON.stringify({ deadline }),
                  });
                  if (!r.ok) return showErr(`update task ${r.status}`);
                  loadTasks();
                } catch (e) {
                  showErr(e);
                }
              }}
            />
          )}
        </main>
      </div>

      {isMobile && drawerOpen && (
        <>
          <div
            className="mobile-overlay"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="mobile-drawer open">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700 }}>プロジェクト</div>
              <button className="ghost" onClick={() => setDrawerOpen(false)}>
                閉じる
              </button>
            </div>
            <ul className="list">
              {projects.map((p) => (
                <li
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>{p.name}</div>
                  <button
                    onClick={() => {
                      setPid(p.id);
                      setDrawerOpen(false);
                    }}
                  >
                    開く
                  </button>
                </li>
              ))}
            </ul>
            <div style={{ height: 1, background: "#eee", margin: "12px 0" }} />
            <div className="row">
              <button
                onClick={() => {
                  setPid(null);
                  setDrawerOpen(false);
                }}
              >
                すべて
              </button>
              <button
                onClick={() => {
                  setPid("none");
                  setDrawerOpen(false);
                }}
              >
                未分類
              </button>
            </div>
            <div className="grid-2" style={{ marginTop: 8 }}>
              <input
                placeholder="新規プロジェクト名"
                value={pname}
                onChange={(e) => setPname(e.target.value)}
              />
              <button
                onClick={() => {
                  createProject();
                }}
              >
                追加
              </button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
