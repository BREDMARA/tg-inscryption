import fs from 'fs';
import path from 'path';

const DB_PATH = path.resolve('data/db.json');

const initialState = {
  users: [],
  projects: [],
  review_sessions: [],
  review_versions: [],
  comments: [],
  session_participants: [],
  activity_logs: []
};

function ensureDb() {
  if (!fs.existsSync('data')) fs.mkdirSync('data', { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(initialState, null, 2));
  }
}

export function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

export function writeDb(state) {
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

export function nextId(collection) {
  if (!collection.length) return 1;
  return Math.max(...collection.map((x) => x.id)) + 1;
}

export function nowIso() {
  return new Date().toISOString();
}

export function logAction(state, sessionId, actorId, actionType, payload = {}) {
  state.activity_logs.push({
    id: nextId(state.activity_logs),
    session_id: sessionId,
    actor_id: actorId,
    action_type: actionType,
    payload_json: payload,
    created_at: nowIso()
  });
}
