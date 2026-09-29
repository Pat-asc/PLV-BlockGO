import {
  buildFacultySchedule,
  formatFacultySchedule,
  isValidScheduleRange,
  parseFacultySchedule,
  serializeAssignmentSchedule,
} from './facultySchedule';

test('builds, parses, and formats a canonical faculty schedule', () => {
  const stored = buildFacultySchedule('Monday', '08:00', '10:00');
  expect(stored).toBe('Monday | 08:00-10:00');
  expect(parseFacultySchedule(stored)).toEqual({ day: 'Monday', startTime: '08:00', endTime: '10:00' });
  expect(formatFacultySchedule(stored)).toBe('Monday • 8:00 AM–10:00 AM');
});

test('preserves readable legacy and multiple-day schedule values', () => {
  expect(formatFacultySchedule('Tuesday')).toBe('Tuesday');
  expect(formatFacultySchedule('Mon / Wed | 1:00 PM - 2:30 PM')).toBe('Mon / Wed • 1:00 PM–2:30 PM');
  expect(serializeAssignmentSchedule({ day: 'Friday', schedule: '7:00 AM - 9:00 AM' }))
    .toBe('Friday | 7:00 AM - 9:00 AM');
});

test('rejects missing, equal, and reversed time ranges', () => {
  expect(isValidScheduleRange('08:00', '10:00')).toBe(true);
  expect(isValidScheduleRange('10:00', '10:00')).toBe(false);
  expect(isValidScheduleRange('10:00', '09:00')).toBe(false);
  expect(buildFacultySchedule('Monday', '10:00', '09:00')).toBe('');
});
