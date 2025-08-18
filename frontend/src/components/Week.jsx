import React, { useMemo, useState } from "react";

// Week view with drag-and-drop to set/change deadlines
// Props:
// - tasks: Task[] (id, title, deadline, status,...)
// - onDropDate: (taskId: number, dateStr: string) => Promise<void> | void // YYYY-MM-DD or "" to clear
export default function Week({ tasks, onDropDate }) {
  const [cursor, setCursor] = useState(() => startOfWeek(new Date()));

  const { days, byDate, undated, rangeLabel } = useMemo(
    () => groupWeekTasks(cursor, tasks),
    [cursor, tasks]
  );

  function prevWeek() {
    const d = new Date(cursor);
    d.setDate(d.getDate() - 7);
    setCursor(startOfWeek(d));
  }
  function nextWeek() {
    const d = new Date(cursor);
    d.setDate(d.getDate() + 7);
    setCursor(startOfWeek(d));
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
        <button className="ghost" onClick={prevWeek}>
          ◀
        </button>
        <div className="calendar-title">{rangeLabel}</div>
        <button className="ghost" onClick={nextWeek}>
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
        {days.map((cell, idx) => (
          <div
            key={`${idx}-${cell.date}`}
            className="calendar-cell"
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
        ))}
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

function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const delta = x.getDay(); // 0=Sun
  x.setDate(x.getDate() - delta);
  x.setHours(0, 0, 0, 0);
  return x;
}

function groupWeekTasks(weekStart, tasks) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push({ date: fmt(d) });
  }

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

  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const rangeLabel = `${weekStart.getFullYear()}年 ${
    weekStart.getMonth() + 1
  }月 ${weekStart.getDate()}日 〜 ${end.getFullYear()}年 ${
    end.getMonth() + 1
  }月 ${end.getDate()}日`;

  return { days, byDate, undated, rangeLabel };
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
