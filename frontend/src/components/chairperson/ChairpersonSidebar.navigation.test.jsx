import { fireEvent, render, screen } from '@testing-library/react';
import ChairpersonSidebar from './ChairpersonSidebar';

test('clearer Chairperson labels preserve the workflow tab identifiers', () => {
  const setActiveTab = jest.fn();
  render(<ChairpersonSidebar activeTab="forReview" setActiveTab={setActiveTab} />);

  fireEvent.click(screen.getByRole('button', { name: 'Grade Review' }));
  expect(setActiveTab).toHaveBeenCalledWith('forReview');
  fireEvent.click(screen.getByRole('button', { name: 'Returned Grades' }));
  expect(setActiveTab).toHaveBeenCalledWith('returned');
  fireEvent.click(screen.getByRole('button', { name: 'Finalize Grades' }));
  expect(setActiveTab).toHaveBeenCalledWith('approved');
  fireEvent.click(screen.getByRole('button', { name: 'Finalized Grades' }));
  expect(setActiveTab).toHaveBeenCalledWith('forwarded');
});
