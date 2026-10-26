import assert from 'node:assert/strict';
import test from 'node:test';
import { articleKey, preferFullArticles } from '../scripts/article-identity.js';

test('Anthropic migration aliases share identity without rewriting output URLs', () => {
  const oldUrl = 'https://www.anthropic.com/engineering/redesigning-source-control';
  const newUrl = 'https://www.anthropic.com/research/redesigning-source-control';
  assert.equal(articleKey({ url: oldUrl }), articleKey({ url: newUrl }));
  const posts = preferFullArticles([{ url: oldUrl, content: 'full body' }, { url: newUrl, content: '' }]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, oldUrl);
  assert.notEqual(articleKey({ url: 'https://other.example/engineering/a' }), articleKey({ url: 'https://other.example/research/a' }));
});

test('same-article feed copies retain the complete body in either order', () => {
  const short = { url: 'https://magazine.sebastianraschka.com/p/example?utm_source=rss#comments', content: 'summary' };
  const full = { url: 'https://magazine.sebastianraschka.com/p/example', content: 'complete article body' };
  assert.deepEqual(preferFullArticles([short, full]), [full]);
  assert.deepEqual(preferFullArticles([full, short]), [full]);
  assert.notEqual(articleKey({ url: 'https://example.com/read?id=1' }), articleKey({ url: 'https://example.com/read?id=2' }));
});
