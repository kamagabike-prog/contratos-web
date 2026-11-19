// Persistencia offline de sesiones en localStorage.
//
// Cada vuelta guarda sus puntos en el plano local del circuito en formato
// compacto [x, y, tRelativo, v, lean] para aprovechar el límite de ~5 MB.

const LS_KEY = 'racing-line:sessions:v2';

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Escribe la lista; si se llena el almacenamiento, descarta las sesiones más antiguas. */
function write(list) {
  const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
  while (sorted.length) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(sorted));
      return true;
    } catch {
      if (sorted.length === 1) return false;
      sorted.pop(); // cuota excedida → eliminar la más antigua
    }
  }
  return false;
}

const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

export function packLap(lap) {
  const t0 = lap.startT;
  return {
    number: lap.number,
    startT: lap.startT,
    timeMs: Math.round(lap.timeMs),
    // redondeo coherente: T3 = vuelta − T1 − T2 para que la suma cuadre al ms
    sectors: lap.sectors
      ? [Math.round(lap.sectors[0]), Math.round(lap.sectors[1]), Math.round(lap.timeMs) - Math.round(lap.sectors[0]) - Math.round(lap.sectors[1])]
      : null,
    maxSpeed: r2(lap.maxSpeed),
    maxLean: lap.maxLean == null ? null : Math.round(lap.maxLean * 10) / 10,
    pts: lap.points.map((p) => [r2(p.x), r2(p.y), Math.round(p.t - t0), r2(p.v), p.lean == null ? null : Math.round(p.lean * 10) / 10]),
  };
}

export function unpackLap(l) {
  return {
    number: l.number,
    startT: l.startT,
    timeMs: l.timeMs,
    sectors: l.sectors,
    maxSpeed: l.maxSpeed,
    maxLean: l.maxLean,
    points: l.pts.map(([x, y, t, v, lean]) => ({ x, y, t: l.startT + t, v, lean: lean ?? null })),
  };
}

export async function saveSession(session) {
  const list = read().filter((x) => x.id !== session.id);
  list.push(session);
  if (!write(list)) throw new Error('No hay espacio en el almacenamiento local');
}

export async function listSessions() {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteSession(id) {
  write(read().filter((x) => x.id !== id));
}
