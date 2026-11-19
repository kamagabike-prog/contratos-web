// Descarga de sesiones grabadas por un GPS / data-logger externo vía WiFi.
//
// Dos formas habituales de compartir los datos:
//   · Servidor web (HTTP): el dispositivo crea su WiFi y sirve una página
//     o un JSON con la lista de archivos (http://192.168.4.1/). La app lee la
//     lista, descarga los archivos elegidos (GPX, NMEA, VBO, CSV) y los
//     convierte en sesiones cronometradas.
//   · Volcado TCP: al conectarse a un puerto, el dispositivo envía su
//     registro (texto NMEA u otro formato) y cierra o deja de enviar.
//
// En la app de iPhone las peticiones van por la capa nativa (CapacitorHttp y
// el plugin NmeaSocket), sin las restricciones de CORS ni de contenido mixto
// que impiden a un navegador hablar con un aparato de la red local.

import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { IMPORT_EXTENSIONS } from '../utils/importFormats.js';

const NmeaSocket = registerPlugin('NmeaSocket');
const PREFS_KEY = 'racing-line:device-download';

export const DEFAULT_DOWNLOAD_CONFIG = { method: 'http', url: 'http://192.168.4.1/', host: '192.168.4.1', port: 10110 };

export const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

export function loadDownloadConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (c && (c.method === 'http' || c.method === 'tcp')) return { ...DEFAULT_DOWNLOAD_CONFIG, ...c };
  } catch {
    /* sin almacenamiento */
  }
  return { ...DEFAULT_DOWNLOAD_CONFIG };
}

export function saveDownloadConfig(cfg) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(cfg));
  } catch {
    /* sin almacenamiento */
  }
}

/** Normaliza lo que escribe el usuario: "192.168.4.1" → "http://192.168.4.1/". */
export function normalizeDeviceUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Escribe la dirección del GPS (por ejemplo 192.168.4.1).');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  if (!u.pathname || u.pathname === '') u.pathname = '/';
  return u.toString();
}

/** GET de texto: nativo en la app (sin CORS), fetch en el navegador. */
export async function httpGetText(url, { http = isNative() ? CapacitorHttp : null, timeoutMs = 15000 } = {}) {
  if (http) {
    const res = await http.get({ url, responseType: 'text', connectTimeout: 8000, readTimeout: timeoutMs });
    if (res.status < 200 || res.status >= 300) throw new Error(`El GPS respondió ${res.status} en ${url}`);
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`El GPS respondió ${res.status} en ${url}`);
    return await res.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('El GPS no responde: comprueba que el móvil está conectado a su WiFi.');
    throw new Error(
      isNative()
        ? `No se pudo conectar con ${url}: ${e.message}`
        : 'El navegador no puede descargar de un GPS de la red local (seguridad del navegador). Usa la app de iPhone, o exporta el archivo desde el GPS e impórtalo.'
    );
  } finally {
    clearTimeout(timer);
  }
}

const EXT_RE = new RegExp(`\\.(${IMPORT_EXTENSIONS.join('|')})(\\?.*)?$`, 'i');
const NAME_EXT_RE = new RegExp(`\\.(${IMPORT_EXTENSIONS.join('|')})$`, 'i');

/** Nombre del archivo: último tramo de la ruta, o el parámetro que lo lleva (/dl?f=tanda.csv). */
function fileNameFromUrl(url) {
  const u = new URL(url);
  const last = decodeURIComponent(u.pathname.split('/').pop() || '');
  if (NAME_EXT_RE.test(last)) return last;
  for (const v of u.searchParams.values()) {
    const name = v.split('/').pop();
    if (NAME_EXT_RE.test(name)) return name;
  }
  return last || u.hostname;
}

/**
 * Lista de archivos de sesión a partir de la respuesta del dispositivo:
 *  · JSON: array de nombres/objetos o { files: [...] } con name/url/size/date
 *  · HTML: enlaces <a href="..."> a archivos con extensión conocida
 *  · texto: una ruta por línea
 * @returns {{name:string, url:string, size?:number, date?:string}[]}
 */
