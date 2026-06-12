import React from 'react';
import { Icon } from '../components/Icons.jsx';
import { OrgMark } from '../components/Shared.jsx';
import { sortTasks, Row } from './_shared.jsx';

/* Per-mode group extraction. Each returns { key, label, sub, org } for a
 * task; `org` drives the OrgMark avatar (client grouping only). Module and
 * task-group names ride on the decorated task rows themselves. */
const GROUPERS = {
  org: (t, { orgsById, productsById }) => {
    const org = orgsById?.[t.organisationid];
    const productCount = Object.values(productsById || {}).filter(p => p.orgId === t.organisationid || p.organisationid === t.organisationid).length;
    return {
      key:   `org-${t.organisationid}`,
      label: org?.name || 'Unassigned',
      sub:   `${productCount} product${productCount === 1 ? '' : 's'}`,
      org,
    };
  },
  product: (t, { orgsById, productsById }) => {
    const prod   = productsById?.[t.productid];
    const pOrgId = prod?.orgId ?? prod?.organisationid;
    const org    = pOrgId ? orgsById?.[pOrgId] : null;
    return {
      key:   `prod-${t.productid}`,
      label: prod?.name || t.productname || 'Unassigned',
      sub:   org?.name || t.organisationname || '',
      org:   null,
    };
  },
  module: (t) => ({
    key:   `mod-${t.moduleid ?? 'none'}`,
    label: t.modulename || 'No module',
    sub:   t.productname || '',
    org:   null,
  }),
  taskgroup: (t) => ({
    key:   `tg-${t.taskgroupid ?? 'none'}`,
    label: t.taskgroupname || 'No task group',
    sub:   '',
    org:   null,
  }),
};

const GROUP_ICON = { product: 'cube', module: 'tag', taskgroup: 'group' };

export function GroupedView({ tasks, orgsById, productsById, onOpen, selectedId, groupBy, sortBy, unreadByTask }) {
  const grouper = GROUPERS[groupBy] || GROUPERS.org;
  const groups = new Map();
  tasks.forEach(t => {
    const { key, label, sub, org } = grouper(t, { orgsById, productsById });
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
                {groupBy === 'org' || !GROUP_ICON[groupBy]
                  ? <OrgMark org={g.org} size={26}/>
                  : <span className="grp-prod-mark"><Icon name={GROUP_ICON[groupBy]} size={14}/></span>}
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
