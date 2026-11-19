// Fuente GPS real: navigator.geolocation.watchPosition con alta precisión.

export function isGeolocationAvailable() {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

export function createGpsSource() {
  let watchId = null;
  // Algunos navegadores (Android con hora GPS, iOS antiguos) dan pos.timestamp
  // en un reloj distinto de Date.now(). El cronómetro compara now() con los t
  // de los fixes, así que estimamos el desfase como el mínimo (Date.now() −
  // timestamp) visto (la latencia siempre suma, el mínimo se acerca al desfase
  // real). Por debajo de 1 s se ignora (es latencia normal).
  let minLag = null;
  const skew = () => (minLag != null && Math.abs(minLag) > 1000 ? minLag : 0);
  return {
    kind: 'gps',
    now: () => Date.now() - skew(),
    start(onFix, _onEnd, onError) {
      minLag = null;
      if (!isGeolocationAvailable()) {
        onError?.(new Error('Geolocalización no disponible en este dispositivo'));
        return;
      }
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const c = pos.coords;
          const lag = Date.now() - pos.timestamp;
          if (Number.isFinite(lag) && (minLag == null || lag < minLag)) minLag = lag;
          onFix({
            lat: c.latitude,
            lon: c.longitude,
            t: pos.timestamp,
            speed: Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null, // m/s (algunos dan −1 = desconocida)
            accuracy: c.accuracy,
            heading: c.heading,
          });
        },
        (err) => onError?.(err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    },
    stop() {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    },
  };
}

/** Mantiene la pantalla encendida durante la tanda (si el navegador lo permite). */
export async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) return await navigator.wakeLock.request('screen');
  } catch {
    /* sin soporte o denegado */
  }
  return null;
}
