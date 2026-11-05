import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SettingsMenu from './SettingsMenu';
import { TEXT_SIZE_STORAGE_KEY } from '../../services/textSizePreference';
import { SYSTEM_THEME_CHANGED_EVENT, THEME_STORAGE_KEY } from '../../services/themePreference';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty('--blockgo-font-scale');
  delete document.documentElement.dataset.textSize;
  delete document.documentElement.dataset.blockgoTheme;
  document.documentElement.style.removeProperty('color-scheme');
});

test('applies a persistent system theme and emits the shared live-update event', () => {
  const listener = jest.fn();
  window.addEventListener(SYSTEM_THEME_CHANGED_EVENT, listener);
  render(<SettingsMenu />);
  fireEvent.click(screen.getByRole('button', { name: /Settings/i }));
  const themeSwitch = screen.getByRole('switch', { name: /system dark mode/i });
  expect(themeSwitch).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(themeSwitch);
  expect(document.documentElement.dataset.blockgoTheme).toBeUndefined();
  expect(document.documentElement.style.colorScheme).toBe('');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  expect(Object.keys(localStorage).some((key) => key.startsWith('blockgo-chat-dark-mode:'))).toBe(false);
  expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { theme: 'dark' } }));
  window.removeEventListener(SYSTEM_THEME_CHANGED_EVENT, listener);
});

test('opening Settings once does not modify the current text scale', () => {
  document.documentElement.style.setProperty('--blockgo-font-scale', '1.125');
  localStorage.setItem(TEXT_SIZE_STORAGE_KEY, 'small');
  render(<SettingsMenu />);

  fireEvent.click(screen.getByRole('button', { name: /Settings/i }));

  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  expect(document.documentElement.style.getPropertyValue('--blockgo-font-scale')).toBe('1.125');
});

test('text size buttons only change scale when their own button is clicked', () => {
  document.documentElement.style.setProperty('--blockgo-font-scale', '1');
  render(<SettingsMenu />);
  fireEvent.click(screen.getByRole('button', { name: /Settings/i }));

  fireEvent.click(screen.getByRole('button', { name: 'Small text' }));
  expect(document.documentElement.style.getPropertyValue('--blockgo-font-scale')).toBe('0.9');
  expect(screen.getByRole('button', { name: 'Large text' })).toHaveAttribute('aria-pressed', 'false');

  fireEvent.click(screen.getByRole('button', { name: 'Large text' }));
  expect(document.documentElement.style.getPropertyValue('--blockgo-font-scale')).toBe('1.125');
  expect(screen.getByRole('button', { name: 'Small text' })).toHaveAttribute('aria-pressed', 'false');
});

test('changing dark mode does not modify text scale', () => {
  document.documentElement.style.setProperty('--blockgo-font-scale', '1.25');
  render(<SettingsMenu />);
  fireEvent.click(screen.getByRole('button', { name: /Settings/i }));

  fireEvent.click(screen.getByRole('switch', { name: /system dark mode/i }));

  expect(document.documentElement.style.getPropertyValue('--blockgo-font-scale')).toBe('1.25');
});

test('opens Text Size settings and applies a persistent preference immediately', () => {
  render(<SettingsMenu />);
  expect(screen.queryByRole('group', { name: 'Text size' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Settings/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Large text' }));
  expect(document.documentElement.dataset.textSize).toBe('large');
  expect(document.documentElement.style.getPropertyValue('--blockgo-font-scale')).toBe('1.125');
  expect(localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBe('large');
});

test('supports a controlled open state without changing the default menu behavior', () => {
  const onOpenChange = jest.fn();
  const { rerender } = render(<SettingsMenu open={false} onOpenChange={onOpenChange}>Secondary setting</SettingsMenu>);
  fireEvent.click(screen.getByRole('button', { name: /Settings/i }));
  expect(onOpenChange).toHaveBeenCalledWith(true);
  expect(onOpenChange).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();

  rerender(<SettingsMenu open onOpenChange={onOpenChange}>Secondary setting</SettingsMenu>);
  expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveTextContent('Secondary setting');
});
