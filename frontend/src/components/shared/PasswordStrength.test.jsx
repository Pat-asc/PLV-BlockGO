import { render, screen } from '@testing-library/react';
import PasswordStrength from './PasswordStrength';

test('shows live reusable password strength and requirements', () => {
  const { rerender } = render(<PasswordStrength password="abc" />);
  expect(screen.getByText('Weak')).toBeInTheDocument();
  rerender(<PasswordStrength password="StrongPass1!" />);
  expect(screen.getByText('Strong')).toBeInTheDocument();
  expect(screen.getByText(/uppercase letter/)).toBeInTheDocument();
});