export function parseFileList(body, baseUrl) {
  const out = [];
  const add = (name, href, extra = {}) => {
    if (!href || !EXT_RE.test(href.split('#')[0])) return;
    let url;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (out.some((f) => f.url === url)) return;
    const file = name || fileNameFromUrl(url);
    out.push({ name: file, url, ...extra });
  };

  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);
      const list = Array.isArray(data) ? data : data.files ?? data.sessions ?? data.logs ?? [];
      for (const it of list) {
        if (typeof it === 'string') add(null, it);
        else if (it && typeof it === 'object') {
          const href = it.url ?? it.href ?? it.path ?? it.name ?? it.file;
          add(it.name ?? it.file ?? null, href, {
            ...(Number.isFinite(it.size) ? { size: it.size } : {}),
            ...(it.date || it.mtime ? { date: String(it.date ?? it.mtime) } : {}),
          });
        }
      }
      return out;
    } catch {
      /* no era JSON: seguimos como HTML/texto */
    }
  }
  const hrefRe = /<a\b[^>]*href\s*=\s*["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = hrefRe.exec(body))) add(m[2].replace(/<[^>]+>/g, '').trim() || null, m[1]);
  if (!out.length) for (const line of body.split(/\r?\n/)) add(null, line.trim());
  return out;
}

/** Lee la lista de sesiones del GPS (servidor web). */
export async function listDeviceFiles(urlInput, opts) {
  const url = normalizeDeviceUrl(urlInput);
  const body = await httpGetText(url, opts);
  const files = parseFileList(body, url);
  if (!files.length) throw new Error('El GPS no muestra archivos de sesión (GPX, NMEA, VBO o CSV) en esa dirección.');
  return files;
}

/** Descarga el texto de un archivo de sesión. */
export const downloadDeviceFile = (file, opts) => httpGetText(file.url, { timeoutMs: 120000, ...opts });

/**
 * Volcado TCP: se conecta y acumula todo lo que envíe el dispositivo hasta
 * que cierre la conexión, deje de enviar `idleMs` o pasen `maxMs`.
 * @returns {Promise<string>}
 */
export function tcpDump({ host, port, idleMs = 3000, maxMs = 180000, onProgress } = {}, plugin = NmeaSocket) {
  return new Promise((resolve, reject) => {
    let text = '';
    let idleTimer = null;
    let done = false;
    const handles = [];
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(idleTimer);
      clearTimeout(maxTimer);
      handles.forEach((h) => h?.remove?.());
      Promise.resolve(plugin.disconnect?.()).catch(() => {});
      if (err && !text) reject(err);
      else if (!text) reject(new Error('El GPS no ha enviado datos. Comprueba la IP, el puerto y que esté en modo descarga.'));
      else resolve(text);
    };
    const bumpIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(), idleMs);
    };
    const maxTimer = setTimeout(() => finish(), maxMs);
    (async () => {
      handles.push(
        await plugin.addListener('data', ({ chunk }) => {
          if (done || typeof chunk !== 'string') return;
          text += chunk;
          onProgress?.(text.length);
          bumpIdle();
        })
      );
      handles.push(
        await plugin.addListener('status', ({ state, error }) => {
          if (done) return;
          if (state === 'closed' || state === 'cancelled') finish();
          else if (state === 'failed') finish(new Error(error || 'No se pudo conectar con el GPS'));
        })
      );
      await plugin.connect({ protocol: 'tcp', host: String(host || '').trim(), port: Number(port) });
      // primera espera más larga: algunos aparatos tardan en empezar el volcado
      idleTimer = setTimeout(() => finish(), Math.max(idleMs, 10000));
    })().catch((e) => finish(new Error(e?.message || 'No se pudo conectar con el GPS')));
  });
}
