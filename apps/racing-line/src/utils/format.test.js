import { describe, it, expect } from 'vitest';
import { formatLap, formatDelta, kmh } from './format.js';

describe('formatLap', () => {
  it('casos básicos', () => {
    expect(formatLap(0)).toBe('00:00.000');
    expect(formatLap(83456)).toBe('01:23.456');
    expect(formatLap(null)).toBe('--:--.---');
    expect(formatLap(NaN)).toBe('--:--.---');
    expect(formatLap(Infinity)).toBe('--:--.---');
  });
  it('redondeo que arrastra minutos/segundos', () => {
    expect(formatLap(59999.5)).toBe('01:00.000');
    expect(formatLap(59999.4)).toBe('00:59.999');
    expect(formatLap(119999.6)).toBe('02:00.000');
  });
  it('negativos y cero negativo', () => {
    expect(formatLap(-1500)).toBe('-00:01.500');
    expect(formatLap(-0.4)).toBe('00:00.000');
    expect(formatLap(-0)).toBe('00:00.000');
  });
  it('más de 99 minutos', () => {
    expect(formatLap(100 * 60000)).toBe('100:00.000');
  });
});

describe('formatDelta', () => {
  it('signo y decimales', () => {
    expect(formatDelta(432)).toBe('+0.432');
    expect(formatDelta(-1201)).toBe('−1.201');
    expect(formatDelta(0)).toBe('±0.000');
    expect(formatDelta(null)).toBe('');
    expect(formatDelta(NaN)).toBe('');
  });
  it('valores que redondean a cero no llevan signo engañoso', () => {
    expect(formatDelta(0.4)).toBe('±0.000');
    expect(formatDelta(-0.4)).toBe('±0.000');
    expect(formatDelta(-0.5)).toBe('±0.000'); // Math.round(-0.5) = -0
    expect(formatDelta(1999.6)).toBe('+2.000');
  });
  it('kmh', () => {
    expect(kmh(null)).toBe('--');
    expect(kmh(10)).toBe(36);
  });
});
