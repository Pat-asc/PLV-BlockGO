export const normalizeStudentNamePart = (value) => String(value || '').trim().replace(/\s+/g, ' ')
  .toLocaleLowerCase('en').replace(/(^|[\s'-])\p{L}/gu, (match) => match.toLocaleUpperCase('en'));

export const normalizeStudentNameFields = (fields = {}) => ({
  ...fields,
  firstName: normalizeStudentNamePart(fields.firstName),
  middleName: normalizeStudentNamePart(fields.middleName),
  lastName: normalizeStudentNamePart(fields.lastName),
});

export const sameStudentIdentity = (left, right) => {
  const first = String(left?.studentId || left?.studentNo || '').trim().toLowerCase();
  const second = String(right?.studentId || right?.studentNo || '').trim().toLowerCase();
  return Boolean(first && second && first === second);
};
