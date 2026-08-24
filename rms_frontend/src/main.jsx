import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// When a new Service Worker activates (new deployment), reload all open tabs
// so users instantly get the latest code without having to manually refresh.
// The `refreshing` guard prevents a reload loop if controllerchange fires twice.
if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

// Actively register + poll for SW updates instead of relying on the browser's
// passive "check on navigation" behavior — that passive check is what let users
// see stale/buggy cached bundles (e.g. a feature-flag flash bug already fixed
// server-side) for a while after a new deploy. `immediate: true` registers and
// checks right away; the interval keeps checking every 60s while the tab stays
// open, so already-open sessions pick up fixes without needing a manual refresh.
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    if (!registration) return;
    setInterval(() => { registration.update().catch(() => {}); }, 10_000);
  },
  onNeedRefresh() {
    // registerType: 'autoUpdate' — apply the new SW immediately rather than
    // waiting for the user to do anything; the controllerchange listener
    // above then reloads the page once it takes control.
    updateSW(true);
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
