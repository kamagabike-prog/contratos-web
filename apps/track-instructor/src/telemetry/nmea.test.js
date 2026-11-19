import { describe, it, expect } from 'vitest';
import { checksum, parseSentence, parseCoord, NmeaAssembler, LineSplitter, encodeFix } from './nmea.js';
import { createExternalGpsSource, validateExtConfig } from './externalGpsSource.js';
import { CIRCUITS, getTrackModel } from '../data/circuits.js';
import { createSimulator } from './simulator.js';
import { LapTimer } from './lapTimer.js';

// Frases reales de ejemplo (formato u-blox M8/M9)
const RMC = '$GNRMC,103512.40,A,3642.51234,N,00602.05678,W,85.432,271.5,191126,,,A*';
const GGA = '$GNGGA,103512.40,3642.51234,N,00602.05678,W,1,14,0.70,45.0,M,50.0,M,,*';
const withCs = (s) => s + checksum(s.slice(1, -1));

describe('NMEA 0183', () => {
  it('checksum y validación', () => {
    expect(checksum('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,')).toBe('47');
    expect(parseSentence('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47')?.type).toBe('GGA');
    expect(parseSentence('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*48')).toBeNull();
    expect(parseSentence('basura')).toBeNull();
  });
  it('coordenadas con hemisferio', () => {
    expect(parseCoord('3642.51234', 'N')).toBeCloseTo(36.708539, 6);
    expect(parseCoord('00602.05678', 'W')).toBeCloseTo(-6.034280, 6);
    expect(parseCoord('', 'N')).toBeNull();
  });
  it('RMC + GGA → fix con hora UTC del receptor, velocidad y satélites', () => {
    const a = new NmeaAssembler({ now: () => Date.UTC(2026, 10, 19, 10, 35, 13) });
    // sin RMC previa, la GGA ya da un fix; después, RMC es la frase principal
    expect(a.push(withCs(GGA)).t).toBe(Date.UTC(2026, 10, 19, 10, 35, 12, 400));
    const fix = a.push(withCs(RMC.replace('103512.40', '103512.50')));
    expect(fix.lat).toBeCloseTo(36.708539, 5);
    expect(fix.lon).toBeCloseTo(-6.03428, 5);
    expect(fix.t).toBe(Date.UTC(2026, 10, 19, 10, 35, 12, 500));
    expect(fix.speed).toBeCloseTo(85.432 * 0.514444, 4);
    expect(fix.sats).toBe(14);
    expect(fix.accuracy).toBeCloseTo(0.7 * 2.5, 5);
  });
  it('ignora fixes no válidos (estado V / calidad 0)', () => {
    const a = new NmeaAssembler();
    expect(a.push(withCs(RMC.replace(',A,3642', ',V,3642')))).toBeNull();
    expect(a.push(withCs(GGA.replace(',W,1,14', ',W,0,00')))).toBeNull();
  });
  it('receptor solo con GGA + VTG', () => {
    const now = Date.UTC(2026, 10, 19, 10, 35, 13);
    const a = new NmeaAssembler({ now: () => now });
    a.push(withCs('$GPVTG,271.5,T,,M,85.4,N,158.2,K,A*'));
    const fix = a.push(withCs(GGA.replace('GNGGA', 'GPGGA')));
    expect(fix.t).toBe(Date.UTC(2026, 10, 19, 10, 35, 12, 400));
    expect(fix.speed).toBeCloseTo(158.2 / 3.6, 4);
  });
  it('troceado de un flujo TCP con líneas partidas', () => {
    const s = new LineSplitter();
    expect(s.push('$GNRMC,1')).toEqual([]);
    expect(s.push('23\r\n$GNGGA,2\r\n$GN')).toEqual(['$GNRMC,123', '$GNGGA,2']);
    expect(s.push('VTG\n')).toEqual(['$GNVTG']);
  });
  it('codificar y volver a leer: mismo fix', () => {
    const fix = { lat: 41.5701234, lon: 2.2612345, t: Date.UTC(2026, 10, 19, 9, 1, 2, 300), speed: 70.1, course: 200 };
    const a = new NmeaAssembler();
    const out = encodeFix(fix).map((l) => a.push(l)).filter(Boolean);
    expect(out).toHaveLength(1);
    expect(out[0].lat).toBeCloseTo(fix.lat, 6);
    expect(out[0].lon).toBeCloseTo(fix.lon, 6);
    expect(out[0].t).toBe(fix.t);
    expect(out[0].speed).toBeCloseTo(fix.speed, 2);
  });
});

