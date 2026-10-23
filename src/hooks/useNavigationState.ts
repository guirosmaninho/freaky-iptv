import { useCallback, useEffect, useRef, useState } from 'react';
import {
  browserNavigationStorage, loadChannelDensity, loadNavigationState, saveChannelDensity, saveNavigationState
} from '../services/navigationState';
import type { ChannelDensity, NavigationState, NavigationView } from '../services/navigationState';

// Mount one hook instance per view (Live and Favorites use distinct React keys).
export function useNavigationState(view: NavigationView, initialCategory = 'All channels') {
  const [state, setState] = useState(() => loadNavigationState(browserNavigationStorage(), view, initialCategory));
  const stateRef = useRef(state);
  const persistenceFrameRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (persistenceFrameRef.current !== null) cancelAnimationFrame(persistenceFrameRef.current);
    // A tab switch or reload must retain the last scroll event, even if its
    // scheduled storage write has not run yet.
    saveNavigationState(browserNavigationStorage(), view, stateRef.current);
  }, [view]);
  const [density, setDensityState] = useState<ChannelDensity>(() => loadChannelDensity(browserNavigationStorage(true), view));
  const [initialScrollTop] = useState(state.scrollTop);

  const updateState = useCallback((patch: Partial<NavigationState>) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    saveNavigationState(browserNavigationStorage(), view, next);
    setState(next);
  }, [view]);

  const saveScrollTop = useCallback((scrollTop: number) => {
    // A scroll event does not need to redraw the toolbar or write React state.
    const next = { ...stateRef.current, scrollTop };
    stateRef.current = next;
    if (persistenceFrameRef.current !== null) return;
    persistenceFrameRef.current = requestAnimationFrame(() => {
      persistenceFrameRef.current = null;
      saveNavigationState(browserNavigationStorage(), view, stateRef.current);
    });
  }, [view]);

  const setDensity = useCallback((next: ChannelDensity) => {
    saveChannelDensity(browserNavigationStorage(true), view, next);
    setDensityState(next);
  }, [view]);

  return { state, updateState, saveScrollTop, initialScrollTop, density, setDensity };
}
