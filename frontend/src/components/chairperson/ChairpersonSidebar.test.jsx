import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ChairpersonSidebar from './ChairpersonSidebar';

test('exposes the approved handoff queue between review and finalized tracking', () => {
  const setActiveTab = jest.fn();
  render(<ChairpersonSidebar activeTab="forReview" setActiveTab={setActiveTab} />);

  const labels = screen.getAllByRole('button').map((button) => button.textContent.trim());
  expect(labels.indexOf('Grade Review')).toBeLessThan(labels.indexOf('Approved Grades'));
  expect(labels.indexOf('Grade Review')).toBeLessThan(labels.indexOf('Returned Grades'));
  expect(labels.indexOf('Returned Grades')).toBeLessThan(labels.indexOf('Approved Grades'));
  expect(labels.indexOf('Approved Grades')).toBeLessThan(labels.indexOf('Finalized Grades'));

  fireEvent.click(screen.getByRole('button', { name: 'Approved Grades' }));
  expect(setActiveTab).toHaveBeenCalledWith('approved');
});
