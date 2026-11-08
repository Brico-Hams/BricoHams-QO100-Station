import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadDefinitions, parseDefinitions, validateAgainst } from '../../src/sdrangel/swagger-lite.js';

const dir = fileURLToPath(new URL('../../docs/references/sdrangel-swagger/include/', import.meta.url));
const defs = loadDefinitions(dir);

test('reads properties and types from the real SDRangel include files', () => {
  assert.equal(defs.UDPSourceSettings.properties.sampleFormat.type, 'integer');
  assert.equal(defs.UDPSourceSettings.properties.inputSampleRate.type, 'number');
  assert.equal(defs.UDPSourceSettings.properties.channelMute.maximum, 1);
  assert.equal(defs.RtlSdrSettings.properties.log2Decim.maximum, 6);
  assert.ok('fileRecordName' in defs.FileSinkSettings.properties);
  assert.ok('trackingDeltaFrequency' in defs.FreqTrackerReport.properties);
});

test('validateAgainst rejects unknown keys, wrong types and out-of-range values', () => {
  assert.deepEqual(validateAgainst(defs, 'UDPSourceSettings', { sampleFormat: 3, inputSampleRate: 48000, udpPort: 9999 }), []);
  assert.match(validateAgainst(defs, 'UDPSourceSettings', { notAKey: 1 })[0], /unknown property/);
  assert.match(validateAgainst(defs, 'UDPSourceSettings', { udpPort: '9999' })[0], /expected integer/);
  assert.match(validateAgainst(defs, 'UDPSourceSettings', { channelMute: 2 })[0], /above maximum/);
  assert.match(validateAgainst(defs, 'Nope', {})[0], /unknown definition/);
  assert.match(validateAgainst(defs, 'UDPSourceSettings', [])[0], /must be an object/);
});

test('block scalars and inline enums are handled', () => {
  const d = parseDefinitions('A:\n  properties:\n    x:\n      type: integer\n      description: >\n        long\n        text\n      enum: [1, 2]\n    y:\n      type: string\n');
  assert.deepEqual(d.A.properties.x.enum, [1, 2]);
  assert.equal(d.A.properties.y.type, 'string');
});
