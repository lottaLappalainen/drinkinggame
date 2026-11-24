import { render } from 'preact';
import { App } from './app';
import { initRouter } from './router';
import { appStorage, appStore } from './store/app';
import './styles/tokens.css';
import './styles/base.css';
import { initTheme } from './theme';

// A deploy removes the old hashed files, so a page still running the old bundle can't load a lazy
// chunk (QR library, dev pages). Reload instead of failing — capped like OUTDATED_CLIENT (5C).
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  appStore().lazyChunkFailed();
});

initTheme(appStorage());
initRouter();

const root = document.getElementById('app');
if (root === null) throw new Error('index.html has no #app element');
render(<App />, root);
