import { utcSlot } from './decoders.js';
import { describeMessage } from './ft8-message.js';

/**
 * Connect the RX audio stream to the decoder of the current mode and publish what they decode.
 *
 * Invariant: never throws into the audio path; decoder failures are logged and the frame is dropped.
 * @param {{rxAudio: {addTap: Function}|null, station: {status(): {mode: string|null}}, decoders: {get(mode: string): object},
 *   publish: (msg: object) => void, now?: () => number, logger?: {error: Function}}} deps
 * @returns {{stop(): void}}
 */
export function createDecodeService({ rxAudio, station, decoders, publish, now = Date.now, logger = console }) {
  let activeMode = null;

  function emit(mode, slotStartMs, list) {
    if (!Array.isArray(list) || list.length === 0) return;
    const messages = list.map((m) => ({ ...m, ...(mode === 'CW' ? {} : describeMessageFields(m.text)) }));
    publish({ type: 'decode', mode, slotStartMs, messages });
  }

  function onFrame(frame) {
    const mode = station.status().mode;
    if (mode !== activeMode) {
      if (activeMode) decoders.get(activeMode).reset?.();
      activeMode = mode;
    }
    if (!mode || mode === 'USB') return;
    const decoder = decoders.get(mode);
    if (decoder.available === false) return;
    try {
      const t = now();
      const result = mode === 'CW' ? decoder.decode(frame) : decoder.decode(frame, utcSlot(mode, t), t);
      if (result && typeof result.then === 'function') {
        result.then((list) => emitTagged(mode, t, list), (err) => logger.error('decoder failed:', err?.message));
      } else {
        emitTagged(mode, t, result);
      }
    } catch (err) {
      logger.error('decoder failed:', err?.message);
    }
  }

  function emitTagged(mode, t, list) {
    if (!Array.isArray(list) || list.length === 0) return;
    emit(mode, mode === 'CW' ? t : list[0].slotStartMs ?? t, list);
  }

  const untap = rxAudio?.addTap?.(onFrame) ?? (() => {});
  return { stop: untap };
}

function describeMessageFields(text) {
  const d = describeMessage(text);
  const out = {};
  if (d.to) out.to = d.to;
  if (d.from) out.from = d.from;
  if (d.grid) out.grid = d.grid;
  if (d.report) out.report = d.report;
  return out;
}