describe('validación de la configuración', () => {
  it('TCP necesita IP y puerto válido; UDP solo puerto', () => {
    expect(validateExtConfig({ protocol: 'tcp', host: '192.168.4.1', port: 10110 })).toBeNull();
    expect(validateExtConfig({ protocol: 'tcp', host: '', port: 10110 })).toMatch(/IP/);
    expect(validateExtConfig({ protocol: 'tcp', host: '10.0.0.5', port: 70000 })).toMatch(/puerto/);
    expect(validateExtConfig({ protocol: 'udp', host: '', port: 10110 })).toBeNull();
  });
});

/** Plugin falso que imita al nativo: emite 'data' con trozos arbitrarios. */
function fakePlugin() {
  const listeners = {};
  return {
    calls: [],
    async addListener(ev, fn) {
      (listeners[ev] ||= []).push(fn);
      return { remove: () => (listeners[ev] = listeners[ev].filter((f) => f !== fn)) };
    },
    async connect(o) {
      this.calls.push(['connect', o]);
      listeners.status?.forEach((f) => f({ state: 'ready' }));
    },
    async disconnect() {
      this.calls.push(['disconnect']);
    },
    emit(ev, data) {
      listeners[ev]?.forEach((f) => f(data));
    },
  };
}

describe('fuente GPS externa (WiFi)', () => {
  it('vueltas simuladas a 10 Hz por NMEA/TCP → mismas vueltas que el GPS directo', async () => {
    const c = CIRCUITS.find((x) => x.id === 'jerez');
    const model = getTrackModel(c);
    const fixes = createSimulator(model, { laps: 2, seed: 3, rateHz: 10 }).generateAll();

    const direct = new LapTimer(model);
    fixes.forEach((f) => direct.push(f));

    const plugin = fakePlugin();
    let clockNow = fixes[0].t + 80; // el móvil recibe cada fix ~80 ms después
    const statuses = [];
    const src = createExternalGpsSource({ protocol: 'tcp', host: '192.168.4.1', port: 10110 }, { plugin, clock: () => clockNow, onStatus: (s) => statuses.push(s.state) });
    const timer = new LapTimer(model);
    await src.start((f) => timer.push(f));
    expect(plugin.calls[0]).toEqual(['connect', { protocol: 'tcp', host: '192.168.4.1', port: 10110 }]);

    // Flujo TCP: frases concatenadas y cortadas en trozos de tamaño irregular
    let stream = '';
    for (const f of fixes) {
      clockNow = f.t + 80;
      stream += encodeFix(f).join('\r\n') + '\r\n';
      while (stream.length > 97) {
        plugin.emit('data', { chunk: stream.slice(0, 97) });
        stream = stream.slice(97);
      }
    }
    plugin.emit('data', { chunk: stream });

    expect(statuses).toContain('connected');
    expect(statuses).toContain('receiving');
    expect(src.status.hz).toBeGreaterThan(8);
    expect(timer.laps).toHaveLength(direct.laps.length);
    timer.laps.forEach((l, i) => expect(Math.abs(l.timeMs - direct.laps[i].timeMs)).toBeLessThan(15));
    expect(src.now() - clockNow).toBeLessThanOrEqual(0); // reloj corregido al del receptor
    src.stop();
    expect(plugin.calls.at(-1)).toEqual(['disconnect']);
  });

  it('reintenta la conexión si se corta', async () => {
    const plugin = fakePlugin();
    const src = createExternalGpsSource({ protocol: 'tcp', host: '192.168.4.1', port: 10110 }, { plugin });
    await src.start(() => {});
    plugin.emit('status', { state: 'closed', error: 'Connection reset' });
    expect(src.status.state).toBe('reconnecting');
    await new Promise((r) => setTimeout(r, 2100));
    expect(plugin.calls.filter((c) => c[0] === 'connect')).toHaveLength(2);
    src.stop();
  }, 5000);
});
