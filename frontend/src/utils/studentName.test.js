import { normalizeStudentNameFields, normalizeStudentNamePart, sameStudentIdentity } from './studentName';

test('normalizes whitespace and capitalization without changing surname word boundaries', () => {
  expect(normalizeStudentNamePart('  dela   cruz  ')).toBe('Dela Cruz');
  expect(normalizeStudentNamePart('DELACRUZ')).toBe('Delacruz');
  expect(normalizeStudentNameFields({ firstName: '  jUAN ', lastName: 'dela   cruz' }))
    .toMatchObject({ firstName: 'Juan', lastName: 'Dela Cruz' });
});

test('student identity uses Student ID and never similar names', () => {
  expect(sameStudentIdentity({ studentId: '26-0001', name: 'Dela Cruz' }, { studentNo: '26-0001', name: 'Delacruz' })).toBe(true);
  expect(sameStudentIdentity({ studentId: '26-0001', name: 'Dela Cruz' }, { studentNo: '26-0002', name: 'Dela Cruz' })).toBe(false);
  expect(sameStudentIdentity({ name: 'Dela Cruz' }, { name: 'Dela Cruz' })).toBe(false);
});
