// CW (Morse) decoder in pure JavaScript.
// Tone search with a Goertzel filter bank (300-1200 Hz), adaptive keying threshold, adaptive dot length (5-40 WPM).

/** Morse table: letters, digits, common punctuation and prosigns (written as <XX>). */
export const MORSE = Object.freeze({
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F', '--.': 'G', '....': 'H', '..': 'I',
  '.---': 'J', '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R',
  '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X', '-.--': 'Y', '--..': 'Z',
  '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4', '.....': '5', '-....': '6', '--...': '7',
  '---..': '8', '----.': '9',
  '.-.-.-': '.', '--..--': ',', '..--..': '?', '.----.': "'", '-.-.--': '!', '-..-.': '/', '-.--.-': ')',
  '---...': ':', '-.-.-.': ';', '-....-': '-', '..--.-': '_', '.-..-.': '"', '...-..-': '$', '.--.-.': '@',
  '.-.-.': '<AR>', '...-.-': '<SK>', '-...-': '<BT>', '-.--.': '<KN>', '.-...': '<AS>', '-.-.-': '<CT>',
  '........': '<HH>', '...---...': '<SOS>',
});

const BLOCK_MS = 10;
const MIN_HZ_DEFAULT = 300;
const MAX_HZ_DEFAULT = 1200;
const BIN_STEP_HZ = 25;
const HISTORY_BLOCKS = 150;
const LOCK_AFTER_BLOCKS = 30;
const MAX_MARKS = 40;
const START_MARKS = 6;

/**
 * Create a streaming CW decoder.
 * @param {{sampleRate?: number, minHz?: number, maxHz?: number}} [opts]
 * @returns {{mode: 'CW', available: true, decode(frame: Float32Array|Int16Array): Array<{text: string, wpm: number, freqHz: number}>,
 *   flush(): Array<{text: string, wpm: number, freqHz: number}>, reset(): void, info(): {freqHz: number|null, wpm: number|null}}}
 *   `decode` takes mono PCM of any frame size and returns newly decoded text chunks (zero or one element).
 */
