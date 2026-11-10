import React from 'react';
import { render, screen } from '@testing-library/react';
import ChairpersonSidebar from './ChairpersonSidebar';

test('shows current Chairperson navigation without returned or approved grade tabs', () => {
  const setActiveTab = jest.fn();
  render(<ChairpersonSidebar activeTab="forReview" setActiveTab={setActiveTab} />);

  const labels = screen.getAllByRole('button').map((button) => button.textContent.trim());
  expect(labels).toEqual([
    'Encoding Monitoring', 'Department Sections', 'Faculty Assignments',
    'Curriculum Builder', 'Grade Review',
  ]);
  expect(screen.queryByRole('button', { name: 'Returned Grades' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approved Grades' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Finalized Grades' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Grade Review' })).toHaveAttribute('aria-current', 'page');
});
