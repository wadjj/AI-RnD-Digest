// Stable identity across feed copies and the Anthropic engineering URL migration.
export function articleKey(entry) {
  const value = entry.url || entry.guid || entry.id;
  if (!value) return value;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return value;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key)) url.searchParams.delete(key);
    }
    if (['anthropic.com', 'www.anthropic.com'].includes(url.hostname)) {
      url.hostname = 'www.anthropic.com';
      url.pathname = url.pathname.replace(/^\/engineering\/(?=[^/]+\/?$)/, '/research/');
    }
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.href;
  } catch {
    return value;
  }
}

export function preferFullArticles(articles) {
  const byKey = new Map();
  for (const article of articles) {
    const key = articleKey(article);
    if (!key) continue;
    const previous = byKey.get(key);
    if (!previous || (article.content || '').length > (previous.content || '').length) {
      byKey.set(key, article);
    }
  }
  return [...byKey.values()];
}
