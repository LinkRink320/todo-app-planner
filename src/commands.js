function parse(text) {
  const t = text.trim();

  // 短期: 追加
  if (t.startsWith('add ')) {
    const [, date, time, ...rest] = t.split(' ');
    if (!date || !time || !rest.length) return {type:'error', msg:'書式: add YYYY-MM-DD HH:mm タイトル'};
    return {type:'add', deadline:`${date} ${time}`, title:rest.join(' ')};
  }

  // 長期: 追加（チェック目安にdeadlineを使う）
  if (t.startsWith('addl ')) {
    const [, date, time, ...rest] = t.split(' ');
    if (!date || !time || !rest.length) return {type:'error', msg:'書式: addl YYYY-MM-DD HH:mm タイトル'};
    return {type:'add_long', deadline:`${date} ${time}`, title:rest.join(' ')};
  }

  if (t === 'ls') return {type:'list'};
  if (t === 'lsl') return {type:'list_long'};

  // プロジェクト操作
  if (t.startsWith('padd ')) {
    const name = t.slice(5).trim();
    if (!name) return {type:'error', msg:'書式: padd プロジェクト名'};
    return {type:'project_add', name};
  }
  if (t === 'pls') return {type:'project_list'};
  if (t.startsWith('addp ')) {
    // addp <projectId> YYYY-MM-DD HH:mm タイトル
    const parts = t.split(' ');
    if (parts.length < 5) return {type:'error', msg:'書式: addp {projectId} YYYY-MM-DD HH:mm タイトル'};
    const projectId = Number(parts[1])||0;
    const date = parts[2];
    const time = parts[3];
    const title = parts.slice(4).join(' ');
    if (!projectId || !date || !time || !title) return {type:'error', msg:'書式: addp {projectId} YYYY-MM-DD HH:mm タイトル'};
    return {type:'add_project_task', projectId, deadline:`${date} ${time}`, title};
  }
  if (t.startsWith('lsp ')) {
    const projectId = Number(t.split(' ')[1])||0;
    if (!projectId) return {type:'error', msg:'書式: lsp {projectId}'};
    return {type:'list_project_tasks', projectId};
  }

  if (t.startsWith('done ')) {
    return {type:'done', id:Number(t.split(' ')[1])||0};
  }

  if (t.toLowerCase() === 'watch here') return {type:'watch_here'};

  if (t.startsWith('prog ')) {
    const parts = t.split(' ');
    const id = Number(parts[1])||0;
    const pctStr = (parts[2]||'').replace('%','');
    if (!id || pctStr === '') return {type:'error', msg:'書式: prog {id} {0-100%}'};
    const progress = Math.max(0, Math.min(100, Number(pctStr)||0));
    return {type:'progress', id, progress};
  }

  return {type:'help'};
}

module.exports = { parse };
