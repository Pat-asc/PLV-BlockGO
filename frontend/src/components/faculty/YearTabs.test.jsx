import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import YearTabs from './YearTabs';

const Harness = ({ initial = '', sections = [] }) => {
  const [active, setActive] = useState(initial);
  return <><span data-testid="active-year">{active}</span><YearTabs activeTab={active} setActiveTab={setActive} sections={sections} /></>;
};

test('shows only year levels represented by active assignments and selects the first', async () => {
  render(<Harness sections={[{ year: '1st Year' }, { year: '1st Year' }, { year: '3rd Year' }]} />);
  expect(screen.getAllByText('1st Year')).toHaveLength(2);
  expect(screen.getByText('3rd Year')).toBeInTheDocument();
  expect(screen.queryByText('2nd Year')).not.toBeInTheDocument();
  expect(screen.queryByText('4th Year')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('active-year')).toHaveTextContent('1st Year'));
});

test('shows no fake tabs when no active section exists', () => {
  render(<Harness sections={[]} />);
  expect(screen.queryByText(/Year$/)).not.toBeInTheDocument();
});

test('switches selection when the selected year disappears after refresh', async () => {
  const { rerender } = render(<Harness initial="3rd Year" sections={[{ year: '1st Year' }, { year: '3rd Year' }]} />);
  expect(screen.getByTestId('active-year')).toHaveTextContent('3rd Year');
  rerender(<Harness initial="3rd Year" sections={[{ year: '1st Year' }]} />);
  await waitFor(() => expect(screen.getByTestId('active-year')).toHaveTextContent('1st Year'));
  expect(screen.queryByText('3rd Year')).not.toBeInTheDocument();
});

test('allows selecting another available assigned year', async () => {
  render(<Harness sections={[{ year: '2nd Year' }, { year: '4th Year' }]} />);
  await waitFor(() => expect(screen.getByTestId('active-year')).toHaveTextContent('2nd Year'));
  fireEvent.click(screen.getByText('4th Year'));
  expect(screen.getByTestId('active-year')).toHaveTextContent('4th Year');
});
