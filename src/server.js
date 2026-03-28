import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logAction, nextId, nowIso, readDb, writeDb } from './db.js';
import { validateTelegramInitData } from './telegramAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(payload);
}

function parseJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) reject(new Error('payload_too_large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function parseActorId(req) {
  const id = Number(req.headers['x-user-id']);
  return Number.isFinite(id) ? id : null;
}

function roleRank(role) {
  const map = { viewer: 1, reviewer: 2, editor: 3, owner: 4 };
  return map[role] || 0;
}

function requireRole(state, sessionId, userId, minRole = 'viewer') {
  const p = state.session_participants.find((x) => x.session_id === sessionId && x.user_id === userId);
  if (!p) return false;
  return roleRank(p.role) >= roleRank(minRole);
}

function serveStatic(req, res, pathname) {
  const clean = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${clean}`);
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(filePath)) return send(res, 404, { error: 'not_found' });
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = url;

  try {
    if (req.method === 'POST' && pathname === '/auth/telegram') {
      const body = await parseJson(req);
      const result = validateTelegramInitData(body.initData, process.env.TELEGRAM_BOT_TOKEN || '');
      if (!result.ok) return send(res, 401, { ok: false, error: result.reason });

      const state = readDb();
      const tgUser = result.user;
      let user = state.users.find((u) => String(u.telegram_id) === String(tgUser?.id));
      if (!user) {
        user = {
          id: nextId(state.users), telegram_id: tgUser.id, username: tgUser.username || null,
          first_name: tgUser.first_name || null, last_name: tgUser.last_name || null,
          avatar_url: tgUser.photo_url || null, created_at: nowIso()
        };
        state.users.push(user);
        writeDb(state);
      }
      return send(res, 200, { ok: true, user });
    }

    if (req.method === 'POST' && pathname === '/sessions') {
      const actorId = parseActorId(req);
      if (!actorId) return send(res, 401, { error: 'x-user-id header required' });
      const body = await parseJson(req);
      if (!body.title || !body.fileDataUrl) return send(res, 400, { error: 'title and fileDataUrl are required' });

      const state = readDb();
      const project = { id: nextId(state.projects), team_id: null, title: body.projectTitle || body.title, created_by: actorId, created_at: nowIso() };
      state.projects.push(project);

      const session = {
        id: nextId(state.review_sessions), project_id: project.id, title: body.title, description: body.description || '',
        created_by: actorId, current_version_id: null, status: 'in_review', final_approved_by: null,
        final_approved_at: null, created_at: nowIso(), updated_at: nowIso()
      };
      state.review_sessions.push(session);

      const version = {
        id: nextId(state.review_versions), session_id: session.id, version_number: 1, file_url: body.fileDataUrl,
        file_type: body.fileType || 'png', source_type: 'upload', change_note: body.changeNote || 'Initial version',
        created_by: actorId, status: 'active', created_at: nowIso()
      };
      session.current_version_id = version.id;
      state.review_versions.push(version);

      state.session_participants.push({
        id: nextId(state.session_participants), session_id: session.id, user_id: actorId,
        role: 'owner', invited_by: actorId, created_at: nowIso()
      });
      logAction(state, session.id, actorId, 'session_created', { session_id: session.id, version_id: version.id });
      writeDb(state);
      return send(res, 201, { session, version, invite_link: `/index.html?session=${session.id}` });
    }

    if (req.method === 'GET' && pathname === '/sessions') {
      const actorId = Number(searchParams.get('user_id'));
      const state = readDb();
      if (!actorId) return send(res, 200, state.review_sessions);
      const allowed = state.session_participants.filter((p) => p.user_id === actorId).map((p) => p.session_id);
      return send(res, 200, state.review_sessions.filter((s) => allowed.includes(s.id)));
    }

    const sessionDetail = pathname.match(/^\/sessions\/(\d+)$/);
    if (req.method === 'GET' && sessionDetail) {
      const id = Number(sessionDetail[1]);
      const state = readDb();
      const session = state.review_sessions.find((s) => s.id === id);
      if (!session) return send(res, 404, { error: 'session not found' });
      const versions = state.review_versions.filter((v) => v.session_id === id).sort((a, b) => a.version_number - b.version_number);
      const comments = state.comments.filter((c) => c.session_id === id);
      const participants = state.session_participants.filter((p) => p.session_id === id);
      return send(res, 200, { session, versions, comments, participants });
    }

    const inviteMatch = pathname.match(/^\/sessions\/(\d+)\/invite$/);
    if (req.method === 'POST' && inviteMatch) {
      const actorId = parseActorId(req);
      if (!actorId) return send(res, 401, { error: 'x-user-id header required' });
      const sessionId = Number(inviteMatch[1]);
      const body = await parseJson(req);
      const state = readDb();
      if (!requireRole(state, sessionId, actorId, 'editor')) return send(res, 403, { error: 'forbidden' });
      if (!body.user_id) return send(res, 400, { error: 'user_id required' });

      const exists = state.session_participants.find((p) => p.session_id === sessionId && p.user_id === body.user_id);
      if (exists) return send(res, 409, { error: 'already invited' });
      const participant = {
        id: nextId(state.session_participants), session_id: sessionId, user_id: body.user_id,
        role: body.role || 'reviewer', invited_by: actorId, created_at: nowIso()
      };
      state.session_participants.push(participant);
      logAction(state, sessionId, actorId, 'participant_invited', { participant });
      writeDb(state);
      return send(res, 201, { participant });
    }

    const finalMatch = pathname.match(/^\/sessions\/(\d+)\/final-approve$/);
    if (req.method === 'POST' && finalMatch) {
      const actorId = parseActorId(req);
      if (!actorId) return send(res, 401, { error: 'x-user-id header required' });
      const sessionId = Number(finalMatch[1]);
      const state = readDb();
      const session = state.review_sessions.find((s) => s.id === sessionId);
      if (!session) return send(res, 404, { error: 'session not found' });
      if (!requireRole(state, sessionId, actorId, 'reviewer')) return send(res, 403, { error: 'forbidden' });
      const unresolved = state.comments.filter((c) => c.session_id === sessionId && !['resolved', 'ignored'].includes(c.status));
      if (unresolved.length) return send(res, 400, { error: 'unresolved_comments', count: unresolved.length });

      session.status = 'approved_final';
      session.final_approved_by = actorId;
      session.final_approved_at = nowIso();
      session.updated_at = nowIso();
      const current = state.review_versions.find((v) => v.id === session.current_version_id);
      if (current) current.status = 'approved';
      logAction(state, sessionId, actorId, 'session_final_approved', { version_id: session.current_version_id });
      writeDb(state);
      return send(res, 200, { session });
    }

    const postVersion = pathname.match(/^\/sessions\/(\d+)\/versions$/);
    if (req.method === 'POST' && postVersion) {
      const actorId = parseActorId(req);
      if (!actorId) return send(res, 401, { error: 'x-user-id header required' });
      const sessionId = Number(postVersion[1]);
      const body = await parseJson(req);
      if (!body.fileDataUrl) return send(res, 400, { error: 'fileDataUrl required' });

      const state = readDb();
      if (!requireRole(state, sessionId, actorId, 'editor')) return send(res, 403, { error: 'forbidden' });
      const session = state.review_sessions.find((s) => s.id === sessionId);
      if (!session) return send(res, 404, { error: 'session not found' });

      const prev = state.review_versions.find((v) => v.id === session.current_version_id);
      if (prev && prev.status === 'active') prev.status = 'superseded';
      const nextVersionNumber = Math.max(0, ...state.review_versions.filter((v) => v.session_id === sessionId).map((v) => v.version_number)) + 1;
      const version = {
        id: nextId(state.review_versions), session_id: sessionId, version_number: nextVersionNumber, file_url: body.fileDataUrl,
        file_type: body.fileType || 'png', source_type: 'upload', change_note: body.changeNote || '',
        created_by: actorId, status: 'active', created_at: nowIso()
      };
      state.review_versions.push(version);
      session.current_version_id = version.id;
      session.status = 'in_review';
      session.updated_at = nowIso();
      logAction(state, sessionId, actorId, 'version_uploaded', { version_id: version.id, version_number: version.version_number });
      writeDb(state);
      return send(res, 201, { version, session });
    }

    const getVersions = pathname.match(/^\/sessions\/(\d+)\/versions$/);
    if (req.method === 'GET' && getVersions) {
      const sessionId = Number(getVersions[1]);
      const state = readDb();
      const versions = state.review_versions.filter((v) => v.session_id === sessionId).sort((a, b) => b.version_number - a.version_number);
      return send(res, 200, versions);
    }

    const getVersion = pathname.match(/^\/versions\/(\d+)$/);
    if (req.method === 'GET' && getVersion) {
      const id = Number(getVersion[1]);
      const state = readDb();
      const version = state.review_versions.find((v) => v.id === id);
      if (!version) return send(res, 404, { error: 'version not found' });
      return send(res, 200, version);
    }

    const createComment = pathname.match(/^\/versions\/(\d+)\/comments$/);
    if (req.method === 'POST' && createComment) {
      const actorId = parseActorId(req);
      if (!actorId) return send(res, 401, { error: 'x-user-id header required' });
      const body = await parseJson(req);
      const versionId = Number(createComment[1]);
      if (!body.body || typeof body.x !== 'number' || typeof body.y !== 'number') return send(res, 400, { error: 'body, x, y required' });
      const state = readDb();
      const version = state.review_versions.find((v) => v.id === versionId);
      if (!version) return send(res, 404, { error: 'version not found' });
      if (!requireRole(state, version.session_id, actorId, 'reviewer')) return send(res, 403, { error: 'forbidden' });
      const comment = {
        id: nextId(state.comments), session_id: version.session_id, version_id: version.id, author_id: actorId,
        parent_comment_id: null, body: body.body, x: body.x, y: body.y, status: 'open', created_at: nowIso(), updated_at: nowIso()
      };
      state.comments.push(comment);
      logAction(state, version.session_id, actorId, 'comment_added', { comment_id: comment.id, version_id: version.id });
      writeDb(state);
      return send(res, 201, comment);
    }

    const listComments = pathname.match(/^\/versions\/(\d+)\/comments$/);
    if (req.method === 'GET' && listComments) {
      const versionId = Number(listComments[1]);
      const state = readDb();
      return send(res, 200, state.comments.filter((c) => c.version_id === versionId));
    }

    const patchComment = pathname.match(/^\/comments\/(\d+)$/);
    if (req.method === 'PATCH' && patchComment) {
      const actorId = parseActorId(req);
      if (!actorId) return send(res, 401, { error: 'x-user-id header required' });
      const id = Number(patchComment[1]);
      const body = await parseJson(req);
      const state = readDb();
      const comment = state.comments.find((c) => c.id === id);
      if (!comment) return send(res, 404, { error: 'comment not found' });
      if (!requireRole(state, comment.session_id, actorId, 'editor')) return send(res, 403, { error: 'forbidden' });
      if (body.status) comment.status = body.status;
      if (body.body) comment.body = body.body;
      comment.updated_at = nowIso();
      logAction(state, comment.session_id, actorId, 'comment_updated', { comment_id: id, status: comment.status });
      writeDb(state);
      return send(res, 200, comment);
    }

    const delComment = pathname.match(/^\/comments\/(\d+)$/);
    if (req.method === 'DELETE' && delComment) {
      const actorId = parseActorId(req);
      if (!actorId) return send(res, 401, { error: 'x-user-id header required' });
      const id = Number(delComment[1]);
      const state = readDb();
      const idx = state.comments.findIndex((c) => c.id === id);
      if (idx === -1) return send(res, 404, { error: 'comment not found' });
      const comment = state.comments[idx];
      if (!requireRole(state, comment.session_id, actorId, 'editor')) return send(res, 403, { error: 'forbidden' });
      state.comments.splice(idx, 1);
      logAction(state, comment.session_id, actorId, 'comment_deleted', { comment_id: id });
      writeDb(state);
      res.writeHead(204);
      return res.end();
    }

    const activityMatch = pathname.match(/^\/sessions\/(\d+)\/activity$/);
    if (req.method === 'GET' && activityMatch) {
      const sessionId = Number(activityMatch[1]);
      const state = readDb();
      const logs = state.activity_logs.filter((a) => a.session_id === sessionId).sort((a, b) => b.id - a.id);
      return send(res, 200, logs);
    }

    if (req.method === 'GET') {
      return serveStatic(req, res, pathname);
    }

    return send(res, 404, { error: 'not_found' });
  } catch (err) {
    return send(res, 500, { error: 'internal_error', message: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
