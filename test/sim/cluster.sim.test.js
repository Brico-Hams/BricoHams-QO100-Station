import assert from 'node:assert/strict';
import net from 'node:net';
import { createClusterClient } from '../../src/cluster/client.js';
import { prng } from '../fixtures/dsp.js';
import { silentLogger } from '../fixtures/fakes.js';
import { record, simTest } from './metrics.js';

const LINES = 500;
const DISCONNECTS = 3;
const UPLINK_OFFSET_HZ = 8_089_500_000; // QO-100 transponder: downlink = uplink + 8089.5 MHz

const CALLS = ['EA4AAA', 'DL1ABC', 'G4XYZ', 'JA1QQQ', 'VK3DEF', 'PY2ZZZ', 'W1AW', 'OZ1ABC', 'HB9XYZ', 'I2ABC/P'];

/** Builds the spot stream together with an oracle written independently of the parser. */
function buildStream(seed) {
  const rnd = prng(seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const lines = [];
  const expected = [];
  const kinds = { valid: 0, uplink: 0, outOfBand: 0, malformed: 0 };
  for (let i = 0; i < LINES; i++) {
    const r = rnd();
    const dx = pick(CALLS);
    const spotter = `${pick(CALLS)}-#`.replace('/P', '');
    if (r < 0.4) {
      const kHz = (10_489_520 + Math.floor(rnd() * 4600) / 10).toFixed(1); // 10489520.0 .. 10489979.9
      lines.push(`DX de ${spotter}: ${kHz} ${dx} CQ QO-100 1234Z`);
      expected.push({ dx, downlinkHz: Math.round(Number(kHz) * 1000) });
      kinds.valid++;
    } else if (r < 0.55) {
      const kHz = (2_400_020 + Math.floor(rnd() * 4600) / 10).toFixed(1); // 2400020.0 .. 2400479.9
      lines.push(`DX de ${spotter}: ${kHz} ${dx} uplink 1234Z`);
      expected.push({ dx, downlinkHz: Math.round(Number(kHz) * 1000) + UPLINK_OFFSET_HZ });
      kinds.uplink++;
    } else if (r < 0.75) {
      const kHz = pick(['14074.0', '7050.5', '145500.0', '10489000.0', '10490500.0', '2400600.0', '1296100.0', '10368100.0']);
      lines.push(`DX de ${spotter}: ${kHz} ${dx} CQ 1234Z`);
      kinds.outOfBand++;
    } else {
      lines.push(
        pick([
          '',
          'DX de',
          'WWV de SIDC: SFI=100',
          `DX de ${spotter}: abc ${dx} x`,
          `DX de ${spotter}: 10489750.0`,
          `DX de ${spotter}: 10489750.0 DX1@BC bad call`,
          `DX de ${spotter}: 10489750.0 ${dx} ${'x'.repeat(350)}`,
          `DX de ${spotter}: 10489750.0 ${dx} ${'y'.repeat(520)}`,
          'To ALL de EA4AAA: hello',
          `DX de ${spotter}: 10489.750.0 ${dx}`,
          '\u0001\u0002\u0003 garbage \u007f',
          `DX de ${spotter}: -10489750.0 ${dx}`,
        ]),
      );
      kinds.malformed++;
    }
  }
  return { lines, expected, kinds };
}

/** Fake DX node: prompts for a login, streams its share of lines in random TCP fragments, then hangs up on the first connections. */
function createFakeNode(lines, disconnects, seed) {
  const rnd = prng(seed ^ 0x9e3779b9);
  const sockets = new Set();
  const per = Math.ceil(lines.length / (disconnects + 1));
  const logins = [];
  let conn = 0;
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => {});
    const index = conn++;
    sock.write('Welcome to the fake node\r\nlogin: ');
    sock.once('data', async (d) => {
      logins.push(d.toString().trim());
      const part = lines.slice(index * per, (index + 1) * per);
      const text = part.map((l) => `${l}\r\n`).join('');
      for (let i = 0; i < text.length && !sock.destroyed; ) {
        const n = 1 + Math.floor(rnd() * 200);
        sock.write(text.slice(i, i + n), 'latin1');
        i += n;
        await new Promise((r) => setImmediate(r));
      }
      if (index < disconnects) sock.end();
    });
  });
  return {
    logins,
    connections: () => conn,
    listen: () => new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port))),
    close: () => new Promise((res) => {
      for (const s of sockets) s.destroy();
      server.close(() => res());
    }),
  };
}

const waitFor = async (cond, ms, what) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
};

simTest('cluster', `${LINES} spot lines, malformed/out-of-band/uplink, ${DISCONNECTS} disconnects, backoff`, async () => {
  const { lines, expected, kinds } = buildStream(20_240_601);
  const node = createFakeNode(lines, DISCONNECTS, 7);
  const port = await node.listen();
  const spots = [];
  const states = [];
  const retries = [];
  const client = createClusterClient({
    host: '127.0.0.1',
    port,
    callsign: 'EA4TEST',
    baseMs: 20,
    maxMs: 200,
    onSpot: (s) => spots.push(s),
    onStatus: (s) => {
      if (states.at(-1) !== s.state) states.push(s.state);
      if (s.state === 'waiting') retries.push(s.nextRetryMs);
    },
    logger: silentLogger,
  });
  client.start();
  try {
    await waitFor(() => spots.length >= expected.length && node.connections() === DISCONNECTS + 1, 20_000, 'all spots');
    // Give any wrongly accepted trailing line the chance to show up.
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(spots.length, expected.length, 'parser accepted exactly the valid in-band spots');
    spots.forEach((s, i) => {
      assert.equal(s.dx, expected[i].dx, `spot ${i} call`);
      assert.equal(s.downlinkHz, expected[i].downlinkHz, `spot ${i} downlink`);
      assert.ok(s.downlinkHz >= 10_489_505_000 && s.downlinkHz < 10_489_990_000, `spot ${i} in band`);
    });
    assert.equal(node.logins.length, DISCONNECTS + 1, 'logged in on every (re)connection');
    assert.ok(node.logins.every((l) => l === 'EA4TEST'));
    assert.equal(client.status().state, 'online');
    assert.equal(retries.length, DISCONNECTS, 'one retry per disconnect');
    assert.ok(retries.every((ms) => ms === 20), 'backoff resets after spots are received');

    // Outage: no node at all, the delay must double up to the cap.
    const before = retries.length;
    await node.close();
    await waitFor(() => retries.slice(before).includes(200), 5000, 'backoff cap');
    const outage = retries.slice(before);
    for (let i = 1; i < outage.length; i++) assert.ok(outage[i] >= outage[i - 1], 'backoff never shrinks during an outage');
    assert.ok(outage.every((ms) => ms <= 200));
    assert.deepEqual(outage.slice(0, 4), [20, 40, 80, 160]);

    record('cluster', 'summary', {
      linesSent: LINES,
      ...kinds,
      acceptedSpots: spots.length,
      expectedSpots: expected.length,
      disconnects: DISCONNECTS,
      reconnects: retries.slice(0, DISCONNECTS).length,
      logins: node.logins.length,
      backoffSequenceMs: outage.slice(0, 6),
      finalState: client.status().state,
      uplinkConverted: spots.filter((s) => s.given === 'uplink').length,
    });
  } finally {
    client.stop();
    await node.close();
  }
});
