import { render } from 'preact';
import { App } from './app';
import { appStore } from './store/app';

// A deploy removes the old hashed files, so a page still running the old bundle can't load a lazy
// chunk (QR library, dev pages). Reload instead of failing — capped like OUTDATED_CLIENT (5C).
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  appStore().lazyChunkFailed();
});

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
