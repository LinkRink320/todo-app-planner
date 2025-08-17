import React, { useEffect, useState } from "react";

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
  const [pname, setPname] = useState("");
  const [ttitle, setTtitle] = useState("");
  const [tdeadline, setTdeadline] = useState("");
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    setSession("API_KEY", api);
  }, [api]);
  useEffect(() => {
    setSession("LINE_USER_ID", uid);
  }, [uid]);

  useEffect(() => {
    bootstrap();
  }, []);
  useEffect(() => {
    if (api && uid) loadProjects();
  }, [api, uid]);
  useEffect(() => {
    if (api && uid) loadTasks();
  }, [api, uid, pid, status]);

  useEffect(() => {
    setSession("TASK_STATUS", status);
  }, [status]);

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
        if (!api && c.apiKeySet) {
          // keep input empty; user must input API
        }
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
    if (!r.ok) {
      showErr(`projects ${r.status}`);
      return;
    }
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
    if (!r.ok) {
      let d = "";
      try {
        d = await r.text();
      } catch {}
      return showErr(`create project ${r.status} ${d}`);
    }
    setPname("");
    loadProjects();
    showMsg("プロジェクトを追加しました");
  }
  async function loadTasks() {
    if (!uid) return;
    const qs = new URLSearchParams({ line_user_id: uid });
    if (pid === null) {
      // no project filter
    } else if (pid === "none") {
      qs.set("project_id", "none");
    } else if (pid) {
      qs.set("project_id", String(pid));
    }
    if (status) qs.set("status", status);
    const r = await fetch(`/api/tasks?${qs.toString()}`, {
      headers: await h(),
    });
    if (!r.ok) {
      showErr(`tasks ${r.status}`);
      return;
    }
    setTasks(await r.json());
  }
  async function createTask() {
    if (!uid) return showErr("LINE User IDを入力してください");
    if (!ttitle) return showErr("タスク名を入力してください");
    if (!tdeadline) return showErr("期限を入力してください (YYYY-MM-DD HH:mm)");
    const body = {
      line_user_id: uid,
      title: ttitle,
      deadline: tdeadline,
      project_id: typeof pid === "number" ? pid : null,
    };
    const r = await fetch("/api/tasks", {
      method: "POST",
      headers: await h(),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let d = "";
      try {
        d = await r.text();
      } catch {}
      return showErr(`create task ${r.status} ${d}`);
    }
    setTtitle("");
    loadTasks();
    showMsg("タスクを追加しました");
  }
  async function updateTask(id, newStatus) {
    const r = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: await h(),
      body: JSON.stringify({ status: newStatus }),
    });
    if (!r.ok) {
      showErr(`update task ${r.status}`);
      return;
    }
    loadTasks();
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  if (!api || !uid) {
    // 認証情報が無い場合はログイン画面へ
    try {
      window.location.replace("/login");
    } catch {}
    return null;
  }

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 1000,
        margin: "0 auto",
        padding: 16,
      }}
    >
      {(msg || err) && (
        <div style={{ marginBottom: 8 }}>
          {msg && (
            <div
              style={{
                background: "#e6ffed",
                border: "1px solid #b7eb8f",
                padding: 8,
              }}
            >
              {msg}
            </div>
          )}
          {err && (
            <div
              style={{
                background: "#fff1f0",
                border: "1px solid #ffa39e",
                padding: 8,
              }}
            >
              {err}
            </div>
          )}
        </div>
      )}
      <header style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <strong>Todo Planner (React)</strong>
        <span style={{ marginLeft: "auto", color: "#777" }}>
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr",
          gap: 16,
          marginTop: 16,
        }}
      >
        <aside>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>プロジェクト</div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
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
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button onClick={() => setPid(null)}>すべて</button>
            <button onClick={() => setPid("none")}>未分類</button>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}
          >
            <input
              placeholder="新規プロジェクト名"
              value={pname}
              onChange={(e) => setPname(e.target.value)}
            />
            <button onClick={createProject}>追加</button>
          </div>
        </aside>
        <main>
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
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="pending">未完了</option>
                <option value="all">すべて</option>
                <option value="done">完了</option>
                <option value="failed">未達</option>
              </select>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 8,
              marginTop: 8,
            }}
          >
            <input
              placeholder="タスク名"
              value={ttitle}
              onChange={(e) => setTtitle(e.target.value)}
            />
            <input
              placeholder="2025-09-01 09:00"
              value={tdeadline}
              onChange={(e) => setTdeadline(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={createTask}>タスク追加</button>
            <button onClick={loadTasks}>更新</button>
          </div>

          <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
            {tasks.length === 0 && (
              <li style={{ color: "#777", padding: "8px 0" }}>
                タスクがありません。以下を確認してください：
                <ul>
                  <li>ステータスを「すべて」にする</li>
                  <li>「未分類」/「すべて」フィルタを切り替える</li>
                  <li>
                    ログインのLINE User ID が正しいか（右上のログインで再設定）
                  </li>
                </ul>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={() => setStatus("all")}>すべて表示</button>
                  <button onClick={() => setPid(null)}>プロジェクト解除</button>
                </div>
              </li>
            )}
            {tasks.map((t) => (
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
                  <div>{t.title}</div>
                  <div style={{ color: "#777", fontSize: 12 }}>
                    {t.deadline} ・ {t.status}
                    {t.type === "long" && typeof t.progress === "number"
                      ? ` ・ 進捗 ${t.progress}%`
                      : ""}
                  </div>
                </div>
                <button onClick={() => updateTask(t.id, "done")}>完了</button>
              </li>
            ))}
          </ul>
        </main>
      </div>
    </div>
  );
}
