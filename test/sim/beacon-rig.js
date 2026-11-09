// Beacon tracking rig shared by the beacon scenario and the fast smoke test: band-sim -> SDRangel-format spectrum frame ->
// parseSpectrumFrame -> beacon controller (or FreqTracker engine) -> station -> strict SDRangel mock.
import { createBandSim, fftFrame, SAMPLE_RATE, BEACON_IF_HZ } from './band-sim.js';
import { prng } from '../fixtures/dsp.js';
import { silentLogger } from '../fixtures/fakes.js';
import { parseSpectrumFrame } from '../../src/webrtc/spectrum.js';
import { createBeaconController } from '../../src/beacon/index.js';
import { createFreqTrackerBeacon } from '../../src/beacon/freqtracker.js';
import { createMockSdrangel, createSdrangelClient } from '../../src/sdrangel/index.js';
import { createStation } from '../../src/modes/station.js';

const FRAME_SAMPLES = 4096;
const CENTRE_WRITE = /device\/settings$/;

/**
 * Build a closed-loop beacon tracking rig.
 * @param {{engine?: 'bricohams'|'sdrangel-freqtracker', seed?: number, drift?: object, beaconSnrDb?: number}} [o] `engine` is the
 *   `beacon.engine` configuration value.
 *   Spurs and the CW beacon are placed outside the controller's +-10 kHz search window so they are distractors, not targets.
 * @returns {Promise<{mock: object, station: object, controller: {step(): Promise<object>, status(): object}, sim: object,
 *   step(tS: number): Promise<{status: string, appliedHz: number, truthHz: number, errHz: number, centreWrites: number}>,
 *   setBeacon(on: boolean): void, stop(): Promise<void>}>}
 */
export async function createBeaconRig({ engine = 'bricohams', seed = 1, drift = {}, beaconSnrDb = 30 } = {}) {
  const mock = createMockSdrangel();
  const url = await mock.start();
  const client = createSdrangelClient({ baseUrl: url });
  const station = createStation({ client, logger: silentLogger });
  await station.setMode('USB');
  const sim = createBandSim({
    seed,
    drift,
    beacon: { snrDb: beaconSnrDb },
    cwBeacon: { offsetHz: -35_000, snrDb: 25, wpm: 12 },
    spurs: [{ offsetHz: 25_000, snrDb: 15 }, { offsetHz: -20_000, snrDb: 12 }],
  });
  const noise = prng(seed ^ 0x7a7a);
  const rx = () => mock.state.deviceSets[0];
  let beaconOn = true;
  const centreWrites = () => mock.calls.filter((c) => c.method === 'PATCH' && CENTRE_WRITE.test(c.path)).length;

  let tNow = 0;
  const getSpectrum = async () => {
    const centre = Math.round(rx().settings.centerFrequency);
    const iq = sim.renderBlock(Math.round(tNow * SAMPLE_RATE), FRAME_SAMPLES, centre - BEACON_IF_HZ);
    const f = parseSpectrumFrame(fftFrame(iq, { centerHz: centre, averages: 2 }));
    return { powersDb: f.powersDb, centerHz: f.centerHz, binHz: f.binHz };
  };
  const controller = engine === 'sdrangel-freqtracker'
    ? createFreqTrackerBeacon({ client, station, logger: silentLogger })
    : createBeaconController({ getSpectrum, station, logger: silentLogger });

  return {
    mock,
    station,
    controller,
    sim,
    async step(tS) {
      tNow = tS;
      const truthHz = sim.driftHz(tS);
      if (engine === 'sdrangel-freqtracker') {
        const ch = rx().channels.find((c) => c.channelType === 'FreqTracker');
        if (ch) {
          // The tracker only sees +-250 Hz around the channel, i.e. the residual between the beacon and the applied correction.
          const residual = truthHz - controller.status().appliedHz + (noise() - 0.5) * 6;
          const visible = beaconOn && Math.abs(residual) < 250;
          ch.report = { channelPowerDB: visible ? -40 : -100, trackingDeltaFrequency: visible ? residual : 0, squelch: visible ? 1 : 0 };
        }
      }
      const before = centreWrites();
      const s = await controller.step();
      return { status: s.status, appliedHz: s.appliedHz, truthHz, errHz: truthHz - s.appliedHz, centreWrites: centreWrites() - before };
    },
    setBeacon(on) {
      beaconOn = on;
      sim.setBeaconEnabled(on);
    },
    stop: () => mock.stop(),
  };
}
