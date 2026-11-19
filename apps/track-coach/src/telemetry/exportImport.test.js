// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { CIRCUITS, getTrackModel } from '../data/circuits.js';
import { LapTimer } from './lapTimer.js';
import { createSimulator } from './simulator.js';
import { analyzeLap } from './analysis.js';
import { listSessions, unpackLap } from '../storage/sessions.js';
import {
  fixesToGPX,
  lapToGPX,
  lapToCSV,
  parseGPX,
  parseGPXRegex,
  detectCircuit,
  sessionFromFixes,
  sessionToJSON,
  sessionFromJSON,
  importSessionFile,
} from '../utils/exportImport.js';

const circuit = CIRCUITS.find((c) => c.id === 'jerez');
const model = getTrackModel(circuit);
const fixes = createSimulator(model, { laps: 2, seed: 1, vmaxKmh: circuit.vmaxKmh }).generateAll();

const cut = (fx) => {
  const timer = new LapTimer(model);
  for (const f of fx) timer.push(f);
  return timer.laps;
};

describe('GPX', () => {
  const gpx = fixesToGPX(fixes, { name: 'Jerez <test> & co' });

  it('genera GPX 1.1 con trkpt, time y extensión speed', () => {
    expect(gpx.startsWith('<?xml')).toBe(true);
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx).toContain('Jerez &lt;test&gt; &amp; co');
    expect(gpx.match(/<trkpt /g)).toHaveLength(fixes.length);
    expect(gpx).toMatch(/<trkpt lat="36\.\d{7}" lon="-6\.\d{7}"><time>\d{4}-\d\d-\d\dT[\d:.]+Z<\/time><extensions><speed>[\d.]+<\/speed><lean>-?[\d.]+<\/lean><\/extensions><\/trkpt>/);
  });

  it('round trip: simulador → GPX → parse → LapTimer = 2 vueltas', () => {
    const parsed = parseGPX(gpx);
    expect(parsed).toHaveLength(fixes.length);
    expect(parsed[10].lat).toBeCloseTo(fixes[10].lat, 6);
    expect(parsed[10].t).toBe(Math.round(fixes[10].t));
    expect(parsed[10].speed).toBeCloseTo(fixes[10].speed, 1);
    const laps = cut(parsed);
    const orig = cut(fixes);
    expect(laps).toHaveLength(2);
    laps.forEach((l, i) => expect(Math.abs(l.timeMs - orig[i].timeMs)).toBeLessThan(20));
  });

  it('el parser por regex (sin DOM) da el mismo resultado', () => {
    const a = parseGPXRegex(gpx);
    expect(a).toHaveLength(fixes.length);
    expect(a[5].lat).toBeCloseTo(fixes[5].lat, 6);
    expect(Date.parse(a[5].time)).toBe(Math.round(fixes[5].t));
  });

  it('GPX de terceros: prefijos de namespace, sin velocidad → se estima', () => {
    const ext = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2"><trk><trkseg>
      <trkpt lon="-6.0342" lat="36.7086"><ele>10</ele><time>2026-05-01T10:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>30.5</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions></trkpt>
      <trkpt lon="-6.0340" lat="36.7086"><time>2026-05-01T10:00:01Z</time></trkpt>
    </trkseg></trk></gpx>`;
    const p = parseGPX(ext);
    expect(p[0]).toMatchObject({ lat: 36.7086, lon: -6.0342, speed: 30.5 });
    const noSpeed = parseGPX(ext.replace(/<extensions>.*?<\/extensions>/s, ''));
    expect(noSpeed[0].speed).toBeGreaterThan(15); // ~17.9 m en 1 s
    expect(noSpeed[0].speed).toBeLessThan(20);
    expect(() => parseGPX(ext.replace(/<time>[^<]*<\/time>/g, ''))).toThrow(/marcas de tiempo/);
  });

  it('detecta el circuito por el centro más cercano', () => {
    expect(detectCircuit(fixes).id).toBe('jerez');
    const mm = CIRCUITS.find((c) => c.id === 'montmelo');
    expect(detectCircuit([{ lat: mm.center[0] + 0.003, lon: mm.center[1] }]).id).toBe('montmelo');
    expect(detectCircuit([{ lat: 48.85, lon: 2.35 }])).toBeNull();
  });

  it('GPX de una vuelta guardada (plano local → lat/lon)', () => {
    const lap = cut(fixes)[0];
    const g = lapToGPX(lap, model.proj);
    const back = parseGPX(g);
    expect(back).toHaveLength(lap.points.length);
    const xy = model.proj.toXY(back[3].lat, back[3].lon);
    expect(Math.hypot(xy.x - lap.points[3].x, xy.y - lap.points[3].y)).toBeLessThan(0.05);
  });
});

describe('CSV', () => {
  it('columnas, filas y valores', () => {
    const lap = unpackLap(sessionFromFixes(fixes, { circuit, model }).laps[0]);
    const stats = analyzeLap(lap.points, model.racingLine, model.proj);
    const csv = lapToCSV(stats, model.proj, lap.startT);
    const rows = csv.trim().split('\n');
    expect(rows[0]).toBe('t_ms,lat,lon,speed_kmh,lean_deg,deviation_m');
    expect(rows).toHaveLength(stats.smooth.length + 1);
    const first = rows[1].split(',');
    expect(first).toHaveLength(6);
    expect(Number(first[0])).toBe(0);
    expect(Number(first[1])).toBeCloseTo(36.7, 0);
    const last = rows[rows.length - 1].split(',');
    expect(Number(last[0])).toBeCloseTo(lap.timeMs, -1);
    const speeds = rows.slice(1).map((r) => Number(r.split(',')[3]));
    expect(Math.max(...speeds)).toBeGreaterThan(150);
    expect(Math.max(...rows.slice(1).map((r) => Math.abs(Number(r.split(',')[5]))))).toBeCloseTo(stats.maxDeviationM, 1);
  });
});

describe('sesión', () => {
  beforeEach(() => localStorage.clear());

  it('fixes → sesión con el formato de LiveView', () => {
    const s = sessionFromFixes(fixes, { circuit, model });
    expect(s).toMatchObject({ circuitId: 'jerez', source: 'gpx', gpsHz: 1 });
    expect(s.laps).toHaveLength(2);
    expect(s.laps[0].pts[0]).toHaveLength(5);
    expect(s.laps[0].sectors).toHaveLength(3);
  });

  it('JSON round trip', () => {
    const s = sessionFromFixes(fixes, { circuit, model });
    const back = sessionFromJSON(sessionToJSON(s));
    expect(back).toEqual(s);
    expect(() => sessionFromJSON('{"foo":1}')).toThrow();
    expect(() => sessionFromJSON('no json')).toThrow(/JSON/);
  });

  it('importSessionFile guarda GPX y JSON', async () => {
    const file = (name, text) => ({ name, text: async () => text });
    const s = await importSessionFile(file('tanda.gpx', fixesToGPX(fixes)));
    expect(s.laps).toHaveLength(2);
    expect(s.name).toBe('tanda');
    const s2 = await importSessionFile(file('x.json', sessionToJSON({ ...s, id: 'otra' })));
    expect(s2.id).toBe('otra');
    expect((await listSessions()).map((x) => x.id).sort()).toEqual([s.id, 'otra'].sort());
  });
});
