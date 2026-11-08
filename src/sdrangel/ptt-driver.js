/**
 * PTT driver that keys the transmitter by starting/stopping the TX device set in SDRangel.
 * @param {{client: {setRunning(ds: number, running: boolean): Promise<unknown>, getRunning(ds: number): Promise<{state?: string}>},
 *   txDeviceSet: number}} opts
 * @returns {import('../ptt/index.js').PttDriver}
 */
export function createSdrangelPttDriver({ client, txDeviceSet }) {
  if (!Number.isInteger(txDeviceSet) || txDeviceSet < 0) throw new TypeError('txDeviceSet must be a non-negative integer');
  return {
    async setTx(on) {
      await client.setRunning(txDeviceSet, Boolean(on));
      if (!on) {
        // An unconfirmed "off" is treated as failure so the PTT machine goes to LOCKOUT instead of assuming the carrier is down.
        const { state } = await client.getRunning(txDeviceSet);
        if (state === 'running') throw new Error('TX device still running after stop request');
      }
    },
  };
}
