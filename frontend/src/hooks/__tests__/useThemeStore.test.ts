import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useThemeStore } from '../useThemeStore';

describe('useThemeStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useThemeStore.setState({ isDark: true });
  });

  afterEach(() => {
    // Clean up
    useThemeStore.setState({ isDark: true });
  });

  it('should have default dark theme', () => {
    const state = useThemeStore.getState();
    expect(state.isDark).toBe(true);
  });

  it('should toggle theme', () => {
    const { toggleTheme } = useThemeStore.getState();
    
    toggleTheme();
    
    expect(useThemeStore.getState().isDark).toBe(false);
    
    toggleTheme();
    
    expect(useThemeStore.getState().isDark).toBe(true);
  });

  it('should set theme directly', () => {
    const { setTheme } = useThemeStore.getState();
    
    setTheme(false);
    expect(useThemeStore.getState().isDark).toBe(false);
    
    setTheme(true);
    expect(useThemeStore.getState().isDark).toBe(true);
  });

  it('should persist state to localStorage', () => {
    const { setTheme } = useThemeStore.getState();
    
    setTheme(false);
    
    // Check localStorage was called
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'darkyield-theme',
      expect.any(String)
    );
  });
});
