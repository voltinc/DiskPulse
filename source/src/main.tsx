import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
// Desktop apps do not show the browser context menu except in editable fields.
window.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement | null;
  if (!t || !/^(INPUT|TEXTAREA)$/.test(t.tagName)) e.preventDefault();
});
