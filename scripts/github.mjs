export function validateUpdateFiles(kind, files) {
  if (!['products', 'publications'].includes(kind) || !Array.isArray(files) || files.length === 0 || files.length >= 100) throw new Error('Invalid owned update files');
  const product = '(?:dawn|yaptake|textmock|sponge)';
  const fixed = kind === 'publications' ? ['publication-ledger.json', 'catalog/store-status.json'] : ['README.md', 'catalog/admitted.json', 'catalog/portfolio.json', 'catalog/store-status.json', '.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json', '.cursor-plugin/marketplace.json'];
  const generated = [new RegExp(`^bundles/${product}\\.json$`), new RegExp(`^skills/${product}/SKILL\\.md$`), new RegExp(`^plugins/(${product})/(?:LICENSE|README\\.md|plugin\\.json|runtime\\.json|mcp\\.json|\\.mcp\\.json|\\.(?:codex|claude|cursor)-plugin/plugin\\.json|skills/\\1/SKILL\\.md)$`), /^(?:plugins\/textmock\/)?skills\/textmock\/scripts\/textmock-link\.mjs$/, /^plugins\/textmock\/scripts\/textmock-link\.mjs$/, /^(?:plugins\/dawn\/)?skills\/dawn\/examples\/morning-study\.ts$/];
  for (const path of files) if (typeof path !== 'string' || !(fixed.includes(path) || (kind === 'products' && generated.some((pattern) => pattern.test(path))))) throw new Error('An owned update contains an unrelated file');
}

export async function updateOwnedBranch({ repository, number, expected, request, read, wait = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  if (!/^[a-f0-9]{40}$/.test(expected) || !Number.isSafeInteger(number) || number < 1) throw new Error('Invalid conditional branch update');
  await request(['api', '--method', 'PUT', `repos/${repository}/pulls/${number}/update-branch`, '-f', `expected_head_sha=${expected}`]);
  for (let attempt = 0; attempt < 10; attempt++) {
    const pr = await read(`repos/${repository}/pulls/${number}`);
    if (pr.head.sha !== expected || ['clean', 'unstable', 'blocked', 'has_hooks'].includes(pr.mergeable_state)) return pr;
    await wait(500);
  }
  throw new Error('The conditional branch update did not settle within five seconds');
}
