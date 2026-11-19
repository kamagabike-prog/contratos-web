// Fuente GPS externa por WiFi: receptor que envía NMEA 0183 por TCP o UDP.
//
// Los navegadores no pueden abrir conexiones TCP/UDP, así que esta fuente
// solo funciona dentro de la app nativa (iOS, Capacitor), que trae el plugin
// NmeaSocket (plugins/nmea-socket). La interfaz es la misma que la del GPS
// del móvil: { kind, now(), start(onFix, onEnd, onError), stop() }.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { LineSplitter, NmeaAssembler } from './nmea.js';

const NmeaSocket = registerPlugin('NmeaSocket');

const PREFS_KEY = 'racing-line:extgps';
export const DEFAULT_EXT_CONFIG = { protocol: 'tcp', host: '192.168.4.1', port: 10110 };

/** ¿Puede esta plataforma conectar con un receptor por WiFi? */
export function isExternalGpsAvailable() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NmeaSocket');
  } catch {
    return false;
  }
}

export function loadExtConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (c && (c.protocol === 'tcp' || c.protocol === 'udp')) return { ...DEFAULT_EXT_CONFIG, ...c };
  } catch {
    /* sin almacenamiento */
  }
  return { ...DEFAULT_EXT_CONFIG };
}

export function saveExtConfig(cfg) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(cfg));
  } catch {
    /* sin almacenamiento */
  }
}

/** Valida la configuración; devuelve un mensaje de error o null. */
export function validateExtConfig(cfg) {
  const port = Number(cfg.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'El puerto debe ser un número entre 1 y 65535.';
  if (cfg.protocol === 'tcp') {
    const h = String(cfg.host || '').trim();
    if (!h) return 'Escribe la IP del receptor (por ejemplo 192.168.4.1).';
    if (!/^[A-Za-z0-9.-]+$/.test(h) && !/^[0-9a-fA-F:]+$/.test(h)) return 'La IP o el nombre del receptor no es válido.';
  }
  return null;
}

/** Mantiene la pantalla encendida en la app nativa (el Wake Lock web no llega a iOS). */
export async function setNativeKeepAwake(enabled) {
  try {
    if (isExternalGpsAvailable()) await NmeaSocket.setKeepAwake({ enabled });
  } catch {
    /* no crítico */
  }
}

/**
 * @param {{protocol:'tcp'|'udp', host?:string, port:number}} cfg
 * @param {object} [opts]
 * @param {(s:object) => void} [opts.onStatus]  estado de la conexión para la UI
 * @param {object} [opts.plugin]  plugin inyectable (tests)
 * @param {() => number} [opts.clock]  reloj (tests)
 */
export function createExternalGpsSource(cfg, opts = {}) {
  const plugin = opts.plugin ?? NmeaSocket;
  const clock = opts.clock ?? (() => Date.now());
  const onStatus = opts.onStatus ?? (() => {});
  let running = false;
  let handles = [];
  let retryTimer = null;
  let splitter = new LineSplitter();
  let asm = new NmeaAssembler({ now: clock });
  let minLag = null; // desfase reloj del receptor (UTC) ↔ reloj del móvil
  const recent = []; // instantes de llegada de fixes para estimar los Hz
  let status = { state: 'idle', hz: 0, sats: null, hdop: null, lastFixAt: null, error: null };

  const setStatus = (patch) => {
    status = { ...status, ...patch };
    onStatus(status);
  };
  const skew = () => (minLag != null ? minLag : 0);

  const connect = async (onError) => {
    if (!running) return;
    setStatus({ state: 'connecting', error: null });
    try {
      await plugin.connect({ protocol: cfg.protocol, host: String(cfg.host || '').trim(), port: Number(cfg.port) });
      if (cfg.protocol === 'udp') setStatus({ state: 'listening' });
    } catch (e) {
      setStatus({ state: 'error', error: e?.message || String(e) });
      onError?.(new Error(e?.message || 'No se pudo conectar con el receptor'));
      scheduleRetry(onError);
    }
  };

  const scheduleRetry = (onError) => {
    if (!running || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      splitter = new LineSplitter();
      connect(onError);
    }, 2000);
  };

  return {
    kind: 'ext',
    get status() {
      return status;
    },
    now: () => clock() - skew(),
    async start(onFix, _onEnd, onError) {
      running = true;
      splitter = new LineSplitter();
      asm = new NmeaAssembler({ now: clock });
      minLag = null;
      recent.length = 0;
      handles.push(
        await plugin.addListener('data', ({ chunk }) => {
          if (!running || typeof chunk !== 'string') return;
          for (const line of splitter.push(chunk)) {
            const fix = asm.push(line);
            if (!fix) continue;
            const arrival = clock();
            // El reloj UTC del receptor manda; estimamos el desfase con el móvil
            // como el mínimo (llegada − hora del fix): la latencia siempre suma.
            const lag = arrival - fix.t;
            if (minLag == null || lag < minLag) minLag = lag;
            recent.push(arrival);
            while (recent.length && arrival - recent[0] > 2000) recent.shift();
            setStatus({
              state: 'receiving',
              hz: recent.length / 2,
              sats: fix.sats,
              hdop: fix.hdop,
              lastFixAt: arrival,
              error: null,
            });
            onFix(fix);
          }
        })
      );
      handles.push(
        await plugin.addListener('status', ({ state, error }) => {
          if (!running) return;
          if (state === 'ready') setStatus({ state: 'connected', error: null });
          else if (state === 'listening') setStatus({ state: 'listening', error: null });
          else if (state === 'waiting' || state === 'failed' || state === 'closed') {
            setStatus({ state: 'reconnecting', error: error || null });
            if (state !== 'waiting') scheduleRetry(onError); // 'waiting' = Network.framework ya reintenta
          }
        })
      );
      await connect(onError);
    },
    stop() {
      running = false;
      clearTimeout(retryTimer);
      retryTimer = null;
      for (const h of handles) h?.remove?.();
      handles = [];
      Promise.resolve(plugin.disconnect?.()).catch(() => {});
      setStatus({ state: 'idle', hz: 0 });
    },
    /** Estadísticas del lector NMEA (frases leídas, inválidas, fixes). */
    get stats() {
      return asm.stats;
    },
  };
}
