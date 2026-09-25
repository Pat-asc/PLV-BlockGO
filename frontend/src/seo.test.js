import fs from 'fs';
import path from 'path';

test('public SEO files identify only the production homepage as canonical', () => {
  const publicDir = path.resolve(__dirname, '../public');
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const robots = fs.readFileSync(path.join(publicDir, 'robots.txt'), 'utf8');
  const sitemap = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf8');
  expect(html).toContain('<title>PLV BlockGO | Grade Records Management System</title>');
  expect(html.match(/rel="canonical"/g)).toHaveLength(1);
  expect(html).toContain('https://plv-blockgo.com/');
  expect(html).toContain('Pamantasan ng Lungsod ng Valenzuela');
  expect(robots).toContain('Disallow: /student');
  expect(robots).toContain('Sitemap: https://plv-blockgo.com/sitemap.xml');
  expect(sitemap).toContain('<loc>https://plv-blockgo.com/</loc>');
  expect(sitemap).not.toContain('/student');
});
