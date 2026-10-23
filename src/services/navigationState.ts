export type NavigationView = 'live' | 'favorites' | 'guide';
export type ChannelDensity = 'compact' | 'comfortable' | 'large';

export interface NavigationState {
  searchText: string;
  selectedCategory: string;
  scrollTop: number;
  reminderLeadMinutes: 0 | 5 | 10 | 15 | 30;
}

export interface NavigationStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const stateKey = (view: NavigationView) => `freaky-navigation:v1:${view}`;
const densityKey = (view: NavigationView) => `freaky-channel-density:v1:${view}`;

export const defaultNavigationState = (initialCategory = 'All channels'): NavigationState => ({
  searchText: '',
  selectedCategory: initialCategory,
  scrollTop: 0,
  reminderLeadMinutes: 10
});

export function validateNavigationState(value: unknown, initialCategory = 'All channels'): NavigationState {
  const defaults = defaultNavigationState(initialCategory);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const candidate = value as Record<string, unknown>;
  return {
    searchText: typeof candidate.searchText === 'string' ? candidate.searchText.slice(0, 256) : defaults.searchText,
    selectedCategory: typeof candidate.selectedCategory === 'string' && candidate.selectedCategory.length > 0
      ? candidate.selectedCategory.slice(0, 256)
      : defaults.selectedCategory,
    scrollTop: typeof candidate.scrollTop === 'number' && Number.isFinite(candidate.scrollTop)
      ? Math.min(10_000_000, Math.max(0, candidate.scrollTop))
      : 0,
    reminderLeadMinutes: [0, 5, 10, 15, 30].includes(Number(candidate.reminderLeadMinutes)) && typeof candidate.reminderLeadMinutes === 'number'
      ? candidate.reminderLeadMinutes as NavigationState['reminderLeadMinutes']
      : defaults.reminderLeadMinutes
  };
}

export function loadNavigationState(storage: NavigationStorage | null, view: NavigationView, initialCategory = 'All channels'): NavigationState {
  try {
    return validateNavigationState(JSON.parse(storage?.getItem(stateKey(view)) || 'null'), initialCategory);
  } catch {
    return defaultNavigationState(initialCategory);
  }
}

export function saveNavigationState(storage: NavigationStorage | null, view: NavigationView, state: NavigationState): void {
  try {
    storage?.setItem(stateKey(view), JSON.stringify(validateNavigationState(state)));
  } catch {
    // Optional navigation persistence must also work with storage disabled or full.
  }
}

export function loadChannelDensity(storage: NavigationStorage | null, view: NavigationView): ChannelDensity {
  try {
    const value = storage?.getItem(densityKey(view));
    return value === 'compact' || value === 'large' ? value : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

export function saveChannelDensity(storage: NavigationStorage | null, view: NavigationView, density: ChannelDensity): void {
  try {
    storage?.setItem(densityKey(view), density);
  } catch {
    // Density is a preference, so storage failure should never interrupt browsing.
  }
}

export function browserNavigationStorage(persistent = false): NavigationStorage | null {
  try {
    return persistent ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}
