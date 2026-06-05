import React, { useState, useEffect, useRef } from 'react';
import { Icon } from './Icons.jsx';
import { Avatar } from './Shared.jsx';

export function TopBar({ scopeLabel, scopeSubtitle, onNew, onSearch, search, onToggleTheme, theme, user, onLogout }) {
  return (
    <header className="topbar">
      <div className="topbar-crumbs">
        <span className="crumb crumb--ws">acme</span>
        <Icon name="chevron-r" size={12} className="crumb-sep"/>
        <span className="crumb">{scopeLabel}</span>
        {scopeSubtitle && <span className="crumb-meta">{scopeSubtitle}</span>}
      </div>
      <div className="topbar-actions">
        <div className="topbar-search">
          <Icon name="search" size={13} />
          <input
            placeholder="Search tasks…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          <kbd>/</kbd>
        </div>
        <button className="iconbtn" aria-label="Toggle theme" onClick={onToggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
        </button>
        <button className="iconbtn" aria-label="Notifications">
          <Icon name="bell" size={15} /><span className="notif-dot"/>
        </button>
        <button className="btn-primary" onClick={onNew}>
          <Icon name="plus" size={13} />
          <span>New task</span>
          <kbd className="btn-kbd">C</kbd>
        </button>
        {user && <UserMenu user={user} onLogout={onLogout} />}
      </div>
    </header>
  );
}

function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey   = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="usermenu-trigger" onClick={() => setOpen(o => !o)} aria-label="Account">
        {user.picture
          ? <img className="usermenu-avatar" src={user.picture} alt=""/>
          : <Avatar user={user} size={24} />}
      </button>
      {open && (
        <div className="usermenu-pop" role="menu">
          <div className="usermenu-head">
            <div className="usermenu-name">{user.name || user.username || 'Signed in'}</div>
            {user.email && <div className="usermenu-email">{user.email}</div>}
          </div>
          <button className="usermenu-item" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
