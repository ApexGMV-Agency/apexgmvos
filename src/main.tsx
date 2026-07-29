import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles.css';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { NotificationsProvider } from './notifications/NotificationsContext';
import { registerSW } from './notifications/swSetup';
import InstallPrompt from './components/InstallPrompt';

// Register the PWA service worker in production only. In dev it would cache the
// app shell and serve a stale index.html on localhost, breaking Vite's HMR
// websocket (the cached page's token no longer matches the running dev server).
if (import.meta.env.PROD) registerSW();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <NotificationsProvider>
          <App />
          <InstallPrompt />
        </NotificationsProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
