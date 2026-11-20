import { useEffect, useState } from 'react';
import { getReferenceLine, onReferenceChange } from '../storage/referenceLines.js';

/** Trazada de referencia del circuito (o null), actualizada al cambiarla. */
export function useReferenceLine(circuitId) {
  const [ref, setRef] = useState(() => (circuitId ? getReferenceLine(circuitId) : null));
  useEffect(() => {
    setRef(circuitId ? getReferenceLine(circuitId) : null);
    return onReferenceChange(() => setRef(circuitId ? getReferenceLine(circuitId) : null));
  }, [circuitId]);
  return ref;
}
