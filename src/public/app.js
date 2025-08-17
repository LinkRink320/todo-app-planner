const $ = (id) => document.getElementById(id);
const apiH = () => ({'x-api-key': $('#api').value.trim(), 'Content-Type':'application/json'});
let currentPid = null;

async function loadProjects(){
  const uid = $('#uid').value.trim(); if(!uid) return alert('LINE User ID');
  const r = await fetch('/api/projects?line_user_id='+encodeURIComponent(uid), {headers: apiH()});
  if(!r.ok){ alert('projects failed'); return; }
  const data = await r.json();
  const ul = $('#projects'); ul.innerHTML='';
  data.forEach(p=>{
    const li = document.createElement('li');
    li.className='item';
    li.innerHTML = `<div class="title">${p.name}</div><button class="btn" data-id="${p.id}">開く</button>`;
    li.querySelector('button').onclick = ()=> selectProject(p.id, p.name);
    ul.appendChild(li);
  });
}
async function createProject(){
  const uid = $('#uid').value.trim(); if(!uid) return alert('LINE User ID');
  const name = $('#pname').value.trim(); if(!name) return;
  const r = await fetch('/api/projects', {method:'POST', headers: apiH(), body: JSON.stringify({line_user_id: uid, name})});
  if(!r.ok) return alert('failed');
  $('#pname').value='';
  loadProjects();
}
function selectProject(id, name){
  currentPid = id;
  $('#currentProject').textContent = `タスク - ${name}`;
  $('#selectedPid').textContent = 'P'+id;
  loadTasks();
}
async function loadTasks(){
  const uid = $('#uid').value.trim(); if(!uid) return alert('LINE User ID');
  const url = '/api/tasks?line_user_id='+encodeURIComponent(uid)+(currentPid?('&project_id='+currentPid):'');
  const r = await fetch(url, {headers: {'x-api-key': $('#api').value.trim()}});
  if(!r.ok){ alert('tasks failed'); return; }
  const data = await r.json();
  const ul = $('#tasks'); ul.innerHTML='';
  data.forEach(t=>{
    const li = document.createElement('li');
    li.className='item';
    li.innerHTML = `
      <input type="checkbox" ${t.status==='done'?'checked':''} />
      <div class="title">${t.title}<div class="muted">${t.deadline} ・ ${t.status}</div></div>
      <button class="btn" data-id="${t.id}">完了</button>
    `;
    const cb = li.querySelector('input[type=checkbox]');
    cb.onchange = ()=> updateTask(t.id, cb.checked? 'done':'pending');
    li.querySelector('button').onclick = ()=> updateTask(t.id, 'done');
    ul.appendChild(li);
  });
}
async function createTask(){
  const uid = $('#uid').value.trim(); if(!uid) return alert('LINE User ID');
  const title = $('#ttitle').value.trim(); if(!title) return;
  const deadline = $('#tdeadline').value.trim(); if(!deadline) return;
  const r = await fetch('/api/tasks', {method:'POST', headers: apiH(), body: JSON.stringify({line_user_id: uid, title, deadline, project_id: currentPid})});
  if(!r.ok) return alert('failed');
  $('#ttitle').value='';
  loadTasks();
}
async function updateTask(id, status){
  const r = await fetch('/api/tasks/'+id, {method:'PATCH', headers: apiH(), body: JSON.stringify({status})});
  if(!r.ok) return alert('failed');
  loadTasks();
}

// initial
setTimeout(loadProjects, 300);
