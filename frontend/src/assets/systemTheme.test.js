import fs from 'fs';
import path from 'path';

test('dark theme contrast rules follow bright and dark interaction surfaces', () => {
  const css = fs.readFileSync(path.join(__dirname, 'systemTheme.css'), 'utf8');
  expect(css).toContain('--blockgo-on-bright-surface: #0f172a');
  expect(css).toContain('--blockgo-on-dark-surface: #f8fafc');
  expect(css).toContain('.hover\\:bg-yellow-400, .hover\\:bg-white):hover');
  expect(css).toContain("[data-contrast-surface='dark']");
});
