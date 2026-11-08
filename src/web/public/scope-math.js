/* Pure display maths for the spectrum and waterfall (palettes, contrast, averaging, peak hold, zoom). Classic script, no DOM access. */
(() => {
  'use strict';

  const ZOOM_LEVELS = [1, 2, 4, 8, 16];
  const DB_OF = (v) => v / 2 - 140; // same encoding as the spectrum frames
  const BYTE_OF = (db) => Math.max(0, Math.min(255, Math.round((db + 140) * 2)));

  const PALETTES = {
    classic: [[0, 0, 0, 24], [0.25, 0, 40, 170], [0.5, 0, 200, 220], [0.75, 255, 220, 0], [1, 255, 40, 20]],
    grayscale: [[0, 0, 0, 0], [1, 255, 255, 255]],
    fire: [[0, 0, 0, 0], [0.4, 150, 0, 0], [0.7, 255, 140, 0], [1, 255, 255, 200]],
    // Colour-blind friendly: luminance rises monotonically from dark blue to light yellow.
    viridis: [[0, 68, 1, 84], [0.33, 49, 104, 142], [0.66, 53, 183, 121], [1, 253, 231, 37]],
  };

  /**
   * Contrast stretch around mid-scale.
   * @param {number} t Normalised level 0..1.
   * @param {number} contrast -100..100 (0 = unchanged); each 50 doubles or halves the slope.
   * @returns {number} Level 0..1.
   */
  function applyContrast(t, contrast) {
    const factor = 2 ** (Math.max(-100, Math.min(100, contrast)) / 50);
    return Math.max(0, Math.min(1, (t - 0.5) * factor + 0.5));
  }

  /**
   * Build a 256-entry RGB lookup table.
   * @param {string} name A key of PALETTES (unknown names fall back to classic).
   * @param {number} [contrast] See applyContrast.
   * @returns {Uint8ClampedArray} 768 bytes (r, g, b per level).
   */
  function buildLut(name, contrast = 0) {
    const stops = PALETTES[name] || PALETTES.classic;
    const out = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = applyContrast(i / 255, contrast);
      let k = 0;
      while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      const [t0, r0, g0, b0] = stops[k];
      const [t1, r1, g1, b1] = stops[k + 1];
      const f = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
      out[i * 3] = r0 + (r1 - r0) * f;
      out[i * 3 + 1] = g0 + (g1 - g0) * f;
      out[i * 3 + 2] = b0 + (b1 - b0) * f;
    }
    return out;
  }

  /**
   * Exponential average in the linear power domain (averaging dB values would bias the noise floor).
   * @param {number} frames Time constant in frames; 1 disables averaging.
   * @returns {{push(frame: Uint8Array): Uint8Array, reset(): void}}
   */
  function createAverager(frames) {
    const alpha = 1 / Math.max(1, frames);
    let acc = null;
    return {
      push(frame) {
        if (!acc || acc.length !== frame.length) acc = Float64Array.from(frame, (v) => 10 ** (DB_OF(v) / 10));
        else for (let i = 0; i < frame.length; i++) acc[i] += alpha * (10 ** (DB_OF(frame[i]) / 10) - acc[i]);
        return Uint8Array.from(acc, (p) => BYTE_OF(10 * Math.log10(p)));
      },
      reset() { acc = null; },
    };
  }

  /**
   * Peak hold with a slow fall so that the trace stays readable.
   * @param {number} decayDb Fall per frame in dB (0 = hold forever until reset).
   * @returns {{push(frame: Uint8Array): Uint8Array, reset(): void}}
   */
  function createPeakHold(decayDb) {
    let held = null;
    return {
      push(frame) {
        if (!held || held.length !== frame.length) held = Float64Array.from(frame, DB_OF);
        else for (let i = 0; i < frame.length; i++) held[i] = Math.max(DB_OF(frame[i]), held[i] - decayDb);
        return Uint8Array.from(held, BYTE_OF);
      },
      reset() { held = null; },
    };
  }

  /**
   * Visible part of the spectrum for a zoom level.
   * @param {number} zoom 1..16 (clamped).
   * @param {number} center Centre of the window as a fraction 0..1 of the full span.
   * @returns {{start: number, end: number}} Fractions of the full span; the window never leaves 0..1.
   */
  function zoomWindow(zoom, center) {
    const z = Math.max(1, Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], zoom));
    const width = 1 / z;
    const start = Math.max(0, Math.min(1 - width, center - width / 2));
    return { start, end: start + width };
  }

  /** @param {{start: number, end: number}} win @param {number} f Fraction inside the window. @returns {number} Fraction of the full span. */
  const windowToFull = (win, f) => win.start + f * (win.end - win.start);

  /** @param {{start: number, end: number}} win @param {number} f Fraction of the full span. @returns {number} Fraction inside the window (may be outside 0..1). */
  const fullToWindow = (win, f) => (f - win.start) / (win.end - win.start);

  globalThis.BHScope = Object.freeze({
    ZOOM_LEVELS, PALETTES, applyContrast, buildLut, createAverager, createPeakHold, zoomWindow, windowToFull, fullToWindow,
  });
})();
