import React, { useMemo, useState } from "react";

// Calendar month view with drag-and-drop to set/change deadlines
// Props:
// - tasks: Task[] (includes id, title, deadline, status, importance, urgency)
// - onDropDate: (taskId: number, dateStr: string) => Promise<void> | void // dateStr: YYYY-MM-DD
export default function Calendar({ tasks, onDropDate }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const { weeks, byDate, undated } = useMemo(
    () => groupTasks(cursor, tasks),
    [cursor, tasks]
  );

  function prevMonth() {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() - 1);
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
  }
  function nextMonth() {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() + 1);
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  function handleDrop(dateStr) {
    return async (e) => {
      e.preventDefault();
      try {
        const data = JSON.parse(e.dataTransfer.getData("text/plain"));
        if (data && data.id) await onDropDate(Number(data.id), dateStr);
      } catch {}
    };
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button className="ghost" onClick={prevMonth}>
          ◀
        </button>
        <div className="calendar-title">
          {cursor.getFullYear()}年 {cursor.getMonth() + 1}月
        </div>
        <button className="ghost" onClick={nextMonth}>
          ▶
        </button>
      </div>

      <div
        className="calendar-undated"
        onDragOver={onDragOver}
        onDrop={handleDrop("")}
      >
        <div className="calendar-undated-title">
          期限なしにドロップで締切をクリア
        </div>
        <div className="calendar-undated-list">
          {undated.map((t) => (
            <TaskPill key={t.id} task={t} />
          ))}
        </div>
      </div>

      <div className="calendar-grid">
        {weekdays.map((w) => (
          <div key={w} className="calendar-dow">
            {w}
          </div>
        ))}
        {weeks.map((week, wIdx) =>
          week.map((cell) => (
            <div
              key={`${wIdx}-${cell.date}`}
              className={`calendar-cell ${cell.inMonth ? "" : "out"}`}
              onDragOver={onDragOver}
              onDrop={handleDrop(cell.date)}
            >
              <div className="calendar-date">
                {Number(cell.date.split("-")[2])}
              </div>
              <div className="calendar-cell-body">
                {(byDate.get(cell.date) || []).map((t) => (
                  <TaskPill key={t.id} task={t} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TaskPill({ task }) {
  function onDragStart(e) {
    e.dataTransfer.setData("text/plain", JSON.stringify({ id: task.id }));
    e.dataTransfer.effectAllowed = "move";
  }
  return (
    <div
      className={`pill pill-${task.status}`}
      draggable
      onDragStart={onDragStart}
      title={task.title}
    >
      <span className="pill-dot" />
      <span className="pill-text">{task.title}</span>
    </div>
  );
}

const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

function groupTasks(monthStart, tasks) {
  const y = monthStart.getFullYear();
  const m = monthStart.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const startDow = first.getDay(); // 0 Sun - 6 Sat
  const daysInMonth = last.getDate();

  // Build 6 weeks * 7 days grid
  const weeks = [];
  const cells = [];
  for (let i = 0; i < startDow; i++) {
    const d = new Date(y, m, -(startDow - 1 - i));
    cells.push({ date: fmt(d), inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: `${y}-${pad(m + 1)}-${pad(d)}`, inMonth: true });
  }
  const remaining = 7 - (cells.length % 7 || 7);
  for (let i = 1; i <= remaining; i++) {
    const d = new Date(y, m + 1, i);
    cells.push({ date: fmt(d), inMonth: false });
  }
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  // Group tasks by YYYY-MM-DD
  const byDate = new Map();
  const undated = [];
  (tasks || []).forEach((t) => {
    if (!t.deadline) {
      undated.push(t);
      return;
    }
    const d = toDateOnly(t.deadline);
    const list = byDate.get(d) || [];
    list.push(t);
    byDate.set(d, list);
  });

  return { weeks, byDate, undated };
}

function toDateOnly(deadline) {
  const d = new Date(deadline.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return fmt(d);
}

function fmt(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pad(n) {
  return String(n).padStart(2, "0");
}
