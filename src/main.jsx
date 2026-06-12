import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App.jsx';
import { bootstrap, login, AuthState } from './auth.js';
import { IS_MOCK } from './config.js';
import { LoginScreen, BootSplash, BootError } from './components/LoginScreen.jsx';

import './styles.css';

/* One client for the app. Defaults tuned for ~100 concurrent users:
 * generous staleTime so navigation hits the cache instead of the
 * backend, and no retries on 4xx (api.js errors carry numeric .code). */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => {
        const code = err?.code;
        if (typeof code === 'number' && code >= 400 && code < 500) return false;
        return count < 2;
      },
    },
  },
});

function Boot() {
  const [auth, setAuth] = useState({ state: AuthState.Loading });

  const run = useCallback(() => {
    setAuth({ state: AuthState.Loading });
    bootstrap()
      .then(setAuth)
      .catch(err => setAuth({ state: AuthState.Error, error: err.message || String(err) }));
  }, []);

  useEffect(() => { run(); }, [run]);

  if (auth.state === AuthState.Loading)     return <BootSplash/>;
  if (auth.state === AuthState.Redirecting) return <BootSplash text="Signing you in…"/>;
  if (auth.state === AuthState.Error)       return <BootError error={auth.error} onRetry={run}/>;
  if (auth.state === AuthState.Anonymous)   return <LoginScreen onLogin={login} isMock={IS_MOCK}/>;

  // Authenticated — render the real app.
  return <App user={auth.user} hypermedia={auth.hypermedia} isMock={!!auth.mock}/>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Boot/>
    </QueryClientProvider>
  </React.StrictMode>
);
