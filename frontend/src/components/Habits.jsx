import React, { useEffect, useMemo, useState } from "react";

export default function Habits({ userId, getHeaders, projectId }) {
  const [repeats, setRepeats] = useState(() => new Set(["daily", "weekdays"]));
  const [days, setDays] = useState(14);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newRepeat, setNewRepeat] = useState("daily");
  const [editing, setEditing] = useState(null); // task_id
  const [editVals, setEditVals] = useState({ title: "", repeat: "daily" });

  const repeatParam = useMemo(() => Array.from(repeats).join(","), [repeats]);

  useEffect(() => {
    if (!userId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, repeatParam, days]);

  async function load() {
    try {
      setLoading(true);
      setErr("");
      const url = `/api/habits?line_user_id=${encodeURIComponent(
        userId
      )}&repeats=${encodeURIComponent(repeatParam)}&days=${days}`;
      const r = await fetch(url, { headers: await getHeaders() });
      if (!r.ok) throw new Error(`habits ${r.status}`);
      const ct = r.headers.get("content-type") || "";
      const text = await r.text();
      if (!ct.includes("application/json"))
        throw new Error(`habits non-JSON ${r.status}`);
      const data = JSON.parse(text);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  function toggleRepeats(key) {
    const next = new Set(repeats);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    if (next.size === 0) next.add("daily");
    setRepeats(next);
  }

  async function addHabit() {
    const title = newTitle.trim();
    if (!title) return;
    const r = await fetch("/api/tasks", {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify({
        line_user_id: userId,
        title,
        repeat: newRepeat,
        // attach to current project if one is selected
        project_id: typeof projectId === "number" ? Number(projectId) : null,
      }),
    });
    if (!r.ok) return;
    setNewTitle("");
    await load();
  }

  function startEdit(row) {
    setEditing(row.task_id);
    setEditVals({ title: row.title, repeat: row.repeat || "daily" });
  }

  async function saveEdit(taskId) {
    const body = { title: editVals.title, repeat: editVals.repeat };
    const r = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: await getHeaders(),
      body: JSON.stringify(body),
    });
    if (!r.ok) return;
    setEditing(null);
    await load();
  }

  async function remove(taskId) {
    const r = await fetch(
      `/api/tasks/${taskId}?line_user_id=${encodeURIComponent(userId)}`,
      { method: "DELETE", headers: await getHeaders() }
    );
    if (!r.ok) return;
    await load();
  }

  return (
    <div className="panel" style={{ marginTop: 8 }}>
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <strong>習慣（毎日・平日）</strong>
        <div className="row" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={repeats.has("daily")}
              onChange={() => toggleRepeats("daily")}
            />
            毎日
          </label>
          <label className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={repeats.has("weekdays")}
              onChange={() => toggleRepeats("weekdays")}
            />
            平日
          </label>
          <label>
            期間:
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={7}>7日</option>
              <option value={14}>14日</option>
              <option value={28}>28日</option>
            </select>
          </label>
          <button className="ghost" onClick={load} disabled={loading}>
            更新
          </button>
        </div>
      </div>

      {err && (
        <div className="alert error" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}

      <div className="grid-2" style={{ marginTop: 8 }}>
        <input
          placeholder="新しい習慣のタイトル"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <div className="row" style={{ gap: 8 }}>
          <select
            value={newRepeat}
            onChange={(e) => setNewRepeat(e.target.value)}
          >
            <option value="daily">毎日</option>
            <option value="weekdays">平日</option>
          </select>
          <button onClick={addHabit}>追加</button>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {loading ? (
          <div>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ color: "#777" }}>対象の習慣はありません</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "220px 1fr 60px 60px",
                gap: 8,
                alignItems: "center",
                fontWeight: 600,
              }}
            >
              <div>タイトル</div>
              <div>トラッカー</div>
              <div>連続</div>
              <div>操作</div>
            </div>
            {items.map((row) => (
              <div
                key={row.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "220px 1fr 60px 60px",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <div>
                  {editing === row.task_id ? (
                    <div className="row" style={{ gap: 6 }}>
                      <input
                        value={editVals.title}
                        onChange={(e) =>
                          setEditVals({ ...editVals, title: e.target.value })
                        }
                      />
                      <select
                        value={editVals.repeat}
                        onChange={(e) =>
                          setEditVals({ ...editVals, repeat: e.target.value })
                        }
                      >
                        <option value="daily">毎日</option>
                        <option value="weekdays">平日</option>
                      </select>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontWeight: 600 }}>{row.title}</div>
                      <div style={{ color: "#777", fontSize: 12 }}>
                        {row.repeat === "weekdays" ? "平日" : "毎日"}
                      </div>
                    </div>
                  )}
                </div>
                <Tracker recent={row.recent} />
                <div style={{ textAlign: "center" }}>{row.streak}</div>
                <div className="row" style={{ gap: 4 }}>
                  {editing === row.task_id ? (
                    <>
                      <button onClick={() => saveEdit(row.task_id)}>
                        保存
                      </button>
                      <button
                        className="ghost"
                        onClick={() => setEditing(null)}
                      >
                        キャンセル
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="ghost" onClick={() => startEdit(row)}>
                        編集
                      </button>
                      <button
                        className="ghost"
                        onClick={() => remove(row.task_id)}
                      >
                        削除
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tracker({ recent }) {
  // recent: [{date, done}]
  return (
    <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
      {(recent || []).map((d) => (
        <div
          key={d.date}
          title={`${d.date} ${d.done ? "✓" : ""}`}
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            background: d.done ? "#2e7d32" : "#e0e0e0",
            border: "1px solid #ddd",
          }}
        />
      ))}
    </div>
  );
}
