import { calculateFinalAverage, computeFinal } from './gradingHelpers';

test('recomputes the established midterm/finals average without stale values', () => {
  expect(calculateFinalAverage({ midterm: 80, finals: 90 })).toBe(85);
  expect(calculateFinalAverage({ midterm: 80, finals: 94 })).toBe(87);
  expect(computeFinal({ student: { midterm: 80, finals: 94 } }, 'student', 'finals')).toBe('87.00');
});

test('keeps blank, zero, and invalid term values from producing NaN', () => {
  expect(calculateFinalAverage({ midterm: '', finals: 90 })).toBeNull();
  expect(calculateFinalAverage({ midterm: 0, finals: 90 })).toBeNull();
  expect(calculateFinalAverage({ midterm: 'invalid', finals: 90 })).toBeNull();
  expect(computeFinal({ student: { midterm: '', finals: 90 } }, 'student', 'finals')).toBe('-');
});
