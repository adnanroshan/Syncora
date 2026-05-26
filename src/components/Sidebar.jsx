import React from 'react';
import { Icon } from './Icons.jsx';
import { Avatar } from './Shared.jsx';

/* Side navigation. Smart lists at top, then per-client scopes, then saved views. */

export function Sidebar({ active, onSelect, scopeCount, byOrg, orgs, collapsed, me, inboxCount, inboxHasMentions, todayCount, mineCount }) {
  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sb-brand">
        <span className="sb-logo"><Icon name="logo" size={20} /></span>
        {!collapsed && (
          <>
            <span className="sb-brand-name">Syncora</span>
            <span className="sb-workspace">acme · prod</span>
          </>
        )}
      </div>

      <div className="sb-search">
        <Icon name="search" size={14} />
        {!collapsed && <input placeholder="Jump to…" />}
        {!collapsed && <kbd>⌘K</kbd>}
      </div>

      <nav className="sb-section">
        <SBItem id="inbox" icon="inbox"   label="Inbox"    count={inboxCount} active={active} onSelect={onSelect} collapsed={collapsed}
                hasUnread={inboxCount > 0} hasMentions={inboxHasMentions}/>
        <SBItem id="mine"  icon="mytasks" label="My tasks" count={mineCount}  active={active} onSelect={onSelect} collapsed={collapsed}/>
        <SBItem id="today" icon="today"   label="Today"    count={todayCount} active={active} onSelect={onSelect} collapsed={collapsed}/>
        <SBItem id="all"   icon="all"     label="All work" count={scopeCount} active={active} onSelect={onSelect} collapsed={collapsed}/>
      </nav>

      {!collapsed && (
        <>
          <div className="sb-header">
            <span>Clients</span>
            <button className="sb-add" aria-label="Add client"><Icon name="plus" size={12} /></button>
          </div>
          <nav className="sb-section">
            {orgs.filter(o => (o.id ?? o.organisationid) !== 6).map(o => {
              const id = o.id ?? o.organisationid;
              const short = o.short || (o.name ? o.name.split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase() : '?');
              return (
                <SBItem key={id}
                  id={'org-' + id}
                  custom={<span className="orgmark sb-orgmark" style={{ width: 14, height: 14, fontSize: 8 }}>{short}</span>}
                  label={o.name}
                  count={byOrg[id] || 0}
                  active={active}
                  onSelect={onSelect}
                  collapsed={collapsed}/>
              );
            })}
          </nav>

          <div className="sb-header">
            <span>Views</span>
          </div>
          <nav className="sb-section">
            <SBItem id="view-urgent"  custom={<span className="sb-dot" style={{ background: 'var(--priority-urgent)' }}/>}      label="Urgent"            active={active} onSelect={onSelect} collapsed={collapsed}/>
            <SBItem id="view-blocked" custom={<span className="sb-dot" style={{ background: 'var(--status-blocked-text)' }}/>}  label="Blocked"           active={active} onSelect={onSelect} collapsed={collapsed}/>
            <SBItem id="view-recent"  custom={<Icon name="sparkle" size={13} />}                                                label="Recently updated"  active={active} onSelect={onSelect} collapsed={collapsed}/>
          </nav>
        </>
      )}

      <div className="sb-foot">
        <Avatar user={me} size={22}/>
        {!collapsed && (
          <>
            <div className="sb-foot-text">
              <div className="sb-foot-name">{me?.name || 'You'}</div>
              <div className="sb-foot-meta">Online</div>
            </div>
            <button className="sb-foot-btn" aria-label="Settings"><Icon name="settings" size={15} /></button>
          </>
        )}
      </div>
    </aside>
  );
}

function SBItem({ id, icon, custom, label, count, active, onSelect, collapsed, hasUnread, hasMentions }) {
  const cls = [
    'sb-item',
    active === id ? 'is-active' : '',
    hasUnread ? 'has-unread' : '',
    hasMentions ? 'has-mentions' : '',
  ].filter(Boolean).join(' ');
  return (
    <button className={cls} onClick={() => onSelect(id)} title={collapsed ? label : undefined}>
      <span className="sb-item-icon">{custom || (icon && <Icon name={icon} size={15} />)}</span>
      {!collapsed && <span className="sb-item-label">{label}</span>}
      {!collapsed && hasMentions && <span className="sb-mention-pip" aria-hidden="true"/>}
      {!collapsed && count != null && count > 0 && <span className="sb-item-count">{count}</span>}
    </button>
  );
}
