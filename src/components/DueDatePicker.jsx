/* Due-date picker
 * --------------------------------------------------------------
 *  A drop-in replacement for the native <input type="datetime-local">
 *  used in the task detail panel. Renders a button matching the
 *  surrounding `.sidefield-btn` styling, and on click opens a popover
 *  with:
 *
 *    1. Quick-pick chips  (Today, Tomorrow, Weekend, Next week)
 *    2. Mini month calendar with prev / next nav
 *    3. Time selector     (hour + 15-minute step + AM/PM)
 *    4. Footer actions    (Clear, Done)
 *
 *  Props:
 *    value         ISO 8601 string or null
 *    onChange(iso) called with new ISO string (or null on Clear)
 *    allowPast     bool  — default false; past days are disabled
 *
 *  Notes:
 *    - Persists ISO with timezone so backend gets an unambiguous instant.
 *    - Defaults newly-set dates to 5:00 PM local.
 *    - Snaps minutes to the nearest 15-minute step in the dropdown.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Icon } from './Icons.jsx';
import { DueChip } from './Shared.jsx';

export function DueDatePicker({ value, onChange, allowPast = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const current = value ? new Date(value) : null;
  const validCurrent = current && !isNaN(current.getTime()) ? current : null;

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  /* Calendar view month — synced to the selected date (or today) when
   * the popover opens. */
  const [viewYear,  setViewYear]  = useState(() => (validCurrent || new Date()).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (validCurrent || new Date()).getMonth());

  useEffect(() => {
    if (!open) return;
    const d = validCurrent || new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }, [open]); // eslint-disable-line

  /* Close on outside click + Escape. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /* ----- date helpers ----- */
  const commit = (date) => onChange(date ? date.toISOString() : null);

  const pickDay = (year, month, day) => {
    const base = validCurrent ? new Date(validCurrent) : null;
    const hh = base ? base.getHours()   : 17;
    const mm = base ? base.getMinutes() :  0;
    commit(new Date(year, month, day, hh, mm, 0, 0));
  };

  const pickQuick = (which) => {
    const d = new Date();
    d.setHours(17, 0, 0, 0);
    if (which === 'tomorrow') {
      d.setDate(d.getDate() + 1);
    } else if (which === 'weekend') {
      // next Saturday (if today is Saturday, jump to next week)
      const delta = (6 - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + delta);
    } else if (which === 'nextweek') {
      // next Monday
      const delta = (1 - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + delta);
    }
    commit(d);
    setOpen(false);
  };

  const setTime = ({ hours, minutes }) => {
    const base = validCurrent ? new Date(validCurrent) : new Date(today.getTime());
    if (!validCurrent) base.setHours(17, 0, 0, 0);
    if (hours   != null) base.setHours(hours);
    if (minutes != null) base.setMinutes(minutes);
    base.setSeconds(0, 0);
    commit(base);
  };

  const stepMonth = (delta) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0)  { m = 11; y -= 1; }
    if (m > 11) { m = 0;  y += 1; }
    setViewYear(y);
    setViewMonth(m);
  };

  /* ----- calendar grid (6 rows × 7 cols) ----- */
  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startWeekday = first.getDay();
    const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevDays     = new Date(viewYear, viewMonth, 0).getDate();
    const out = [];
    for (let i = startWeekday - 1; i >= 0; i--) {
      out.push({ y: viewMonth === 0 ? viewYear - 1 : viewYear, m: (viewMonth + 11) % 12, d: prevDays - i, dim: true });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ y: viewYear, m: viewMonth, d, dim: false });
    }
    let nextDay = 1;
    while (out.length < 42) {
      out.push({ y: viewMonth === 11 ? viewYear + 1 : viewYear, m: (viewMonth + 1) % 12, d: nextDay++, dim: true });
    }
    return out;
  }, [viewYear, viewMonth]);

  const monthLabel = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const selKey = validCurrent
    ? `${validCurrent.getFullYear()}-${validCurrent.getMonth()}-${validCurrent.getDate()}`
    : null;

  const triggerLabel = validCurrent
    ? validCurrent.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' · ' +
      validCurrent.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : 'Set due date';

  /* ----- render ----- */
  return (
    <div className="ddp" ref={rootRef}>
      <button
        type="button"
        className="sidefield-btn ddp-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="calendar" size={13}/>
        <span className={`ddp-trigger-label${validCurrent ? '' : ' ddp-empty'}`}>{triggerLabel}</span>
        {validCurrent && <DueChip iso={value}/>}
      </button>

      {open && (
        <div className="ddp-pop" role="dialog" aria-label="Due date">
          {/* Quick picks */}
          <div className="ddp-quick">
            <button type="button" onClick={() => pickQuick('today')}>Today</button>
            <button type="button" onClick={() => pickQuick('tomorrow')}>Tomorrow</button>
            <button type="button" onClick={() => pickQuick('weekend')}>Weekend</button>
            <button type="button" onClick={() => pickQuick('nextweek')}>Next week</button>
          </div>

          {/* Month nav */}
          <div className="ddp-cal-head">
            <button type="button" className="ddp-navbtn" onClick={() => stepMonth(-1)} aria-label="Previous month">
              <Icon name="chevron-l" size={13}/>
            </button>
            <div className="ddp-month">{monthLabel}</div>
            <button type="button" className="ddp-navbtn" onClick={() => stepMonth(1)} aria-label="Next month">
              <Icon name="chevron-r" size={13}/>
            </button>
          </div>

          {/* Day-of-week header */}
          <div className="ddp-dow">
            {['S','M','T','W','T','F','S'].map((d, i) => <div key={i}>{d}</div>)}
          </div>

          {/* Day grid */}
          <div className="ddp-grid">
            {cells.map((c, i) => {
              const cellDate = new Date(c.y, c.m, c.d);
              cellDate.setHours(0, 0, 0, 0);
              const key = `${c.y}-${c.m}-${c.d}`;
              const isToday    = cellDate.getTime() === today.getTime();
              const isSelected = selKey === key;
              const isPast     = !allowPast && cellDate < today;
              const cls = [
                'ddp-cell',
                c.dim     ? 'ddp-dim'     : '',
                isToday   ? 'ddp-today'   : '',
                isSelected? 'ddp-sel'     : '',
                isPast    ? 'ddp-past'    : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={i}
                  type="button"
                  className={cls}
                  disabled={isPast}
                  onClick={() => pickDay(c.y, c.m, c.d)}
                >{c.d}</button>
              );
            })}
          </div>

          {/* Time row */}
          <div className="ddp-time">
            <span className="ddp-time-label">Time</span>
            <select
              className="ddp-select"
              value={validCurrent ? validCurrent.getHours() : 17}
              onChange={(e) => setTime({ hours: parseInt(e.target.value, 10) })}
            >
              {Array.from({ length: 24 }, (_, h) => {
                const display = ((h % 12) || 12).toString().padStart(2, '0');
                const period  = h < 12 ? 'AM' : 'PM';
                return <option key={h} value={h}>{display} {period}</option>;
              })}
            </select>
            <span className="ddp-time-sep">:</span>
            <select
              className="ddp-select"
              value={validCurrent ? Math.round(validCurrent.getMinutes() / 15) * 15 % 60 : 0}
              onChange={(e) => setTime({ minutes: parseInt(e.target.value, 10) })}
            >
              {[0, 15, 30, 45].map((m) => (
                <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
              ))}
            </select>
          </div>

          {/* Footer */}
          <div className="ddp-foot">
            <button
              type="button"
              className="ddp-clear"
              onClick={() => { commit(null); setOpen(false); }}
              disabled={!validCurrent}
            >
              <Icon name="close" size={11}/>
              <span>Clear</span>
            </button>
            <button
              type="button"
              className="ddp-done"
              onClick={() => setOpen(false)}
            >Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
