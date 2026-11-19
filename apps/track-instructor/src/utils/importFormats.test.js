import { describe, it, expect } from 'vitest';
import { detectFormat, parseVBO, parseCSV, parseNMEALog, fixesFromText } from './importFormats.js';
import { sessionFromText, fixesToGPX } from './exportImport.js';
import { encodeFix } from '../telemetry/nmea.js';
import { parseFileList, listDeviceFiles, tcpDump, normalizeDeviceUrl } from '../telemetry/deviceDownload.js';
import { CIRCUITS, getTrackModel } from '../data/circuits.js';
import { createSimulator } from '../telemetry/simulator.js';
import { LapTimer } from '../telemetry/lapTimer.js';

const circuit = CIRCUITS.find((c) => c.id === 'cheste');
const model = getTrackModel(circuit);
const fixes = createSimulator(model, { laps: 2, seed: 11, rateHz: 10 }).generateAll().map((f) => ({ ...f, t: Math.round(f.t / 10) * 10 }));
const direct = new LapTimer(model);
fixes.forEach((f) => direct.push(f));

const pad = (n, w) => String(n).padStart(w, '0');
const hms = (t) => {
  const d = new Date(t);
  return `${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}${pad(d.getUTCSeconds(), 2)}.${pad(Math.floor(d.getUTCMilliseconds() / 10), 2)}`;
};

function toVBO(fx) {
  const d = new Date(fx[0].t);
  const rows = fx.map((f) => `014 ${hms(f.t)} ${(f.lat * 60).toFixed(6)} ${(-f.lon * 60).toFixed(6)} ${(f.speed * 3.6).toFixed(3)} 000.00 +00045.00`);
  return `File created on ${pad(d.getUTCDate(), 2)}/${pad(d.getUTCMonth() + 1, 2)}/${d.getUTCFullYear()} at 10:00:00\n\n[header]\nsatellites\ntime\nlatitude\nlongitude\nvelocity kmh\nheading\nheight\n\n[column names]\nsats time lat long velocity heading height\n\n[data]\n${rows.join('\n')}\n`;
}
function toRaceChronoCSV(fx) {
  const head = 'This file is created using RaceChrono v8\n\nSession title,Test\n\nTime (s),Fragment,Lap #,Distance (m),Latitude (deg),Longitude (deg),Speed (m/s)\nunix time,,,m,deg,deg,m/s';
  return head + '\n' + fx.map((f) => `${(f.t / 1000).toFixed(3)},0,,0,${f.lat.toFixed(7)},${f.lon.toFixed(7)},${f.speed.toFixed(3)}`).join('\n');
}
function toGenericCSV(fx) {
  return 'timestamp;latitude;longitude;speed_kmh\n' + fx.map((f) => `${new Date(f.t).toISOString()};${f.lat.toFixed(7)};${f.lon.toFixed(7)};${(f.speed * 3.6).toFixed(2)}`).join('\n');
}
const toNMEA = (fx) => fx.map((f) => encodeFix(f).join('\r\n')).join('\r\n');

const formats = [
  ['NMEA', 'sesion.nmea', toNMEA],
  ['VBO', 'sesion.vbo', toVBO],
  ['CSV RaceChrono', 'racechrono.csv', toRaceChronoCSV],
  ['CSV genérico (;)', 'log.csv', toGenericCSV],
  ['GPX', 'sesion.gpx', (fx) => fixesToGPX(fx)],
];

describe.each(formats)('importar %s', (_label, name, encode) => {
  it('mismas vueltas que la tanda original', () => {
    const text = encode(fixes);
    const { fixes: parsed } = fixesFromText(name, text);
    expect(parsed.length).toBeGreaterThan(fixes.length * 0.95);
    expect(parsed[0].lat).toBeCloseTo(fixes[0].lat, 5);
    expect(parsed[0].lon).toBeCloseTo(fixes[0].lon, 5);
    const s = sessionFromText(name, text, { source: 'device' });
    expect(s.circuitId).toBe('cheste');
    expect(s.source).toBe('device');
    expect(s.laps).toHaveLength(direct.laps.length);
    s.laps.forEach((l, i) => expect(Math.abs(l.timeMs - direct.laps[i].timeMs)).toBeLessThan(25));
  });
});

describe('detección de formato', () => {
  it('por extensión y por contenido', () => {
    expect(detectFormat('a.vbo', '')).toBe('vbo');
    expect(detectFormat('log.txt', '$GPRMC,1')).toBe('nmea');
    expect(detectFormat('x', '<?xml version="1.0"?><gpx>')).toBe('gpx');
    expect(detectFormat('x.csv', 'lat,lon\n1,2')).toBe('csv');
    expect(detectFormat('s.json', '{"laps":[]}')).toBe('json');
    expect(detectFormat('foto.jpg', 'ÿØÿà')).toBeNull();
  });
  it('archivo sin puntos válidos → error claro', () => {
    expect(() => fixesFromText('vacio.csv', 'lat,lon\n')).toThrow(/puntos GPS/);
  });
});

