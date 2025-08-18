import React from "react";

// Simple Kanban board with 3 columns: pending, done, failed
// Props:
// - tasksByStatus: { pending: Task[], done: Task[], failed: Task[] }
// - onDropStatus: (taskId: number, newStatus: 'pending'|'done'|'failed') => void
// - onEdit: (task) => void
// - onToggleDone: (taskId: number, done: boolean) => void
export default function Board({ tasksByStatus, onDropStatus, onEdit, onToggleDone }) {
  function onDragStart(e, task) {
    e.dataTransfer.setData("text/plain", JSON.stringify({ id: task.id }));
  }
  function onDragOver(e) {
    e.preventDefault();
  }
  function makeOnDrop(newStatus) {
    return (e) => {
      e.preventDefault();
      try {
        const data = e.dataTransfer.getData("text/plain");
        const { id } = JSON.parse(data);
        if (id) onDropStatus(Number(id), newStatus);
      } catch {}
    };
  }

  function Card({ t }) {
    return (
      <div
        draggable
        onDragStart={(e) => onDragStart(e, t)}
        className="kanban-card"
      >
        <div className="kanban-title">{t.title}</div>
        <div className="kanban-meta">
          {(t.deadline || "-") + (t.urgency ? ` ・ 緊急度:${label(t.urgency)}` : "") + (t.importance ? ` ・ 重要度:${label(t.importance)}` : "")}
        </div>
        <div className="row">
          <button className="ghost" onClick={() => onEdit(t)}>編集</button>
          <button onClick={() => onToggleDone(t.id, t.status !== "done")}>完了</button>
        </div>
      </div>
    );
  }

  return (
    <div className="kanban">
      <Column title="未完了" onDrop={makeOnDrop("pending")} onDragOver={onDragOver}>
        {tasksByStatus.pending.map((t) => (
          <Card key={t.id} t={t} />
        ))}
      </Column>
      <Column title="完了" onDrop={makeOnDrop("done")} onDragOver={onDragOver}>
        {tasksByStatus.done.map((t) => (
          <Card key={t.id} t={t} />
        ))}
      </Column>
      <Column title="未達" onDrop={makeOnDrop("failed")} onDragOver={onDragOver}>
        {tasksByStatus.failed.map((t) => (
          <Card key={t.id} t={t} />
        ))}
      </Column>
    </div>
  );
}

function Column({ title, children, onDrop, onDragOver }) {
  return (
    <div className="kanban-col" onDrop={onDrop} onDragOver={onDragOver}>
      <div className="kanban-col-title">{title}</div>
      <div className="kanban-col-body">{children}</div>
    </div>
  );
}

function label(x) {
  return x === "high" ? "高" : x === "medium" ? "中" : "低";
}
