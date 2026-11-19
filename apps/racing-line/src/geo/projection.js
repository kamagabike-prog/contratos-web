// Proyección GPS (WGS84) <-> plano local en metros (ENU simplificado).
// Para el tamaño de un circuito (< 3 km) una proyección equirectangular
// centrada en el circuito tiene un error muy inferior al del propio GPS.

const R = 6378137; // radio ecuatorial WGS84 (m)
const DEG = Math.PI / 180;

/**
 * Crea un proyector centrado en (lat0, lon0).
 * x = Este (m), y = Norte (m).
 */
export function createProjection(lat0, lon0) {
  const cosLat0 = Math.cos(lat0 * DEG);
  return {
    lat0,
    lon0,
    toXY(lat, lon) {
      return {
        x: (lon - lon0) * DEG * R * cosLat0,
        y: (lat - lat0) * DEG * R,
      };
    },
    toLatLon(x, y) {
      return {
        lat: lat0 + y / (R * DEG),
        lon: lon0 + x / (R * DEG * cosLat0),
      };
    },
  };
}

/** Distancia haversine en metros entre dos coordenadas. */
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
