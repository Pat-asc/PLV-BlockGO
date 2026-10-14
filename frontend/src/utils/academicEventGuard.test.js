import { createAcademicEventGuard, getAcademicEventKeys } from './academicEventGuard';

test('prefers a stable backend event identifier', () => {
  expect(getAcademicEventKeys({ EventId: 'evt-42', ChangedAt: 'volatile' })).toEqual({
    exact: 'id|evt-42',
    burst: 'id|evt-42',
  });
});

test('deduplicates exact replays without extending expiry and collapses regenerated bursts', () => {
  let time = 1000;
  const accept = createAcademicEventGuard({ exactTtlMs: 10000, burstTtlMs: 10000, now: () => time });
  const first = { reason: 'section_created', department: 'BSIT', actor: 'registrar', changedAt: 'first' };

  expect(accept(first)).toBe(true);
  time = 1500;
  expect(accept(first)).toBe(false);
  time = 2500;
  expect(accept({ ...first, changedAt: 'regenerated' })).toBe(false);
  time = 3101;
  expect(accept({ ...first, changedAt: 'genuinely-later' })).toBe(false);
  time = 9000;
  expect(accept(first)).toBe(false);
  time = 11001;
  expect(accept(first)).toBe(true);
});

test('keeps the cache bounded while accepting distinct events', () => {
  const accept = createAcademicEventGuard({ maxEntries: 3, burstTtlMs: 1 });
  for (let index = 0; index < 20; index += 1) {
    expect(accept({ eventId: `event-${index}` })).toBe(true);
  }
});
