// Persistencia de sesiones en IndexedDB (con respaldo en localStorage).
//
// Una sesión guarda las vueltas con sus puntos en el plano local del circuito
// en formato compacto [x, y, tRelativo, v] para minimizar espacio.

const DB_NAME = 'racing-line';
const STORE = 'sessions';
const LS_KEY = 'racing-line:sessions';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const lsRead = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
};
const lsWrite = (list) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* cuota llena o almacenamiento bloqueado */
  }
};

export function packLap(lap) {
  const t0 = lap.startT;
  return {
    number: lap.number,
    startT: lap.startT,
    timeMs: Math.round(lap.timeMs),
    pts: lap.points.map((p) => [
      Math.round(p.x * 100) / 100,
      Math.round(p.y * 100) / 100,
      Math.round(p.t - t0),
      p.v == null ? null : Math.round(p.v * 100) / 100,
    ]),
  };
}

export function unpackLap(l) {
  return {
    number: l.number,
    startT: l.startT,
    timeMs: l.timeMs,
    points: l.pts.map(([x, y, t, v]) => ({ x, y, t: l.startT + t, v })),
  };
}

export async function saveSession(session) {
  try {
    await withStore('readwrite', (s) => s.put(session));
  } catch {
    const list = lsRead().filter((x) => x.id !== session.id);
    list.push(session);
    lsWrite(list);
  }
}

export async function listSessions() {
  let list;
  try {
    list = await withStore('readonly', (s) => s.getAll());
  } catch {
    list = lsRead();
  }
  return (list || []).sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteSession(id) {
  try {
    await withStore('readwrite', (s) => s.delete(id));
  } catch {
    lsWrite(lsRead().filter((x) => x.id !== id));
  }
}
