export function validateUpdateFiles(kind, files) {
  if (!['products', 'publications'].includes(kind) || !Array.isArray(files) || files.length === 0 || files.length >= 100) throw new Error('Invalid owned update files');
  const product = '(?:dawn|yaptake|textmock|sponge)';
  const fixed = kind === 'publications' ? ['publication-ledger.json', 'catalog/store-status.json'] : ['README.md', 'catalog/admitted.json', 'catalog/portfolio.json', 'catalog/store-status.json', '.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json', '.cursor-plugin/marketplace.json'];
  const generated = [new RegExp(`^bundles/${product}\\.json$`), new RegExp(`^skills/${product}/SKILL\\.md$`), new RegExp(`^plugins/(${product})/(?:LICENSE|README\\.md|plugin\\.json|runtime\\.json|mcp\\.json|\\.mcp\\.json|\\.(?:codex|claude|cursor)-plugin/plugin\\.json|skills/\\1/SKILL\\.md)$`), /^(?:plugins\/textmock\/)?skills\/textmock\/scripts\/textmock-link\.mjs$/, /^plugins\/textmock\/scripts\/textmock-link\.mjs$/, /^(?:plugins\/dawn\/)?skills\/dawn\/examples\/morning-study\.ts$/];
  for (const path of files) if (typeof path !== 'string' || !(fixed.includes(path) || (kind === 'products' && generated.some((pattern) => pattern.test(path))))) throw new Error('An owned update contains an unrelated file');
}

export function successfulRequired(value, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha) || !Array.isArray(value?.check_runs)) return false;
  const required = value.check_runs.filter((check) => check.name === 'Required' && check.app?.id === 15368 && check.head_sha === sha).sort((a, b) => b.id - a.id)[0];
  return required?.status === 'completed' && required.conclusion === 'success';
}

export async function refreshBehindPull({ repository, number, head, read, request, wait }) {
  if (!['hraness/product-skills', 'hraness/.github', '0thernet/0thernet'].includes(repository) || !/^[a-f0-9]{40}$/.test(head)) throw new Error('Invalid owned branch target');
  const main = (await read(`repos/${repository}/git/ref/heads/main`)).object?.sha;
  if (!/^[a-f0-9]{40}$/.test(main)) throw new Error('Invalid protected main');
  const contains = async (sha) => {
    const comparison = await read(`repos/${repository}/compare/${main}...${sha}`);
    if (!Number.isSafeInteger(comparison.behind_by) || comparison.behind_by < 0) throw new Error('Invalid owned branch comparison');
    return comparison.behind_by === 0 && comparison.merge_base_commit?.sha === main;
  };
  if (await contains(head)) return { updated: false, head, main };
  const pull = await updateOwnedBranch({ repository, number, expected: head, request, read, wait });
  if (!/^[a-f0-9]{40}$/.test(pull.head.sha) || pull.head.sha === head || !await contains(pull.head.sha)) throw new Error('Owned branch did not reconcile with governed main');
  return { updated: true, head: pull.head.sha, main, pull };
}

export function validateDependabotPins(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length >= 100) throw new Error('Invalid dependency update files');
  const seen = new Set();
  const pin = /^(\s*(?:-\s*)?uses:\s+)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)@([a-f0-9]{40})(\s+#.*)?$/;
  for (const file of files) {
    const allowed = typeof file?.filename === 'string' && (/^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/.test(file.filename) || file.filename === 'actions/sync-profile/action.yml');
    if (!allowed || seen.has(file.filename) || file.status !== 'modified' || file.previous_filename !== undefined || typeof file.patch !== 'string' || file.patch.length > 65536) throw new Error('Dependency update contains an unrelated file');
    seen.add(file.filename); const before = []; const after = [];
    for (const line of file.patch.split('\n')) {
      if (line.startsWith('-') || line.startsWith('+')) { const parsed = pin.exec(line.slice(1)); if (!parsed) throw new Error('Dependency update changes more than an existing action pin'); (line[0] === '-' ? before : after).push(parsed); }
      else if (line && !line.startsWith(' ') && !line.startsWith('@@') && line !== '\\ No newline at end of file') throw new Error('Unsupported dependency patch');
    }
    if (!before.length || before.length !== after.length || file.additions !== after.length || file.deletions !== before.length) throw new Error('Dependency patch is incomplete');
    for (let index = 0; index < before.length; index++) if (before[index][1] !== after[index][1] || before[index][2] !== after[index][2] || before[index][3] === after[index][3]) throw new Error('Dependency update changes the action identity or no pin');
  }
}

export async function repairMissingCheck({ repository, workflow, ref, sha, read, request, inputs = [] }) {
  if (!['hraness/product-skills', 'hraness/.github', '0thernet/0thernet'].includes(repository) || !/^[A-Za-z0-9_-]+\.ya?ml$/.test(workflow) || !/^[a-f0-9]{40}$/.test(sha) || !(ref === 'main' || /^automation\/[A-Za-z0-9_.\/-]+$/.test(ref))) throw new Error('Invalid check repair target');
  const checks = await read(`repos/${repository}/commits/${sha}/check-runs?per_page=100`);
  if (checks.check_runs?.some((check) => check.name === 'Required' && check.app?.id === 15368 && check.head_sha === sha)) return 'present';
  const runs = await read(`repos/${repository}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100`);
  if (!Array.isArray(runs.workflow_runs) || !Number.isSafeInteger(runs.total_count) || runs.total_count < runs.workflow_runs.length || runs.workflow_runs.some((run) => run.head_sha !== sha) || runs.total_count > 0 && runs.workflow_runs.length === 0) throw new Error('Cannot establish whether an exact-head workflow run exists');
  if (runs.total_count > 0) return 'present';
  await request(['workflow', 'run', workflow, '--repo', repository, '--ref', ref, ...inputs]);
  return 'requested';
}

export async function updateOwnedBranch({ repository, number, expected, request, read, wait = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  if (!/^[a-f0-9]{40}$/.test(expected) || !Number.isSafeInteger(number) || number < 1) throw new Error('Invalid conditional branch update');
  await request(['api', '--method', 'PUT', `repos/${repository}/pulls/${number}/update-branch`, '-f', `expected_head_sha=${expected}`]);
  for (let attempt = 0; attempt < 10; attempt++) {
    const pr = await read(`repos/${repository}/pulls/${number}`);
    if (pr.head.sha !== expected) return pr;
    await wait(500);
  }
  throw new Error('The conditional branch update did not settle within five seconds');
}
