const state = {
  userId: Number(localStorage.getItem('userId') || 1),
  sessionId: null,
  session: null,
  versions: [],
  comments: [],
  filter: 'all'
};

const el = {
  userId: document.getElementById('userId'),
  saveUser: document.getElementById('saveUser'),
  projectTitle: document.getElementById('projectTitle'),
  sessionTitle: document.getElementById('sessionTitle'),
  sessionDescription: document.getElementById('sessionDescription'),
  initialFile: document.getElementById('initialFile'),
  createSession: document.getElementById('createSession'),
  invite: document.getElementById('invite'),
  sessionView: document.getElementById('sessionView'),
  sessionMeta: document.getElementById('sessionMeta'),
  mockupImage: document.getElementById('mockupImage'),
  dotsLayer: document.getElementById('dotsLayer'),
  commentsList: document.getElementById('commentsList'),
  commentFilter: document.getElementById('commentFilter'),
  refresh: document.getElementById('refresh'),
  newVersionFile: document.getElementById('newVersionFile'),
  changeNote: document.getElementById('changeNote'),
  uploadVersion: document.getElementById('uploadVersion'),
  finalApprove: document.getElementById('finalApprove'),
  activityList: document.getElementById('activityList'),
  canvasWrap: document.getElementById('canvasWrap')
};

el.userId.value = String(state.userId);

function api(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-user-id': String(state.userId),
    ...(options.headers || {})
  };
  return fetch(url, { ...options, headers });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function loadSession(id) {
  const res = await api(`/sessions/${id}`);
  if (!res.ok) {
    alert('Сессия не найдена');
    return;
  }
  const data = await res.json();
  state.sessionId = id;
  state.session = data.session;
  state.versions = data.versions;
  state.comments = data.comments;

  const current = state.versions.find((v) => v.id === state.session.current_version_id);
  el.mockupImage.src = current?.file_url || '';
  el.sessionMeta.innerHTML = `
    <b>${state.session.title}</b><br>
    Статус: <span class="badge">${state.session.status}</span><br>
    Версия: V${current?.version_number || '-'}
  `;

  renderComments();
  renderDots();
  await loadActivity();
  el.sessionView.hidden = false;

  const url = new URL(window.location.href);
  url.searchParams.set('session', String(id));
  window.history.replaceState({}, '', url);
}

async function loadActivity() {
  if (!state.sessionId) return;
  const res = await api(`/sessions/${state.sessionId}/activity`);
  const logs = await res.json();
  el.activityList.innerHTML = logs
    .map((l) => `<li><b>${l.action_type}</b><br><small>${l.created_at}</small></li>`)
    .join('');
}

function renderComments() {
  const filtered = state.comments.filter((c) => state.filter === 'all' || c.status === state.filter);
  el.commentsList.innerHTML = filtered
    .sort((a, b) => b.id - a.id)
    .map(
      (c) => `<li>
      <div><b>#${c.id}</b> <span class="badge">${c.status}</span></div>
      <div>${c.body}</div>
      <small>x=${c.x.toFixed(1)} y=${c.y.toFixed(1)}</small>
      <div class="row">
        <button data-action="status" data-id="${c.id}" data-status="in_progress">В работу</button>
        <button data-action="status" data-id="${c.id}" data-status="resolved">Решено</button>
        <button data-action="status" data-id="${c.id}" data-status="ignored">Игнор</button>
      </div>
    </li>`
    )
    .join('');
}

function renderDots() {
  el.dotsLayer.innerHTML = state.comments
    .map(
      (c, idx) => `<div class="dot" style="left:${c.x}%; top:${c.y}%" title="${c.body}">${idx + 1}</div>`
    )
    .join('');
}

el.saveUser.addEventListener('click', () => {
  const id = Number(el.userId.value);
  if (!id) return;
  state.userId = id;
  localStorage.setItem('userId', String(id));
  alert('User ID сохранён');
});

el.createSession.addEventListener('click', async () => {
  const file = el.initialFile.files?.[0];
  if (!file) return alert('Загрузите макет');
  const fileDataUrl = await fileToDataUrl(file);

  const payload = {
    projectTitle: el.projectTitle.value,
    title: el.sessionTitle.value,
    description: el.sessionDescription.value,
    fileDataUrl,
    fileType: file.type,
    changeNote: 'Initial version'
  };

  const res = await api('/sessions', { method: 'POST', body: JSON.stringify(payload) });
  const data = await res.json();

  if (!res.ok) return alert(data.error || 'Ошибка');

  const fullInvite = `${location.origin}${data.invite_link}`;
  el.invite.innerHTML = `<b>Сессия создана:</b> <a href="${fullInvite}">${fullInvite}</a>`;
  await loadSession(data.session.id);
});

el.canvasWrap.addEventListener('click', async (e) => {
  if (!state.session) return;
  const current = state.versions.find((v) => v.id === state.session.current_version_id);
  if (!current) return;

  const rect = el.canvasWrap.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  const body = prompt('Введите комментарий');
  if (!body) return;

  const res = await api(`/versions/${current.id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, x, y })
  });
  if (!res.ok) {
    const data = await res.json();
    return alert(data.error || 'Не удалось создать комментарий');
  }
  await loadSession(state.sessionId);
});

el.commentsList.addEventListener('click', async (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.dataset.action !== 'status') return;

  const id = t.dataset.id;
  const status = t.dataset.status;
  await api(`/comments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
  await loadSession(state.sessionId);
});

el.commentFilter.addEventListener('change', () => {
  state.filter = el.commentFilter.value;
  renderComments();
});

el.uploadVersion.addEventListener('click', async () => {
  if (!state.sessionId) return;
  const file = el.newVersionFile.files?.[0];
  if (!file) return alert('Выберите файл версии');

  const fileDataUrl = await fileToDataUrl(file);
  const res = await api(`/sessions/${state.sessionId}/versions`, {
    method: 'POST',
    body: JSON.stringify({
      fileDataUrl,
      fileType: file.type,
      changeNote: el.changeNote.value || 'Обновление'
    })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'Ошибка загрузки');

  await loadSession(state.sessionId);
});

el.finalApprove.addEventListener('click', async () => {
  if (!state.sessionId) return;
  const res = await api(`/sessions/${state.sessionId}/final-approve`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return alert(`Нельзя согласовать: ${data.error}`);
  await loadSession(state.sessionId);
  alert('Финальное согласование зафиксировано');
});

el.refresh.addEventListener('click', () => {
  if (state.sessionId) loadSession(state.sessionId);
});

const sessionFromQuery = new URL(location.href).searchParams.get('session');
if (sessionFromQuery) {
  loadSession(Number(sessionFromQuery));
}
