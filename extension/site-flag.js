// Runs only on https://gauge.gershon.ai/* so the Gauge site can show whether the extension is installed
// and up to date, and so its "Sync now" button can start the same reading as "Grade me" in the popup.
// It sets one attribute with the extension version, announces it, and relays the site's sync request
// to the extension. It does not read the page or store anything.
(() => {
  const version = chrome.runtime.getManifest().version;
  document.documentElement.dataset.gaugeExt = version;
  document.documentElement.dataset.gaugeSync = '1';
  document.dispatchEvent(new CustomEvent('gauge-ext', { detail: version }));
  document.addEventListener('gauge-sync', () => {
    chrome.runtime.sendMessage({ type: 'grade', from: 'site' }).then(
      (r) => document.dispatchEvent(new CustomEvent('gauge-sync-result', { detail: JSON.stringify(r || {}) })),
      () => document.dispatchEvent(new CustomEvent('gauge-sync-result', { detail: '{"error":"failed"}' })),
    );
  });
})();
