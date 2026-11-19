#!/usr/bin/env node
// Simulador de receptor GPS por WiFi: emite NMEA 0183 (RMC + GGA + GST) de
// vueltas simuladas en un circuito, en tiempo real, por TCP o UDP.
//
// Sirve para probar el modo «GPS WiFi» de la app sin tener el receptor:
// pon el ordenador y el iPhone en la misma WiFi y conecta la app a la IP
// del ordenador.
//
//   npm run nmea-sim -- --circuit jerez --hz 10 --port 10110            (TCP, servidor)
//   npm run nmea-sim -- --udp 192.168.1.50 --port 10110 --hz 25          (UDP hacia el iPhone)
//
// Opciones: --circuit <id> (jerez, montmelo, cheste, aragon, navarra,
// albacete, almeria, cartagena) · --laps N · --hz 1..25 · --port N ·
// --udp <ip del iPhone> · --speed <multiplicador de tiempo>

import net from 'node:net';
import dgram from 'node:dgram';
import os from 'node:os';
import { CIRCUITS, getTrackModel } from '../src/data/circuits.js';
import { createSimulator } from '../src/telemetry/simulator.js';
import { encodeFix } from '../src/telemetry/nmea.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const circuitId = opt('circuit', 'jerez');
const laps = Number(opt('laps', 5));
const hz = Math.max(1, Math.min(25, Number(opt('hz', 10))));
const port = Number(opt('port', 10110));
const udpTarget = opt('udp', null);
const speed = Math.max(0.1, Number(opt('speed', 1)));

const circuit = CIRCUITS.find((c) => c.id === circuitId);
if (!circuit) {
  console.error(`Circuito desconocido: ${circuitId}. Opciones: ${CIRCUITS.map((c) => c.id).join(', ')}`);
  process.exit(1);
}
const model = getTrackModel(circuit);

function makeTrack() {
  // el simulador integra a 10 Hz; para > 10 Hz interpolamos entre fixes
  const base = createSimulator(model, { laps, rateHz: Math.min(hz, 10), vmaxKmh: circuit.vmaxKmh, seed: Date.now() }).generateAll();
  if (hz <= 10) return base;
  const out = [];
  const k = Math.round(hz / 10);
  for (let i = 0; i < base.length - 1; i++) {
    const a = base[i];
    const b = base[i + 1];
    for (let j = 0; j < k; j++) {
      const w = j / k;
      out.push({ lat: a.lat + (b.lat - a.lat) * w, lon: a.lon + (b.lon - a.lon) * w, t: a.t + (b.t - a.t) * w, speed: a.speed + (b.speed - a.speed) * w });
    }
  }
  out.push(base[base.length - 1]);
  return out;
}

/** Reproduce la tanda en bucle llamando a send(texto) en tiempo real. */
function play(send) {
  let fixes = makeTrack();
  let i = 0;
  let t0 = Date.now();
  let f0 = fixes[0].t;
  const tick = () => {
    const elapsed = (Date.now() - t0) * speed;
    while (i < fixes.length && fixes[i].t - f0 <= elapsed) {
      const f = fixes[i];
      // hora UTC actual en el NMEA, como un receptor real
      const fix = { ...f, t: t0 + (f.t - f0) / speed, course: 0 };
      send(encodeFix(fix).join('\r\n') + '\r\n');
      i++;
    }
    if (i >= fixes.length) {
      fixes = makeTrack();
      i = 0;
      t0 = Date.now();
      f0 = fixes[0].t;
      console.log('↻ nueva tanda');
    }
  };
  return setInterval(tick, 1000 / Math.max(hz, 20));
}

const ips = Object.values(os.networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => n.address);

console.log(`Track Instructor · simulador NMEA · ${circuit.name} · ${laps} vueltas · ${hz} Hz${speed !== 1 ? ` · ×${speed}` : ''}`);

if (udpTarget) {
  const sock = dgram.createSocket('udp4');
  play((text) => sock.send(text, port, udpTarget));
  console.log(`Enviando UDP a ${udpTarget}:${port}. En la app: GPS WiFi → UDP → puerto ${port}.`);
} else {
  const clients = new Set();
  const server = net.createServer((s) => {
    s.setNoDelay(true);
    clients.add(s);
    console.log(`+ cliente ${s.remoteAddress}`);
    s.on('close', () => clients.delete(s));
    s.on('error', () => clients.delete(s));
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Servidor TCP en el puerto ${port}. En la app: GPS WiFi → TCP → IP ${ips.join(' o ') || '(IP de este ordenador)'} · puerto ${port}.`);
  });
  play((text) => clients.forEach((c) => c.write(text)));
}
