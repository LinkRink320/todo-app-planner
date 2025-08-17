function parse(text) {
  const t = text.trim();
  if (t.startsWith("add ")) {
    const [, date, time, ...rest] = t.split(" ");
    if (!date || !time || !rest.length)
      return { type: "error", msg: "書式: add YYYY-MM-DD HH:mm タイトル" };
    return { type: "add", deadline: `${date} ${time}`, title: rest.join(" ") };
  }
  if (t === "ls") return { type: "list" };
  if (t.startsWith("done "))
    return { type: "done", id: Number(t.split(" ")[1]) || 0 };
  if (t.toLowerCase() === "watch here") return { type: "watch_here" };
  return { type: "help" };
}
module.exports = { parse };
