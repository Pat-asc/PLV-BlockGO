import fs from 'fs';
import path from 'path';

const sourceRoot = path.resolve(__dirname, '..');
const nativeDialogPattern = /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/;

const sourceFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const fullPath = path.join(directory, entry.name);
  if (entry.isDirectory()) return sourceFiles(fullPath);
  if (!/\.(?:js|jsx)$/.test(entry.name) || /\.test\.(?:js|jsx)$/.test(entry.name)) return [];
  return [fullPath];
});

test('frontend production source contains no browser-native dialogs', () => {
  const offenders = sourceFiles(sourceRoot)
    .filter((file) => nativeDialogPattern.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(sourceRoot, file));

  expect(offenders).toEqual([]);
});
