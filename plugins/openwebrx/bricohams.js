/*
 * BricoHams QO-100 plugin for OpenWebRX+ (receive only).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Adds NB transponder bookmarks, a downlink/uplink converter, the band plan and a link to the
 * station PWA. It never talks to the station: the PWA link is a plain anchor the user clicks.
 */
(function () {
  'use strict';

  var UPLINK_OFFSET_HZ = 8089500000; // downlink 10489.500 MHz <-> uplink 2400.000 MHz
  var NB_DOWNLINK_MIN_HZ = 10489500000;
  var NB_DOWNLINK_MAX_HZ = 10490000000;

  // Frequencies are downlink Hz. Keep the markers: the unit test parses this block.
  var BRICOHAMS_BOOKMARKS = /*BEGIN_BOOKMARKS*/[
    { "name": "QO-100 CW beacon (low)", "frequency": 10489500000, "modulation": "cw", "kind": "beacon" },
    { "name": "QO-100 BPSK beacon", "frequency": 10489750000, "modulation": "usb", "kind": "beacon" },
    { "name": "QO-100 CW beacon (high)", "frequency": 10490000000, "modulation": "cw", "kind": "beacon" },
    { "name": "QO-100 CW segment", "frequency": 10489520000, "modulation": "cw", "kind": "cw" },
    { "name": "QO-100 FT8", "frequency": 10489540000, "modulation": "usb", "kind": "digital" },
    { "name": "QO-100 FT4", "frequency": 10489560000, "modulation": "usb", "kind": "digital" },
    { "name": "QO-100 digital segment", "frequency": 10489580000, "modulation": "usb", "kind": "digital" },
    { "name": "QO-100 SSB segment", "frequency": 10489650000, "modulation": "usb", "kind": "ssb" },
    { "name": "QO-100 SSB calling", "frequency": 10489800000, "modulation": "usb", "kind": "ssb" }
  ]/*END_BOOKMARKS*/;

  var BAND_PLAN = [
    { name: 'CW beacon', from: 10489500000, to: 10489505000 },
    { name: 'CW', from: 10489505000, to: 10489540000 },
    { name: 'Digital (FT8/FT4/PSK)', from: 10489540000, to: 10489600000 },
    { name: 'SSB', from: 10489600000, to: 10489990000 },
    { name: 'CW beacon', from: 10489990000, to: 10490000000 }
  ];

  function toUplink(downHz) { return downHz - UPLINK_OFFSET_HZ; }
  function toDownlink(upHz) { return upHz + UPLINK_OFFSET_HZ; }
  function fmtMHz(hz) { return (hz / 1e6).toFixed(4); }

  function registerBookmarks() {
    if (typeof window.bookmarks === 'undefined' || typeof window.bookmarks.replace_bookmarks !== 'function') return;
    var list = BRICOHAMS_BOOKMARKS.map(function (b) {
      return { name: b.name, frequency: b.frequency, modulation: b.modulation };
    });
    window.bookmarks.replace_bookmarks(list, 'bricohams');
  }

  function el(tag, text, attrs) {
    var e = document.createElement(tag);
    if (text) e.textContent = text;
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function buildPanel() {
    var panel = el('div', null, { id: 'bricohams-qo100-panel' });
    panel.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:1000;background:#1b2330;color:#e8edf4;' +
      'padding:8px 10px;border-radius:6px;font:12px sans-serif;max-width:260px;';
    panel.appendChild(el('strong', 'BricoHams QO-100 (RX)'));

    var down = el('input', null, { type: 'number', step: '0.0001', placeholder: 'Downlink MHz', 'aria-label': 'Downlink MHz' });
    var up = el('input', null, { type: 'number', step: '0.0001', placeholder: 'Uplink MHz', 'aria-label': 'Uplink MHz' });
    down.style.width = up.style.width = '100%';
    down.addEventListener('input', function () {
      var v = parseFloat(down.value);
      up.value = isFinite(v) ? fmtMHz(toUplink(v * 1e6)) : '';
    });
    up.addEventListener('input', function () {
      var v = parseFloat(up.value);
      down.value = isFinite(v) ? fmtMHz(toDownlink(v * 1e6)) : '';
    });
    panel.appendChild(el('div', 'Downlink <-> uplink (MHz)'));
    panel.appendChild(down);
    panel.appendChild(up);

    panel.appendChild(el('div', 'Band plan (downlink MHz)'));
    var ul = el('ul');
    ul.style.cssText = 'margin:2px 0;padding-left:16px;';
    BAND_PLAN.forEach(function (seg) {
      ul.appendChild(el('li', seg.name + ': ' + fmtMHz(seg.from) + ' - ' + fmtMHz(seg.to)));
    });
    panel.appendChild(ul);

    var pwa = window.BRICOHAMS_PWA_URL;
    if (typeof pwa === 'string' && /^https?:\/\//.test(pwa)) {
      var a = el('a', 'Open the station (operators)', { href: pwa, target: '_blank', rel: 'noopener noreferrer' });
      a.style.color = '#7fc4ff';
      panel.appendChild(a);
    }
    return panel;
  }

  function init() {
    registerBookmarks();
    document.body.appendChild(buildPanel());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.BricoHamsQo100 = {
    nbRangeHz: [NB_DOWNLINK_MIN_HZ, NB_DOWNLINK_MAX_HZ],
    toUplink: toUplink,
    toDownlink: toDownlink
  };
})();
