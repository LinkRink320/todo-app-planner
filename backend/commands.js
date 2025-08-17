function toHalfWidth(str) {
  // Convert full-width ASCII range to half-width to tolerate mobile input (ＵＲＬ, etc.)
  return str.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );
}

function parse(text) {
  const t = toHalfWidth(String(text || "")).trim();
  if (t.startsWith("add ")) {
    const parts = t.split(" ");
    if (parts.length >= 4) {
      const [, date, time, ...rest] = parts;
      if (!date || !time || !rest.length)
        return { type: "error", msg: "書式: add YYYY-MM-DD HH:mm タイトル" };
      return { type: "add", deadline: `${date} ${time}`, title: rest.join(" ") };
    } else if (parts.length >= 2) {
      const title = parts.slice(1).join(" ");
      if (!title) return { type: "error", msg: "書式: add [YYYY-MM-DD HH:mm] タイトル" };
      return { type: "add", deadline: null, title };
    }
    return { type: "error", msg: "書式: add [YYYY-MM-DD HH:mm] タイトル" };
  }
  if (t.startsWith("addl ")) {
    const parts = t.split(" ");
    if (parts.length >= 4) {
      const [, date, time, ...rest] = parts;
      if (!date || !time || !rest.length)
        return { type: "error", msg: "書式: addl YYYY-MM-DD HH:mm タイトル" };
      return { type: "add_long", deadline: `${date} ${time}`, title: rest.join(" ") };
    } else if (parts.length >= 2) {
      const title = parts.slice(1).join(" ");
      if (!title) return { type: "error", msg: "書式: addl [YYYY-MM-DD HH:mm] タイトル" };
      return { type: "add_long", deadline: null, title };
    }
    return { type: "error", msg: "書式: addl [YYYY-MM-DD HH:mm] タイトル" };
  }
  if (t === "ls") return { type: "list" };
  if (t === "lsl") return { type: "list_long" };
  if (t === "myid" || t === "id" || t === "whoami") return { type: "whoami" };
  if (t.toLowerCase() === "url") return { type: "app_url" };
  if (t.startsWith("padd ")) {
    const name = t.slice(5).trim();
    if (!name) return { type: "error", msg: "書式: padd プロジェクト名" };
    return { type: "project_add", name };
  }
  if (t === "pls") return { type: "project_list" };
  if (t.startsWith("addp ")) {
    const parts = t.split(" ");
    const projectId = Number(parts[1]) || 0;
    if (!projectId) return { type: "error", msg: "書式: addp {projectId} [YYYY-MM-DD HH:mm] タイトル" };
    if (parts.length >= 5) {
      const date = parts[2];
      const time = parts[3];
      const title = parts.slice(4).join(" ");
      if (!date || !time || !title)
        return { type: "error", msg: "書式: addp {projectId} YYYY-MM-DD HH:mm タイトル" };
      return { type: "add_project_task", projectId, deadline: `${date} ${time}`, title };
    } else if (parts.length >= 3) {
      const title = parts.slice(2).join(" ");
      if (!title) return { type: "error", msg: "書式: addp {projectId} [YYYY-MM-DD HH:mm] タイトル" };
      return { type: "add_project_task", projectId, deadline: null, title };
    }
    return { type: "error", msg: "書式: addp {projectId} [YYYY-MM-DD HH:mm] タイトル" };
  }
  if (t.startsWith("lsp ")) {
    const projectId = Number(t.split(" ")[1]) || 0;
    if (!projectId) return { type: "error", msg: "書式: lsp {projectId}" };
    return { type: "list_project_tasks", projectId };
  }
  if (t.startsWith("done ")) {
    return { type: "done", id: Number(t.split(" ")[1]) || 0 };
  }
  if (t.toLowerCase() === "watch here") return { type: "watch_here" };
  if (t.startsWith("prog ")) {
    const parts = t.split(" ");
    const id = Number(parts[1]) || 0;
    const pctStr = (parts[2] || "").replace("%", "");
    if (!id || pctStr === "")
      return { type: "error", msg: "書式: prog {id} {0-100%}" };
    const progress = Math.max(0, Math.min(100, Number(pctStr) || 0));
    return { type: "progress", id, progress };
  }
  return { type: "help" };
}
module.exports = { parse };
