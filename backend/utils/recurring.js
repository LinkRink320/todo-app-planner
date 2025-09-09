const db = require("../db");

// Calc next deadline for recurring tasks (copied from api.js)
function calcNextDeadline(deadline, rep) {
  // deadline: "YYYY-MM-DD HH:mm"
  const iso = deadline.replace(" ", "T");
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const copy = new Date(d.getTime());
  const pad = (n) => String(n).padStart(2, "0");
  const toStr = (dt) =>
    `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(
      dt.getHours()
    )}:${pad(dt.getMinutes())}`;
  switch (rep) {
    case "daily":
      copy.setDate(copy.getDate() + 1);
      return toStr(copy);
    case "weekdays": {
      // next business day (Mon-Fri)
      do {
        copy.setDate(copy.getDate() + 1);
      } while ([0, 6].includes(copy.getDay()));
      return toStr(copy);
    }
    case "weekly":
      copy.setDate(copy.getDate() + 7);
      return toStr(copy);
    case "monthly":
      copy.setMonth(copy.getMonth() + 1);
      return toStr(copy);
    default:
      return null;
  }
}

// Helper function to create next recurring task
function createNextRecurringTask(originalTask, options = {}) {
  const { skipDays = 0, skipToNextInterval = false } = options;

  const rep = originalTask.repeat ? String(originalTask.repeat) : null;
  if (!rep || !originalTask.deadline) return null;

  let baseDeadline = originalTask.deadline;

  // If skipToNextInterval is true, calculate from the original deadline regardless of current date
  if (skipToNextInterval) {
    const next = calcNextDeadline(baseDeadline, rep);
    if (!next) return null;
    baseDeadline = next;
  } else if (skipDays > 0) {
    // Add skip days to the original deadline
    const iso = baseDeadline.replace(" ", "T");
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + skipDays);
    const pad = (n) => String(n).padStart(2, "0");
    baseDeadline = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate()
    )} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } else {
    // Normal case: calculate next occurrence
    const next = calcNextDeadline(baseDeadline, rep);
    if (!next) return null;
    baseDeadline = next;
  }

  return {
    line_user_id: originalTask.line_user_id,
    title: originalTask.title,
    deadline: baseDeadline,
    soft_deadline: originalTask.soft_deadline || null,
    project_id: originalTask.project_id || null,
    importance: originalTask.importance || null,
    repeat: rep,
    estimated_minutes: originalTask.estimated_minutes || null,
    url: originalTask.url || null,
    details_md: originalTask.details_md || null,
  };
}

// Enhanced function to handle recurring task creation with todo copying
async function handleRecurringTaskCreation(
  originalTaskId,
  originalTask,
  options = {}
) {
  return new Promise((resolve) => {
    const nextTask = createNextRecurringTask(originalTask, options);
    if (!nextTask) return resolve({ success: false, reason: "no_next_task" });

    db.run(
      "INSERT INTO tasks(line_user_id,title,deadline,soft_deadline,project_id,importance,repeat,estimated_minutes,url,details_md) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        nextTask.line_user_id,
        nextTask.title,
        nextTask.deadline,
        nextTask.soft_deadline,
        nextTask.project_id,
        nextTask.importance,
        nextTask.repeat,
        nextTask.estimated_minutes,
        nextTask.url,
        nextTask.details_md,
      ],
      function (insErr) {
        if (insErr)
          return resolve({
            success: false,
            reason: "insert_failed",
            error: insErr,
          });

        const newTaskId = this?.lastID;
        if (!newTaskId) return resolve({ success: true, copied_todos: 0 });

        // Copy open (not done) todos to the new repeated task
        db.all(
          "SELECT title, estimated_minutes, sort_order, url, details_md FROM todos WHERE task_id=? AND done=0 ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order, id",
          [originalTaskId],
          (tErr, todos) => {
            if (tErr || !Array.isArray(todos) || todos.length === 0) {
              return resolve({
                success: true,
                taskId: newTaskId,
                copied_todos: 0,
              });
            }

            const stmt = db.prepare(
              "INSERT INTO todos(task_id,title,estimated_minutes,sort_order,url,details_md) VALUES (?,?,?,?,?,?)"
            );
            db.run("BEGIN");
            for (const td of todos) {
              stmt.run([
                newTaskId,
                td.title,
                Number.isFinite(Number(td.estimated_minutes))
                  ? Number(td.estimated_minutes)
                  : null,
                Number.isFinite(Number(td.sort_order))
                  ? Number(td.sort_order)
                  : null,
                td.url || null,
                td.details_md || null,
              ]);
            }
            stmt.finalize((fe) => {
              if (fe) {
                try {
                  db.run("ROLLBACK");
                } catch {}
                return resolve({
                  success: true,
                  taskId: newTaskId,
                  copied_todos: 0,
                });
              }
              db.run("COMMIT", () =>
                resolve({
                  success: true,
                  taskId: newTaskId,
                  copied_todos: todos.length,
                })
              );
            });
          }
        );
      }
    );
  });
}

module.exports = {
  createNextRecurringTask,
  handleRecurringTaskCreation,
};