describe('descarga del GPS por WiFi', () => {
  it('normaliza la dirección', () => {
    expect(normalizeDeviceUrl('192.168.4.1')).toBe('http://192.168.4.1/');
    expect(normalizeDeviceUrl('http://10.0.0.1/logs')).toBe('http://10.0.0.1/logs');
  });
  it('lista de archivos desde una página HTML (índice de directorio)', () => {
    const html = `<html><body><h1>Index of /logs</h1><a href="../">../</a>
      <a href="2026-11-19_jerez.nmea">2026-11-19_jerez.nmea</a> 1.2M
      <a href="/logs/s2.vbo"><b>s2.vbo</b></a><a href="config.ini">config</a><a href="foto.jpg">x</a></body></html>`;
    const list = parseFileList(html, 'http://192.168.4.1/logs/');
    expect(list.map((f) => f.name)).toEqual(['2026-11-19_jerez.nmea', 's2.vbo']);
    expect(list[0].url).toBe('http://192.168.4.1/logs/2026-11-19_jerez.nmea');
    expect(list[1].url).toBe('http://192.168.4.1/logs/s2.vbo');
  });
  it('lista de archivos desde JSON', () => {
    const json = JSON.stringify({ files: [{ name: 'a.gpx', size: 2048, date: '2026-11-19' }, { path: '/dl?f=b.csv' }, 'c.txt'] });
    const list = parseFileList(json, 'http://192.168.4.1/api/files');
    expect(list.map((f) => f.name)).toEqual(['a.gpx', 'b.csv', 'c.txt']);
    expect(list[0]).toMatchObject({ url: 'http://192.168.4.1/api/a.gpx', size: 2048, date: '2026-11-19' });
  });
  it('servidor web → lista → descarga → sesión', async () => {
    const pages = {
      'http://192.168.4.1/': '<a href="tanda1.nmea">tanda1.nmea</a>',
      'http://192.168.4.1/tanda1.nmea': toNMEA(fixes),
    };
    const http = { get: async ({ url }) => (pages[url] ? { status: 200, data: pages[url] } : { status: 404, data: '' }) };
    const list = await listDeviceFiles('192.168.4.1', { http });
    expect(list).toHaveLength(1);
    const text = (await http.get({ url: list[0].url })).data;
    expect(sessionFromText(list[0].name, text).laps).toHaveLength(direct.laps.length);
  });
  it('volcado TCP: acumula hasta que el GPS cierra la conexión', async () => {
    const listeners = {};
    const plugin = {
      async addListener(ev, fn) {
        (listeners[ev] ||= []).push(fn);
        return { remove() {} };
      },
      async connect() {
        const text = toNMEA(fixes);
        setTimeout(() => {
          for (let i = 0; i < text.length; i += 1400) listeners.data.forEach((f) => f({ chunk: text.slice(i, i + 1400) }));
          listeners.status.forEach((f) => f({ state: 'closed' }));
        }, 10);
      },
      async disconnect() {},
    };
    const text = await tcpDump({ host: '192.168.4.1', port: 10110 }, plugin);
    expect(sessionFromText('volcado.nmea', text).laps).toHaveLength(direct.laps.length);
  });
  it('volcado TCP sin datos → error claro', async () => {
    const plugin = { async addListener() { return { remove() {} }; }, async connect() {}, async disconnect() {} };
    await expect(tcpDump({ host: '1.2.3.4', port: 1, idleMs: 20, maxMs: 50 }, plugin)).rejects.toThrow(/no ha enviado datos/);
  });
});

describe('tiempo de uso', async () => {
  const { usageTotals, sessionUsage, formatDuration, formatKm } = await import('../storage/usage.js');
  it('la sesión guarda tiempo en movimiento y distancia, y las simuladas no cuentan', () => {
    const real = sessionFromText('tanda.nmea', toNMEA(fixes), { source: 'device' });
    const lapsMs = real.laps.reduce((a, l) => a + l.timeMs, 0);
    expect(real.durationMs).toBeGreaterThan(lapsMs); // incluye vuelta de salida y entrada
    expect(real.distanceM).toBeGreaterThan(circuit.lengthM * real.laps.length);
    const sim = { ...real, id: 'x', source: 'sim' };
    const t = usageTotals([real, sim]);
    expect(t.sessions).toBe(1);
    expect(t.durationMs).toBe(real.durationMs);
    expect(t.byCircuit.cheste.laps).toBe(real.laps.length);
    expect(usageTotals([real], { since: real.createdAt + 1 }).sessions).toBe(0);
  });
  it('sesiones antiguas sin duración: suma de vueltas y distancia de los puntos', () => {
    const old = sessionFromText('tanda.nmea', toNMEA(fixes));
    delete old.durationMs;
    delete old.distanceM;
    const u = sessionUsage(old);
    expect(u.durationMs).toBe(old.laps.reduce((a, l) => a + l.timeMs, 0));
    expect(u.distanceM).toBeGreaterThan(circuit.lengthM * old.laps.length * 0.97);
  });
  it('parado en boxes no suma tiempo', () => {
    const still = Array.from({ length: 600 }, (_, i) => ({ ...fixes[0], t: fixes[0].t - 600000 + i * 1000, speed: 0 }));
    const s = sessionFromText('tanda.nmea', toNMEA([...still, ...fixes]));
    const moving = sessionFromText('tanda.nmea', toNMEA(fixes));
    expect(Math.abs(s.durationMs - moving.durationMs)).toBeLessThan(2000);
  });
  it('formato', () => {
    expect(formatDuration(3 * 3600000 + 25 * 60000)).toBe('3 h 25 min');
    expect(formatDuration(45 * 60000)).toBe('45 min');
    expect(formatKm(12345)).toBe('12,3 km');
  });
});
