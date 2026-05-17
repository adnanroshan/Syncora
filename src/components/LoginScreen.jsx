import React from 'react';
import { Icon } from './Icons.jsx';

export function LoginScreen({ onLogin, isMock }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-logo"><Icon name="logo" size={28}/></span>
          <span className="login-name">Syncora</span>
        </div>
        <h1 className="login-title">Welcome back</h1>
        <p className="login-sub">Sign in with your organization account to continue.</p>

        <button className="login-btn" onClick={onLogin}>
          Sign in
          <Icon name="chevron-r" size={14}/>
        </button>

        {isMock && (
          <div className="login-mock-note">
            Running in <b>mock mode</b> — no backend configured.
          </div>
        )}

        <div className="login-foot">
          Protected by OAuth 2.0 · PKCE · No passwords stored client-side
        </div>
      </div>
    </div>
  );
}

export function BootSplash({ text = 'Loading…' }) {
  return (
    <div className="boot-splash">
      <div className="boot-spinner"/>
      <div className="boot-text">{text}</div>
    </div>
  );
}

export function BootError({ error, onRetry }) {
  return (
    <div className="boot-splash">
      <div className="boot-error-glyph">
        <Icon name="close" size={28}/>
      </div>
      <div className="boot-title">Couldn't reach the server</div>
      <div className="boot-text">{error}</div>
      <button className="login-btn" onClick={onRetry}>Try again</button>
    </div>
  );
}
