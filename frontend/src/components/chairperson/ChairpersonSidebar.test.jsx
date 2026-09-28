import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ChairpersonSidebar from './ChairpersonSidebar';

test('exposes the intermediate Finalize Queue between review and finalized tracking', () => {
  const setActiveTab = jest.fn();
  render(<ChairpersonSidebar activeTab="forReview" setActiveTab={setActiveTab} />);

  const labels = screen.getAllByRole('button').map((button) => button.textContent.trim());
  expect(labels.indexOf('For Review')).toBeLessThan(labels.indexOf('Finalize Queue'));
  expect(labels.indexOf('Finalize Queue')).toBeLessThan(labels.indexOf('Finalized'));

  fireEvent.click(screen.getByRole('button', { name: 'Finalize Queue' }));
  expect(setActiveTab).toHaveBeenCalledWith('approved');
});
