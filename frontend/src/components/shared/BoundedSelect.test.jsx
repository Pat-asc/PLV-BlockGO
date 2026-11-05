import { fireEvent, render, screen } from '@testing-library/react';
import BoundedSelect from './BoundedSelect';

test('uses a bounded internally scrollable searchable list and supports keyboard selection', () => {
  const onChange = jest.fn();
  render(<BoundedSelect label="Program" value="" onChange={onChange} searchable options={Array.from({ length: 20 }, (_, index) => ({ value: `P${index}`, label: `Program ${index}` }))} />);
  const trigger = screen.getByRole('button', { name: 'Program' });
  fireEvent.click(trigger);
  expect(screen.getByRole('listbox', { name: 'Program' })).toHaveClass('overflow-y-auto');
  fireEvent.change(screen.getByLabelText('Search Program'), { target: { value: 'Program 17' } });
  fireEvent.click(screen.getByRole('option', { name: 'Program 17' }));
  expect(onChange).toHaveBeenCalledWith('P17');
});

test('closes on Escape and remains keyboard accessible', () => {
  render(<BoundedSelect label="Semester" value="FIRST" onChange={() => {}} options={[{ value: 'FIRST', label: 'First Semester' }, { value: 'SECOND', label: 'Second Semester' }]} />);
  const trigger = screen.getByRole('button', { name: 'Semester' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

test('forwards bounded search text and prevents disabled duplicate choices', () => {
  const onChange = jest.fn();
  const onSearch = jest.fn();
  render(<BoundedSelect label="Existing Student" value="" onChange={onChange} onSearch={onSearch} searchable options={[
    { value: '1', label: '26-0001 · Available Student' },
    { value: '2', label: '26-0002 · Already enrolled', disabled: true },
  ]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Existing Student' }));
  fireEvent.change(screen.getByLabelText('Search Existing Student'), { target: { value: '26-0002' } });
  expect(onSearch).toHaveBeenCalledWith('26-0002');
  const duplicate = screen.getByRole('option', { name: /already enrolled/i });
  expect(duplicate).toBeDisabled();
  fireEvent.click(duplicate);
  expect(onChange).not.toHaveBeenCalled();
});

test('provides explicit readable dark, selected, active, focus, and disabled states', () => {
  render(<BoundedSelect label="Program" value="BSIT" onChange={() => {}} options={[
    { value: 'BSIT', label: 'Information Technology' },
    { value: 'BSCS', label: 'Computer Science' },
    { value: 'BSIS', label: 'Information Systems', disabled: true },
  ]} />);

  const trigger = screen.getByRole('button', { name: 'Program' });
  expect(trigger).toHaveClass('dark:bg-slate-800', 'dark:text-slate-100', 'focus-visible:ring-2', 'dark:focus-visible:ring-sky-900');
  fireEvent.click(trigger);

  const selected = screen.getByRole('option', { name: 'Information Technology' });
  expect(selected).toHaveAttribute('aria-selected', 'true');
  expect(selected).toHaveClass('font-bold', 'dark:bg-sky-950', 'dark:text-sky-300');

  const active = screen.getByRole('option', { name: 'Computer Science' });
  fireEvent.mouseEnter(active);
  expect(active).toHaveClass('dark:bg-sky-950', 'dark:text-sky-100');

  const disabled = screen.getByRole('option', { name: 'Information Systems' });
  expect(disabled).toBeDisabled();
  expect(disabled).toHaveClass('dark:disabled:bg-slate-800', 'dark:disabled:text-slate-500');
});
