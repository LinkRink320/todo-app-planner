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
  const [status, setStatus] = useState("pending");
  const [pname, setPname] = useState("");
  const [ttitle, setTtitle] = useState("");
  const [tdeadline, setTdeadline] = useState("");
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState("");

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

  async function h() {
    return { "x-api-key": api, "Content-Type": "application/json" };
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
    if (!r.ok) return;
    setProjects(await r.json());
  }
  async function createProject() {
    if (!uid || !pname) return;
    const r = await fetch("/api/projects", {
      method: "POST",
      headers: await h(),
      body: JSON.stringify({ line_user_id: uid, name: pname }),
    });
    if (!r.ok) return;
    setPname("");
    loadProjects();
  }
  async function loadTasks() {
    if (!uid) return;
    const qs = new URLSearchParams({ line_user_id: uid });
    if (pid) qs.set("project_id", String(pid));
    if (status) qs.set("status", status);
    const r = await fetch(`/api/tasks?${qs.toString()}`, {
      headers: await h(),
    });
    if (!r.ok) return;
    setTasks(await r.json());
  }
  async function createTask() {
    if (!uid || !ttitle || !tdeadline) return;
    const body = {
      line_user_id: uid,
      title: ttitle,
      deadline: tdeadline,
      project_id: pid,
    };
    const r = await fetch("/api/tasks", {
      method: "POST",
      headers: await h(),
      body: JSON.stringify(body),
    });
    if (!r.ok) return;
    setTtitle("");
    loadTasks();
  }
  async function updateTask(id, newStatus) {
    const r = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: await h(),
      body: JSON.stringify({ status: newStatus }),
    });
    if (!r.ok) return;
    loadTasks();
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  if (!api || !uid) {
    return (
      <div
        style={{
          fontFamily: "system-ui, sans-serif",
          maxWidth: 480,
          margin: "0 auto",
          padding: 24,
        }}
      >
        <h2>ログイン</h2>
        <p style={{ color: "#555" }}>
          API_KEY と LINE User ID を入力してください。
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          <input
            placeholder="API_KEY"
            value={api}
            onChange={(e) => setApi(e.target.value)}
          />
          <input
            placeholder="LINE User ID"
            value={uid}
            onChange={(e) => setUid(e.target.value)}
          />
          <button
            onClick={() => {
              if (api && uid) loadProjects();
            }}
          >
            続ける
          </button>
        </div>
      </div>
    );
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
      <header style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <strong>Todo Planner (React)</strong>
        <input
          placeholder="API_KEY"
          value={api}
          onChange={(e) => setApi(e.target.value)}
        />
        <input
          placeholder="LINE User ID"
          value={uid}
          onChange={(e) => setUid(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <span style={{ marginLeft: "auto", color: "#777" }}>
          プロジェクトを選択してタスク管理
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
