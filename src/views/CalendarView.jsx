import React from 'react';
import { Icon } from '../components/Icons.jsx';
import { StatusGlyph } from '../components/Icons.jsx';
import { PriorityMark, normaliseStatus } from '../components/Shared.jsx';

export function CalendarView({ tasks, onOpen, selectedId, anchor, onAnchorChange }) {
  const today = new Date(); today.setHours(0,0,0,0);
  const month = anchor.getMonth();
  const year  = anchor.getFullYear();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;        // Mon-start grid
  const gridStart = new Date(year, month, 1 - startOffset);
  const days = [];
  for (let i = 0; i < 35; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }

  const tasksByDay = new Map();
  tasks.forEach(t => {
    if (!t.duedate) return;
    const d = new Date(t.duedate);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!tasksByDay.has(key)) tasksByDay.set(key, []);
    tasksByDay.get(key).push(t);
  });

  const monthLabel = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const move = (delta) => {
    const next = new Date(anchor);
    next.setMonth(next.getMonth() + delta);
    onAnchorChange(next);
  };
  const undated = tasks.filter(t => !t.duedate);

  return (
    <div className="calview">
      <div className="cal-head">
        <div className="cal-title">{monthLabel}</div>
        <div className="cal-nav">
          <button className="iconbtn" onClick={() => move(-1)} aria-label="Previous"><Icon name="chevron-l" size={14}/></button>
          <button className="vt-btn" onClick={() => onAnchorChange(new Date())}>Today</button>
          <button className="iconbtn" onClick={() => move(1)} aria-label="Next"><Icon name="chevron-r" size={14}/></button>
        </div>
      </div>
      <div className="cal-grid">
        <div className="cal-dow">Mon</div><div className="cal-dow">Tue</div><div className="cal-dow">Wed</div>
        <div className="cal-dow">Thu</div><div className="cal-dow">Fri</div><div className="cal-dow">Sat</div><div className="cal-dow">Sun</div>
        {days.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const isToday = d.getTime() === today.getTime();
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          const items = tasksByDay.get(key) || [];
          return (
            <div key={i} className={`cal-cell ${inMonth ? '' : 'cal-cell--out'} ${isToday ? 'is-today' : ''}`}>
              <div className="cal-cell-head">
                <span className="cal-date">{d.getDate()}</span>
                {items.length > 0 && <span className="cal-count">{items.length}</span>}
              </div>
              <div className="cal-events">
                {items.slice(0, 3).map(t => {
                  const status = normaliseStatus(t.status);
                  return (
                    <button key={t.taskid}
                            className={`cal-ev cal-ev--${status} ${selectedId === t.taskid ? 'is-selected' : ''}`}
                            onClick={() => onOpen(t.taskid)}
                            title={t.title}>
                      <PriorityMark priority={t.priority}/>
                      <span className="cal-ev-title">{t.title}</span>
                    </button>
                  );
                })}
                {items.length > 3 && <span className="cal-more">+{items.length - 3} more</span>}
              </div>
            </div>
          );
        })}
      </div>
      {undated.length > 0 && (
        <div className="cal-undated">
          <div className="cal-undated-head">
            <span>No due date</span>
            <span className="cal-undated-count">{undated.length}</span>
          </div>
          <div className="cal-undated-row">
            {undated.map(t => (
              <button key={t.taskid} className="undated-chip" onClick={() => onOpen(t.taskid)}>
                <StatusGlyph status={normaliseStatus(t.status)} size={12}/>
                <span>{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
