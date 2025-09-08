import React, { useMemo, useState } from "react";
import Todos from "./Todos.jsx";

// Simple Kanban board with 3 columns: pending, done, failed
// Props:
// - tasksByStatus: { pending: Task[], done: Task[], failed: Task[] }
// - onDropStatus: (taskId: number, newStatus: 'pending'|'done'|'failed') => void
// - onEdit: (task) => void
// - onToggleDone: (taskId: number, done: boolean) => void
export default function Board({
  tasksByStatus,
  onDropStatus,
  onEdit,
  onToggleDone,
  onReorder,
  getHeaders,
  onTodosChanged,
  openTodos,
  onToggleTodos,
}) {
  const [hover, setHover] = useState({ status: null, index: null });
  const sorted = useMemo(() => {
    const sortFn = (a, b) => {
      const sa = a.sort_order ?? 1e9;
      const sb = b.sort_order ?? 1e9;
      if (sa !== sb) return sa - sb;
      const da = a.deadline ? Date.parse(a.deadline.replace(" ", "T")) : 0;
      const db = b.deadline ? Date.parse(b.deadline.replace(" ", "T")) : 0;
      return da - db;
    };
    return {
      pending: [...(tasksByStatus.pending || [])].sort(sortFn),
      done: [...(tasksByStatus.done || [])].sort(sortFn),
      failed: [...(tasksByStatus.failed || [])].sort(sortFn),
    };
  }, [tasksByStatus]);

  function onDragStart(e, task, fromStatus) {
    e.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ id: task.id, fromStatus })
    );
    e.dataTransfer.effectAllowed = "move";
  }
  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }
  function makeOnDrop(newStatus) {
    return (e) => {
      e.preventDefault();
      try {
        const data = e.dataTransfer.getData("text/plain");
        const { id, fromStatus } = JSON.parse(data);
        if (!id) return;
        const lists = { ...sorted };
        const list = lists[newStatus] || [];
        // Build new order
        const target = list.map((t) => t.id).filter((x) => x !== Number(id));
        const insertAt =
          hover.status === newStatus && typeof hover.index === "number"
            ? hover.index
            : target.length;
        target.splice(insertAt, 0, Number(id));
        const updateOrder = () => onReorder && onReorder(newStatus, target);
        if (fromStatus && fromStatus !== newStatus) {
          onDropStatus(Number(id), newStatus)
            .then(updateOrder)
            .catch(updateOrder);
        } else {
          updateOrder();
        }
        setHover({ status: null, index: null });
      } catch {}
    };
  }

  function Card({ t, status, index }) {
    return (
      <div
        draggable
        onDragStart={(e) => onDragStart(e, t, status)}
        onDragOver={(e) => {
          onDragOver(e);
          setHover({ status, index });
        }}
        className={`kanban-card ${
          hover.status === status && hover.index === index ? "drag-over" : ""
        }`}
      >
        <div
          className="kanban-title"
          style={{ cursor: onToggleTodos ? "pointer" : "default" }}
          onClick={() => onToggleTodos && onToggleTodos(t.id)}
          title={onToggleTodos ? "Todosを表示/非表示" : undefined}
        >
          {t.title}
        </div>
        <div className="kanban-meta">
          {(t.deadline || "-") +
            (t.urgency ? ` ・ 緊急度:${label(t.urgency)}` : "") +
            (t.importance ? ` ・ 重要度:${label(t.importance)}` : "") +
            (t.soft_deadline ? ` ・ 内締切:${t.soft_deadline}` : "")}
        </div>
        <div className="row">
          <button className="ghost" onClick={() => onEdit(t)}>
            編集
          </button>
          <button onClick={() => onToggleDone(t.id, t.status !== "done")}>
            完了
          </button>
        </div>
        {openTodos && openTodos.has(t.id) && (
          <div style={{ marginTop: 8 }}>
            <Todos
              taskId={t.id}
              getHeaders={getHeaders}
              onChanged={onTodosChanged}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="kanban">
      <Column
        title="未完了"
        onDrop={makeOnDrop("pending")}
        onDragOver={onDragOver}
        active={hover.status === "pending"}
      >
        {sorted.pending.map((t, i) => (
          <Card key={t.id} t={t} status="pending" index={i} />
        ))}
      </Column>
      <Column
        title="完了"
        onDrop={makeOnDrop("done")}
        onDragOver={onDragOver}
        active={hover.status === "done"}
      >
        {sorted.done.map((t, i) => (
          <Card key={t.id} t={t} status="done" index={i} />
        ))}
      </Column>
      <Column
        title="未達"
        onDrop={makeOnDrop("failed")}
        onDragOver={onDragOver}
        active={hover.status === "failed"}
      >
        {sorted.failed.map((t, i) => (
          <Card key={t.id} t={t} status="failed" index={i} />
        ))}
      </Column>
    </div>
  );
}

function Column({ title, children, onDrop, onDragOver, active }) {
  return (
    <div
      className={`kanban-col ${active ? "dragging" : ""}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <div className="kanban-col-title">{title}</div>
      <div className="kanban-col-body">{children}</div>
    </div>
  );
}

function label(x) {
  return x === "high" ? "高" : x === "medium" ? "中" : "低";
}
