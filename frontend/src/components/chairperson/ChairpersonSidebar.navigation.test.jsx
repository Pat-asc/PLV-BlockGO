import { fireEvent, render, screen } from '@testing-library/react';
import ChairpersonSidebar from './ChairpersonSidebar';

test('remaining Chairperson navigation preserves the existing tab identifiers', () => {
  const setActiveTab = jest.fn();
  render(<ChairpersonSidebar activeTab="forReview" setActiveTab={setActiveTab} />);

  for (const [label, tab] of [
    ['Encoding Monitoring', 'dashboard'], ['Department Sections', 'sectioning'],
    ['Faculty Assignments', 'assignment'], ['Curriculum Builder', 'curriculum'],
    ['Grade Review', 'forReview'],
  ]) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(setActiveTab).toHaveBeenLastCalledWith(tab);
  }
  expect(setActiveTab).not.toHaveBeenCalledWith('returned');
  expect(setActiveTab).not.toHaveBeenCalledWith('approved');
  expect(setActiveTab).not.toHaveBeenCalledWith('forwarded');
});
