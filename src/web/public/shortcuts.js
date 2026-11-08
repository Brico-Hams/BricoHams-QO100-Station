/* Keyboard shortcut map. Classic script, no DOM access. Space is reserved for push-to-talk and is handled by app.js only;
   no entry here can arm or key the transmitter. */
(() => {
  'use strict';

  const SHORTCUTS = Object.freeze([
    { key: ' ', action: 'ptt', label: 'Hold to transmit (only while you hold the turn)' },
    { key: '1', action: 'mode-usb', label: 'Mode SSB' },
    { key: '2', action: 'mode-cw', label: 'Mode CW' },
    { key: '3', action: 'mode-ft8', label: 'Mode FT8' },
    { key: '4', action: 'mode-ft4', label: 'Mode FT4' },
    { key: ',', action: 'tune-down', label: 'Tune down one step' },
    { key: '.', action: 'tune-up', label: 'Tune up one step' },
    { key: '<', action: 'tune-down-fast', label: 'Tune down 10 steps' },
    { key: '>', action: 'tune-up-fast', label: 'Tune up 10 steps' },
    { key: '[', action: 'rit-down', label: 'RIT -10 Hz' },
    { key: ']', action: 'rit-up', label: 'RIT +10 Hz' },
    { key: '{', action: 'xit-down', label: 'XIT -10 Hz' },
    { key: '}', action: 'xit-up', label: 'XIT +10 Hz' },
    { key: '0', action: 'offsets-clear', label: 'Clear RIT and XIT' },
    { key: 'l', action: 'txlock-toggle', label: 'Lock / unlock TX frequency to RX' },
    { key: 'f', action: 'filter-cycle', label: 'Next filter width' },
    { key: 'a', action: 'agc-cycle', label: 'Next AGC mode' },
    { key: 's', action: 'squelch-cycle', label: 'Next squelch level' },
    { key: 'n', action: 'nr-toggle', label: 'Noise reduction on / off' },
    { key: 'k', action: 'notch-toggle', label: 'Notch filter on / off' },
    { key: 'u', action: 'autonotch-toggle', label: 'Auto-notch on / off' },
    { key: 'p', action: 'peak-toggle', label: 'Peak hold on / off' },
    { key: 'v', action: 'avg-cycle', label: 'Next spectrum averaging' },
    { key: 'z', action: 'zoom-in', label: 'Zoom in' },
    { key: 'x', action: 'zoom-out', label: 'Zoom out' },
    { key: 'w', action: 'palette-cycle', label: 'Next waterfall palette' },
    { key: 'r', action: 'listen-toggle', label: 'Start / stop listening' },
    { key: 'o', action: 'record-toggle', label: 'Start / stop recording' },
    { key: 'm', action: 'memory-save', label: 'Save the current frequency as a memory' },
    { key: '?', action: 'help', label: 'Show this list' },
  ]);

  /**
   * Map a keyboard event to an action name. Events with Ctrl, Alt or Meta are never shortcuts, so browser and OS keys keep working.
   * @param {{key: string, ctrlKey?: boolean, altKey?: boolean, metaKey?: boolean}} e
   * @returns {string|null} The action, or `null`. `ptt` is returned for Space only so callers can skip it.
   */
  function resolveShortcut(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return null;
    const hit = SHORTCUTS.find((s) => s.key === e.key);
    return hit ? hit.action : null;
  }

  globalThis.BHShortcuts = Object.freeze({ SHORTCUTS, resolveShortcut });
})();
