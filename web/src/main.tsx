import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { loadConfig } from './config';
import { registerServiceWorker } from './push';
import './styles.css';

registerServiceWorker();

// After a deploy, a tab opened earlier asks for page files of the previous version, which are gone:
// reload once to get the new version instead of failing (not again within a minute, in case
// the file is missing for another reason).
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem('reloadedForUpdate'));
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem('reloadedForUpdate', String(Date.now()));
  } catch {
    return; // no storage: no reload loop guard, so no reload
  }
  event.preventDefault();
  location.reload();
});

const root = createRoot(document.getElementById('root')!);

loadConfig()
  .then(() =>
    root.render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    ),
  )
  .catch((e: Error) => root.render(<div className="error-box page-error">⚠ {e.message}</div>));
