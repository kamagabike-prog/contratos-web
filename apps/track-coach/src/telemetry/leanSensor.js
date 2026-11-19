// Ángulo de inclinación (lean angle) a partir de DeviceOrientationEvent.
//
// Montaje previsto: móvil sujeto a la moto (tija/depósito). Con la matriz de
// rotación Z-X'-Y'' (alpha, beta, gamma) de la especificación W3C, el vector
// "arriba" del mundo expresado en ejes del dispositivo es:
//   Xz = −cos β · sin γ     (eje X: borde derecho de la pantalla)
//   Yz =  sin β             (eje Y: borde superior)
//   Zz =  cos β · cos γ     (eje Z: normal a la pantalla)
// Al inclinar la moto a la IZQUIERDA el borde derecho del móvil sube (Xz > 0)
// en ambos montajes, y el ángulo es el giro de "arriba" alrededor del eje de
// alabeo de la moto:
//   · vertical (pantalla hacia el piloto, eje de alabeo = Z):  lean = atan2(Xz, Yz)
//   · tumbado  (pantalla arriba, borde superior hacia delante, eje = Y):
//                                                             lean = atan2(Xz, Zz)
// Convenio: + = izquierda, − = derecha (como el simulador y la vista en vivo).
// El montaje se decide UNA vez al calibrar (moto recta) y se mantiene: decidirlo
// en cada lectura haría que un móvil vertical muy inclinado (β baja hacia 30°
// a 60° de inclinación) saltara a la fórmula de montaje tumbado.
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

/** Montaje según la orientación en reposo: 'flat' si la pantalla está más horizontal que vertical. */
export function detectMount(beta, gamma) {
  if (beta == null || gamma == null) return null;
  const Yz = Math.sin(beta * DEG);
  const Zz = Math.cos(beta * DEG) * Math.cos(gamma * DEG);
  return Math.abs(Zz) > Math.abs(Yz) ? 'flat' : 'upright';
}

/**
 * Inclinación bruta (grados, + izquierda) para un montaje dado.
 * @param {'upright'|'flat'} [mount]  si se omite se detecta con la propia lectura
 */
export function rawLean(beta, gamma, mount = detectMount(beta, gamma)) {
  if (beta == null || gamma == null || !Number.isFinite(beta) || !Number.isFinite(gamma)) return null;
  const Xz = -Math.cos(beta * DEG) * Math.sin(gamma * DEG);
  const ref = mount === 'flat' ? Math.cos(beta * DEG) * Math.cos(gamma * DEG) : Math.sin(beta * DEG);
  return Math.atan2(Xz, ref) / DEG;
}

/** Normaliza un ángulo a (−180, 180]. */
export function wrap180(a) {
  a = ((a + 180) % 360 + 360) % 360 - 180;
  return a === -180 ? 180 : a;
}

export function createLeanSensor() {
  let zero = null;
  let mount = null;
  let current = null;
  let gotEvent = false;
  const onOrient = (e) => {
    // el montaje se fija en la calibración (primera lectura válida)
    const m = mount ?? detectMount(e.beta, e.gamma);
    const l = rawLean(e.beta, e.gamma, m);
    if (l == null) return;
    gotEvent = true;
    if (zero == null) {
      zero = l;
      mount = m;
    }
    const v = wrap180(l - zero);
    // filtro paso bajo suave para quitar vibración del motor; se filtra la
    // diferencia normalizada para no promediar mal al cruzar ±180°
    current = current == null ? v : wrap180(current + 0.3 * wrap180(v - current));
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
      mount = null;
      current = null;
    },
    /** Grados (+ izquierda / − derecha) o null si no hay sensor. */
    get value() {
      return gotEvent ? current : null;
    },
  };
}
