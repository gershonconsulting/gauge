// Runs only on https://gauge.gershon.ai/* so the Gauge site can show whether the extension is installed
// and up to date. It sets one attribute with the extension version and announces it. Nothing else:
// it does not read the page, send messages, or store anything.
(() => {
  const version = chrome.runtime.getManifest().version;
  document.documentElement.dataset.gaugeExt = version;
  document.dispatchEvent(new CustomEvent('gauge-ext', { detail: version }));
})();