export function createCwDecoder({ sampleRate = 12000, minHz = MIN_HZ_DEFAULT, maxHz = MAX_HZ_DEFAULT } = {}) {
  const blockLen = Math.round((sampleRate * BLOCK_MS) / 1000);
  const freqs = [];
  for (let f = minHz; f <= maxHz; f += BIN_STEP_HZ) freqs.push(f);
  const nBins = freqs.length;
  const coeff = Float64Array.from(freqs, (f) => 2 * Math.cos((2 * Math.PI * f) / sampleRate));
  const s1 = new Float64Array(nBins);
  const s2 = new Float64Array(nBins);
  const amp = new Float64Array(nBins);
  const scale = 2 / blockLen;
  const MIN_DOT = 120 / 40;
  const MAX_DOT = 120 / 5;
  let st;

  function freshState() {
    return {
      inBlock: 0,
      history: new Float32Array(HISTORY_BLOCKS * nBins),
      histCount: 0,
      histPos: 0,
      ema: new Float64Array(nBins),
      emaCount: 0,
      sortScratch: new Float64Array(nBins),
      noiseRms: 0,
      lock: -1,
      hi: 0,
      keyed: false,
      pendingCount: 0,
      run: 0,
      dot: 0,
      marks: [],
      ready: false,
      startup: [],
      elements: [],
      pendingSpace: false,
      wroteText: false,
      out: '',
      blockCounter: 0,
    };
  }
  st = freshState();

  function medianPower() {
    const a = st.sortScratch;
    a.set(st.ema);
    a.sort();
    return a[nBins >> 1];
  }

  function updateDot(len) {
    const marks = st.marks;
    marks.push(len);
    if (marks.length > MAX_MARKS) marks.shift();
    const sorted = [...marks].sort((a, b) => a - b);
    let best = null;
    if (sorted.length >= 2) {
      let bestSse = Infinity;
      for (let split = 1; split < sorted.length; split++) {
        const lo = sorted.slice(0, split);
        const hi = sorted.slice(split);
        const mLo = lo.reduce((a, b) => a + b, 0) / lo.length;
        const mHi = hi.reduce((a, b) => a + b, 0) / hi.length;
        let sse = 0;
        for (const v of lo) sse += (v - mLo) ** 2;
        for (const v of hi) sse += (v - mHi) ** 2;
        if (sse < bestSse) { bestSse = sse; best = { mLo, mHi }; }
      }
    }
    let dot;
    if (best && best.mHi / best.mLo >= 2 && best.mHi / best.mLo <= 4.5) {
      dot = best.mLo;
    } else {
      const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      if (st.dot === 0) dot = mean;
      else if (mean > 2.2 * st.dot) dot = mean / 3;
      else dot = mean;
    }
    st.dot = Math.min(MAX_DOT, Math.max(MIN_DOT, dot));
  }

  // Replays the buffered start-up marks/gaps once the dot estimate is based on enough marks.
  function initTiming() {
    st.ready = true;
    const items = st.startup;
    st.startup = [];
    for (const it of items) {
      if (it.mark) { st.elements.push(it.len); continue; }
      if (st.elements.length === 0) continue;
      if (it.len >= 5 * st.dot) {
        finishChar();
        st.pendingSpace = true;
      } else if (it.len >= 2 * st.dot) {
        finishChar();
      }
    }
  }

  function finishChar() {
    if (!st.ready) initTiming();
    if (st.elements.length === 0) return;
    let pattern = '';
    for (const len of st.elements) pattern += len > 2 * st.dot ? '-' : '.';
    st.elements = [];
    const ch = MORSE[pattern] ?? '*';
    if (st.pendingSpace && st.wroteText) st.out += ' ';
    st.pendingSpace = false;
    st.out += ch;
    st.wroteText = true;
  }

  function keyerBlock(m) {
    const noise = st.noiseRms;
    if (m > st.hi) st.hi = m;
    else st.hi *= 0.9995;
    const gate = st.hi > 4 * noise && st.hi > 1e-6;
    const span = st.hi - noise;
    const thr = noise + (st.keyed ? 0.4 : 0.55) * span;
    const raw = gate && m > thr;
    if (raw === st.keyed) {
      st.pendingCount = 0;
    } else if (st.pendingCount === 0) {
      st.pendingCount = 1;
    } else {
      st.pendingCount = 0;
      endRun(raw);
      return;
    }
    st.run++;
    if (!st.keyed) {
      const dot = st.dot || 0;
      if (dot > 0 && st.elements.length > 0 && st.run >= 2 * dot) finishChar();
      if (dot > 0 && st.run >= 5 * dot && st.wroteText) {
        finishChar();
        st.pendingSpace = true;
      }
    }
  }

  // The first block of the new state was already counted for the old one, which keeps durations unbiased.
  function endRun(newKeyed) {
    if (st.keyed) {
      // mark ended
      updateDot(st.run);
      if (st.ready) st.elements.push(st.run);
      else {
        st.startup.push({ mark: true, len: st.run });
        if (st.startup.length >= 2 * START_MARKS) initTiming();
      }
    } else if (!st.ready && st.startup.length > 0) {
      st.startup.push({ mark: false, len: st.run });
    }
    st.keyed = newKeyed;
    st.run = 1;
  }

  function processBlock() {
    for (let i = 0; i < nBins; i++) {
      const p = s1[i] * s1[i] + s2[i] * s2[i] - coeff[i] * s1[i] * s2[i];
      amp[i] = Math.sqrt(Math.max(p, 0)) * scale;
      s1[i] = 0;
      s2[i] = 0;
    }
    st.blockCounter++;
    st.emaCount++;
    const alpha = Math.max(1 / st.emaCount, 0.01);
    let peak = 0;
    let peakIdx = 0;
    for (let i = 0; i < nBins; i++) {
      st.ema[i] += alpha * (amp[i] * amp[i] - st.ema[i]);
      if (st.ema[i] > peak) { peak = st.ema[i]; peakIdx = i; }
    }
    const med = medianPower();
    st.noiseRms = Math.sqrt(med);

    if (st.lock < 0) {
      st.history.set(amp, st.histPos * nBins);
      st.histPos = (st.histPos + 1) % HISTORY_BLOCKS;
      st.histCount = Math.min(st.histCount + 1, HISTORY_BLOCKS);
      if (st.histCount >= LOCK_AFTER_BLOCKS && peak > 6 * med && peak > 1e-10) {
        st.lock = peakIdx;
        const start = (st.histPos - st.histCount + HISTORY_BLOCKS) % HISTORY_BLOCKS;
        for (let k = 0; k < st.histCount; k++) keyerBlock(st.history[((start + k) % HISTORY_BLOCKS) * nBins + st.lock]);
      }
      return;
    }
    if (peakIdx !== st.lock && Math.abs(peakIdx - st.lock) > 1 && peak > 2.5 * st.ema[st.lock]) {
      finishChar();
      st.lock = peakIdx;
      st.hi = 0;
      st.keyed = false;
      st.run = 0;
      st.marks = [];
      st.dot = 0;
      st.ready = false;
      st.startup = [];
    }
    keyerBlock(amp[st.lock]);
  }

  function takeChunk() {
    if (!st.out) return [];
    const text = st.out;
    st.out = '';
    return [{ text, wpm: currentWpm(), freqHz: freqs[st.lock] }];
  }

  function currentWpm() {
    return st.dot > 0 ? Math.max(5, Math.min(40, Math.round(120 / st.dot))) : 0;
  }

  return {
    mode: 'CW',
    available: true,
    decode(frame) {
      for (let n = 0; n < frame.length; n++) {
        const x = frame instanceof Int16Array ? frame[n] / 32768 : frame[n];
        for (let i = 0; i < nBins; i++) {
          const s = x + coeff[i] * s1[i] - s2[i];
          s2[i] = s1[i];
          s1[i] = s;
        }
        if (++st.inBlock === blockLen) {
          st.inBlock = 0;
          processBlock();
        }
      }
      return takeChunk();
    },
    flush() {
      if (st.lock >= 0) finishChar();
      return takeChunk();
    },
    reset() {
      s1.fill(0);
      s2.fill(0);
      st = freshState();
    },
    info() {
      return { freqHz: st.lock >= 0 ? freqs[st.lock] : null, wpm: st.dot > 0 ? currentWpm() : null };
    },
  };
}
