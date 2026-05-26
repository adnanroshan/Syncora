import React from 'react';
import { Icon } from '../components/Icons.jsx';
import { OrgMark } from '../components/Shared.jsx';
import { sortTasks, Row } from './_shared.jsx';

export function GroupedView({ tasks, orgsById, productsById, onOpen, selectedId, groupBy, sortBy, unreadByTask }) {
  const groups = new Map();
  tasks.forEach(t => {
    let key, label, sub, org;
    if (groupBy === 'org') {
      key = `org-${t.organisationid}`;
      org = orgsById?.[t.organisationid];
      label = org?.name || 'Unassigned';
      const productCount = Object.values(productsById || {}).filter(p => p.orgId === t.organisationid || p.organisationid === t.organisationid).length;
      sub = `${productCount} product${productCount === 1 ? '' : 's'}`;
    } else {
      key = `prod-${t.productid}`;
      const prod = productsById?.[t.productid];
      const pOrgId = prod?.orgId ?? prod?.organisationid;
      org = pOrgId ? orgsById?.[pOrgId] : null;
      label = prod?.name || 'Unassigned';
      sub = org?.name || '';
    }
    if (!groups.has(key)) groups.set(key, { key, label, sub, items: [], org });
    groups.get(key).items.push(t);
  });

  const arr = Array.from(groups.values()).sort((a, b) => b.items.length - a.items.length);
  arr.forEach(g => { g.items = sortTasks(g.items, sortBy); });

  return (
    <div className="groupedview">
      {arr.map(g => {
        const open = g.items.filter(t => t.status !== 'done' && t.status !== 'closed' && t.status !== 'completed').length;
        const done = g.items.length - open;
        const progress = g.items.length ? Math.round((done / g.items.length) * 100) : 0;
        return (
          <section key={g.key} className="grp">
            <header className="grp-head">
              <div className="grp-id">
                {groupBy === 'org'
                  ? <OrgMark org={g.org} size={26}/>
                  : <span className="grp-prod-mark"><Icon name="tag" size={14}/></span>}
                <div>
                  <div className="grp-label">{g.label}</div>
                  <div className="grp-sub">{g.sub}</div>
                </div>
              </div>
              <div className="grp-stats">
                <div className="grp-stat"><span className="grp-stat-n">{open}</span><span className="grp-stat-l">open</span></div>
                <div className="grp-stat"><span className="grp-stat-n">{done}</span><span className="grp-stat-l">done</span></div>
                <div className="grp-progress"><div className="grp-progress-bar" style={{ width: `${progress}%` }}/></div>
                <span className="grp-progress-pct">{progress}%</span>
              </div>
            </header>
            <div className="grp-rows">
              {g.items.slice(0, 6).map(t => (
                <Row key={t.taskid} t={t} orgsById={orgsById} onOpen={onOpen} isSelected={selectedId === t.taskid} unread={unreadByTask?.[t.taskid]}/>
              ))}
              {g.items.length > 6 && <button className="grp-more">Show {g.items.length - 6} more</button>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
