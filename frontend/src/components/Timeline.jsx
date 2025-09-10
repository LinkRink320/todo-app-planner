import React, { useEffect, useMemo, useState } from "react";

// Timeline view showing tasks and time tracking on a day-by-day hourly schedule
export default function Timeline({ userId, getHeaders, tasks, onTaskUpdate }) {
  const [date, setDate] = useState(() => today());
  const [timeEntries, setTimeEntries] = useState([]);
  const [activeTracking, setActiveTracking] = useState(null); // {taskId, startTime}
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    loadTimeEntries();
  }, [userId, date]);

  // Restore active tracking on mount (prefer server truth)
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        // First, ask server for an active entry
        const r = await fetch(
          `/api/time-entries/active?line_user_id=${encodeURIComponent(userId)}`,
          { headers: await getHeaders() }
        );
        if (r.ok) {
          const ct = r.headers.get("content-type") || "";
          const text = await r.text();
          if (ct.includes("application/json")) {
            const data = text ? JSON.parse(text) : null;
            if (data && data.task_id && data.start_time && !data.end_time) {
              setActiveTracking({
                taskId: data.task_id,
                startTime: data.start_time,
              });
            } else {
              setActiveTracking(null);
            }
            return; // Do not fallback if server responded JSON
          }
        }
        // Fallback only if server fetch failed or returned non-JSON
        const key = `activeTracking:${userId}`;
        const raw = window.localStorage.getItem(key);
        if (raw) {
          const obj = JSON.parse(raw);
          if (obj && obj.taskId && obj.startTime) setActiveTracking(obj);
        }
      } catch {}
    })();
  }, [userId]);

  const timeSlots = useMemo(() => {
    const slots = [];
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const viewingIsToday = date === todayStr;

    for (let hour = 6; hour < 24; hour++) {
      slots.push({
        hour,
        label: `${hour.toString().padStart(2, "0")}:00`,
        entries: timeEntries.filter((entry) => {
          const start = new Date(entry.start_time);
          if (isNaN(start.getTime())) return false;
          let startHour = start.getHours();
          let endHour;
          if (entry.end_time) {
            const end = new Date(entry.end_time);
            endHour = isNaN(end.getTime()) ? startHour : end.getHours();
          } else {
            // Ongoing entry: show up to current hour when viewing today; otherwise only show at start hour
            endHour = viewingIsToday ? now.getHours() : startHour;
          }
          if (endHour < startHour) endHour = startHour;
          return startHour <= hour && hour <= endHour;
        }),
      });
    }
    return slots;
  }, [timeEntries, date]);

  async function loadTimeEntries() {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/time-entries?line_user_id=${encodeURIComponent(
          userId
        )}&date=${date}`,
        { headers: await getHeaders() }
      );
      if (r.ok) {
        const ct = r.headers.get("content-type") || "";
        const text = await r.text();
        if (ct.includes("application/json")) {
          const data = JSON.parse(text);
          setTimeEntries(Array.isArray(data) ? data : []);
        }
      }
    } catch (e) {
      console.error("Failed to load time entries:", e);
    } finally {
      setLoading(false);
    }
  }

  async function startTracking(taskId) {
    const startTime = new Date().toISOString();
    const next = { taskId, startTime };
    setActiveTracking(next);
    try {
      window.localStorage.setItem(
        `activeTracking:${userId}`,
        JSON.stringify(next)
      );
    } catch {}

    try {
      await fetch("/api/time-entries", {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({
          line_user_id: userId,
          task_id: taskId,
          start_time: startTime,
        }),
      });
      await loadTimeEntries();
      try {
        window.dispatchEvent(
          new CustomEvent("tracking:start", { detail: { taskId, startTime } })
        );
      } catch {}
    } catch (e) {
      console.error("Failed to start tracking:", e);
      setActiveTracking(null);
      try {
        window.localStorage.removeItem(`activeTracking:${userId}`);
      } catch {}
    }
  }

  async function stopTracking() {
    if (!activeTracking) return;
    try {
      const r = await fetch("/api/time-entries/stop", {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({ line_user_id: userId }),
      });
      if (!r.ok) throw new Error(`stop ${r.status}`);

      setActiveTracking(null);
      try {
        window.localStorage.removeItem(`activeTracking:${userId}`);
      } catch {}
      await loadTimeEntries();
      try {
        window.dispatchEvent(new CustomEvent("tracking:stop"));
      } catch {}
    } catch (e) {
      console.error("Failed to stop tracking:", e);
    }
  }

  function formatDuration(minutes) {
    if (!minutes) return "0分";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}時間${mins}分` : `${mins}分`;
  }

  function getTaskById(taskId) {
    return tasks.find((t) => t.id === taskId);
  }

  return (
    <div className="timeline-view">
      <div className="timeline-header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <strong>タイムライン</strong>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="row">
            {activeTracking ? (
              <button className="stop-tracking" onClick={stopTracking}>
                ⏹️ 停止 (タスク#{activeTracking.taskId})
              </button>
            ) : (
              <span style={{ color: "#666" }}>タスクを選んで開始</span>
            )}
          </div>
        </div>
      </div>

      {loading && <div>読み込み中...</div>}

      <div className="timeline-grid">
        <div className="timeline-hours">
          {timeSlots.map((slot) => (
            <div key={slot.hour} className="hour-slot">
              <div className="hour-label">{slot.label}</div>
              <div className="hour-content">
                {slot.entries.map((entry) => {
                  const task = getTaskById(entry.task_id);
                  const duration =
                    entry.duration_minutes ||
                    (entry.end_time
                      ? Math.round(
                          (new Date(entry.end_time) -
                            new Date(entry.start_time)) /
                            60000
                        )
                      : 0);

                  return (
                    <div
                      key={entry.id || `${entry.task_id}-${entry.start_time}`}
                      className="time-entry"
                      style={{
                        backgroundColor:
                          task?.importance === "high"
                            ? "#ffebee"
                            : task?.importance === "medium"
                            ? "#fff3e0"
                            : "#f3e5f5",
                        borderLeft: `4px solid ${
                          task?.importance === "high"
                            ? "#f44336"
                            : task?.importance === "medium"
                            ? "#ff9800"
                            : "#9c27b0"
                        }`,
                      }}
                    >
                      <div className="entry-title" title={task?.title}>
                        {task?.title || `タスク#${entry.task_id}`}
                      </div>
                      <div className="entry-time">
                        {new Date(entry.start_time).toLocaleTimeString(
                          "ja-JP",
                          {
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}
                        {entry.end_time && (
                          <>
                            {" - "}
                            {new Date(entry.end_time).toLocaleTimeString(
                              "ja-JP",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}
                          </>
                        )}
                      </div>
                      {duration > 0 && (
                        <div className="entry-duration">
                          {formatDuration(duration)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="available-tasks">
        <h3>実行可能なタスク</h3>
        <div className="task-list">
          {tasks
            .filter((t) => t.status === "pending")
            .map((task) => (
              <div key={task.id} className="task-item">
                <div className="task-info">
                  <div className="task-title">{task.title}</div>
                  <div className="task-meta">
                    {task.estimated_minutes && (
                      <span>
                        見積: {formatDuration(task.estimated_minutes)}
                      </span>
                    )}
                    {task.actual_minutes && (
                      <span>実績: {formatDuration(task.actual_minutes)}</span>
                    )}
                  </div>
                </div>
                <div className="task-actions">
                  {activeTracking?.taskId === task.id ? (
                    <button className="tracking-active" disabled>
                      ⏱️ 実行中
                    </button>
                  ) : activeTracking ? (
                    <button disabled>開始</button>
                  ) : (
                    <button onClick={() => startTracking(task.id)}>
                      ▶️ 開始
                    </button>
                  )}
                </div>
              </div>
            ))}
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
