import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import App from './App.jsx';
import { bootstrap, login, AuthState } from './auth.js';
import { IS_MOCK } from './config.js';
import { LoginScreen, BootSplash, BootError } from './components/LoginScreen.jsx';

import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      // Don't retry client errors (4xx carry a numeric `.code` from api.js).
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
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false}/>}
    </QueryClientProvider>
  </React.StrictMode>
);
