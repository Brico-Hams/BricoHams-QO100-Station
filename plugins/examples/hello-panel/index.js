/* BricoHams example client plugin: shows the current RX frequency and mode. Copy this folder to plugins/hello-panel/ and add
   "hello-panel" to plugins.enabled in config.json. It uses only the frozen plugin API (read-only state, one panel). */
export function activate(api) {
  api.registerPanel({
    title: 'Hello from a plugin',
    render(box) {
      const line = document.createElement('p');
      line.textContent = 'Waiting for the radio...';
      box.append(line);
      let hz = null;
      let mode = null;
      const show = () => {
        line.textContent = hz === null ? 'Waiting for the radio...' : `RX ${(hz / 1e6).toFixed(4)} MHz${mode ? ` ${mode}` : ''}`;
      };
      api.subscribe('frequency', (v) => { hz = v; show(); });
      api.subscribe('mode', (v) => { mode = v; show(); });
    },
  });
}
