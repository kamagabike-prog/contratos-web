// Fuente GPS real: navigator.geolocation.watchPosition con alta precisión.

export function isGeolocationAvailable() {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

export function createGpsSource() {
  let watchId = null;
  return {
    kind: 'gps',
    now: () => Date.now(),
    start(onFix, _onEnd, onError) {
      if (!isGeolocationAvailable()) {
        onError?.(new Error('Geolocalización no disponible en este dispositivo'));
        return;
      }
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const c = pos.coords;
          onFix({
            lat: c.latitude,
            lon: c.longitude,
            t: pos.timestamp,
            speed: Number.isFinite(c.speed) ? c.speed : null, // m/s
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
