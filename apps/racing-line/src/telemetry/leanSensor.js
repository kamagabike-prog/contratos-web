// Ángulo de inclinación (lean angle) a partir de DeviceOrientationEvent.
//
// Montaje previsto: móvil sujeto a la moto (tija/depósito). Con el móvil en
// vertical (pantalla hacia el piloto) el alabeo de la moto gira el teléfono
// alrededor del eje perpendicular a la pantalla. Con la matriz de rotación
// Z-X'-Y'' (alpha, beta, gamma) de la especificación W3C:
//   eje X del dispositivo, componente vertical:  Xz = −cos β · sin γ
//   eje Y del dispositivo, componente vertical:  Yz =  sin β
//   lean = atan2(−Xz, Yz) = atan2(cos β · sin γ, sin β)
// Si el móvil va tumbado (|β| < 35°) se usa directamente γ.
// Al iniciar se calibra el cero con la moto recta.
//
// Nota: la orientación del navegador fusiona giroscopio y acelerómetro; en
// curva la aceleración centrípeta puede sesgar la lectura. Es una medida
// orientativa, no sustituye a una IMU dedicada.

const DEG = Math.PI / 180;

export function isOrientationAvailable() {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

/** iOS 13+ exige pedir permiso desde un gesto del usuario. */
export async function requestOrientationPermission() {
  try {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      return (await DOE.requestPermission()) === 'granted';
    }
    return isOrientationAvailable();
  } catch {
    return false;
  }
}

export function rawLean(beta, gamma) {
  if (beta == null || gamma == null) return null;
  if (Math.abs(beta) < 35) return gamma; // montaje horizontal
  return Math.atan2(Math.cos(beta * DEG) * Math.sin(gamma * DEG), Math.sin(beta * DEG)) / DEG;
}

export function createLeanSensor() {
  let zero = null;
  let current = null;
  let gotEvent = false;
  const onOrient = (e) => {
    const l = rawLean(e.beta, e.gamma);
    if (l == null) return;
    gotEvent = true;
    if (zero == null) zero = l;
    let v = l - zero;
    if (v > 180) v -= 360;
    if (v < -180) v += 360;
    // filtro paso bajo suave para quitar vibración del motor
    current = current == null ? v : current * 0.7 + v * 0.3;
  };
  return {
    start() {
      if (isOrientationAvailable()) window.addEventListener('deviceorientation', onOrient);
    },
    stop() {
      window.removeEventListener('deviceorientation', onOrient);
    },
    recalibrate() {
      zero = null;
      current = null;
    },
    /** Grados (+ izquierda / − derecha) o null si no hay sensor. */
    get value() {
      return gotEvent ? current : null;
    },
  };
}
