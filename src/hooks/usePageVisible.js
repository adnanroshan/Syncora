/* Tracks tab visibility so polling can pause when the tab is backgrounded.
 * Returns `true` while the tab is foregrounded. */

import { useEffect, useState } from 'react';

export function usePageVisible() {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  );

  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return visible;
}
