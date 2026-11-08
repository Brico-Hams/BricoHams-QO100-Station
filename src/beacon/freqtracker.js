import { createBeaconFilter } from './index.js';

const DEFAULT_RF_BANDWIDTH_HZ = 500;
const DEFAULT_DEADBAND_HZ = 2;

/**
 * Beacon engine backed by SDRangel's FreqTracker channel (include/FreqTracker.yaml). The tracker sits on the RX device set
 * at channel offset 0 (the RX centre already follows the beacon, so the beacon is expected there); its report
 * `trackingDeltaFrequency` is the beacon's residual offset, so the total drift is `appliedHz + delta`.
 * Same `{step, status}` interface as `createBeaconController`; nothing is written without lock.
 * @param {{client: object, station: {setCorrection(hz: number, source: string): Promise<void>},
 *   rxDeviceSet?: number, rfBandwidthHz?: number, deadbandHz?: number, filter?: object,
 *   onStatus?: (status: object) => void, logger?: {error: Function}}} opts
 * @returns {{step(): Promise<object>, status(): object}}
 */
export function createFreqTrackerBeacon({
  client, station, rxDeviceSet = 0, rfBandwidthHz = DEFAULT_RF_BANDWIDTH_HZ, deadbandHz = DEFAULT_DEADBAND_HZ,
  filter = {}, onStatus = () => {}, logger = console,
}) {
  const flt = createBeaconFilter(filter);
  let channel = null;
  let current = { status: 'no-lock', offsetHz: null, appliedHz: 0, snrDb: null, reason: 'no_data', updatedAt: null };

  const publish = (next) => {
    const changed = next.status !== current.status || next.appliedHz !== current.appliedHz;
    current = { ...next, updatedAt: Date.now() };
    if (changed) {
      try {
        onStatus({ ...current });
      } catch (err) {
        logger.error('beacon: status listener failed:', err.message);
      }
    }
  };

  async function ensureTracker() {
    if (channel !== null) return channel;
    const ds = await client.getDeviceSet(rxDeviceSet);
    let idx = (ds.channels ?? []).findIndex((c) => c.id === 'FreqTracker');
    if (idx < 0) {
      await client.addChannel(rxDeviceSet, 'FreqTracker', 0);
      idx = ((await client.getDeviceSet(rxDeviceSet)).channels ?? []).findLastIndex((c) => c.id === 'FreqTracker');
      if (idx < 0) throw new Error('SDRangel did not create the FreqTracker channel');
    }
    await client.patchChannelSettings(rxDeviceSet, idx, { inputFrequencyOffset: 0, rfBandwidth: rfBandwidthHz, tracking: 1 });
    channel = idx;
    return channel;
  }

  return {
    /**
     * Read the tracker report once, filter it and apply the correction through the station.
     * @returns {Promise<object>} Beacon status after the reading.
     */
    async step() {
      let delta = null;
      let reason = 'no_data';
      try {
        const idx = await ensureTracker();
        const report = (await client.getChannelReport(rxDeviceSet, idx)).FreqTrackerReport ?? {};
        if (report.squelch && Number.isFinite(report.trackingDeltaFrequency)) {
          delta = current.appliedHz + report.trackingDeltaFrequency;
          reason = null;
        } else {
          reason = 'low_snr';
        }
      } catch (err) {
        channel = null;
        logger.error('beacon: FreqTracker read failed:', err.message);
        reason = 'tracker_unavailable';
      }
      const filtered = flt.update(delta);

      let appliedHz = current.appliedHz;
      if (filtered.status === 'locked' && Math.abs(filtered.offsetHz - appliedHz) >= deadbandHz) {
        try {
          await station.setCorrection(filtered.offsetHz, 'beacon');
          appliedHz = Math.round(filtered.offsetHz * 10) / 10;
        } catch (err) {
          logger.error('beacon: applying correction failed:', err.message);
          reason = 'apply_failed';
        }
      }
      publish({ status: filtered.status, offsetHz: filtered.offsetHz, appliedHz, snrDb: null, reason });
      return current;
    },

    /** @returns {object} Last beacon status. */
    status: () => ({ ...current }),
  };
}
