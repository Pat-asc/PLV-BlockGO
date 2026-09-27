import { fireEvent, render, screen } from '@testing-library/react';
import TextSizeControl from './TextSizeControl';
import { TEXT_SIZE_STORAGE_KEY } from '../../services/textSizePreference';

test('applies and persists an accessible global text scale', () => {
  render(<TextSizeControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Large text' }));
  expect(document.documentElement.style.getPropertyValue('--blockgo-font-scale')).toBe('1.125');
  expect(window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBe('large');
});
