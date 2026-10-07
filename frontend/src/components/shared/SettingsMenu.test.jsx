import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SettingsMenu from './SettingsMenu';
import { TEXT_SIZE_STORAGE_KEY } from '../../services/textSizePreference';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty('--blockgo-font-scale');
  delete document.documentElement.dataset.textSize;
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
  expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();

  rerender(<SettingsMenu open onOpenChange={onOpenChange}>Secondary setting</SettingsMenu>);
  expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveTextContent('Secondary setting');
});
