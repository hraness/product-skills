import { GUIDE_FILES, GUIDE_RECORD } from './guides.mjs';
import { raycastPath } from './raycast.mjs';
import { listingIconPath } from './listing.mjs';
import { spongeSupportPath } from './sponge.mjs';

export function validateUpdateFiles(kind, files) {
  if (!['products', 'publications', 'guides'].includes(kind) || !Array.isArray(files) || files.length === 0 || files.length >= 100) throw new Error('Invalid owned update files');
  if (kind === 'guides') { if (new Set(files).size !== files.length || files.some((file) => ![...GUIDE_FILES, GUIDE_RECORD].includes(file))) throw new Error('A shared-guide update contains an unrelated file'); return; }
  const product = '(?:dawn|yaptake|textmock|sponge)';
  const fixed = kind === 'publications' ? ['publication-ledger.json', 'catalog/store-status.json', 'catalog/homebrew-observation.json', 'catalog/directory-observations.json'] : ['README.md', 'catalog/admitted.json', 'catalog/portfolio.json', 'catalog/store-status.json', 'catalog/directory-observations.json', '.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json', '.cursor-plugin/marketplace.json'];
  const generated = [new RegExp(`^bundles/${product}\\.json$`), new RegExp(`^skills/${product}/SKILL\\.md$`), new RegExp(`^plugins/(${product})/(?:LICENSE|README\\.md|plugin\\.json|runtime\\.json|mcp\\.json|\\.mcp\\.json|\\.(?:codex|claude|cursor)-plugin/plugin\\.json|skills/\\1/SKILL\\.md)$`), /^(?:plugins\/textmock\/)?skills\/textmock\/scripts\/textmock-link\.mjs$/, /^plugins\/textmock\/scripts\/textmock-link\.mjs$/, /^(?:plugins\/dawn\/)?skills\/dawn\/examples\/morning-study\.ts$/];
  for (const path of files) if (typeof path !== 'string' || !(fixed.includes(path) || (kind === 'products' && (generated.some((pattern) => pattern.test(path)) || raycastPath(path) || listingIconPath(path) || spongeSupportPath(path))))) throw new Error('An owned update contains an unrelated file');
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
    const allowed = typeof file?.filename === 'string' && (/^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/.test(file.filename) || ['actions/sync-profile/action.yml', 'actions/check-profile/action.yml', 'actions/deliver-dependabot/action.yml'].includes(file.filename));
    if (!allowed || seen.has(file.filename) || file.status !== 'modified' || file.previous_filename !== undefined || typeof file.patch !== 'string' || file.patch.length > 65536) throw new Error('Dependency update contains an unrelated file');
    seen.add(file.filename); const before = []; const after = []; let hunk = null;
    const completeHunk = () => { if (hunk && (hunk.old !== hunk.oldEnd || hunk.next !== hunk.nextEnd)) throw new Error('Dependency patch hunk is incomplete'); };
    for (const line of file.patch.split('\n')) {
      if (line.startsWith('@@')) {
        completeHunk(); const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(line);
        if (!header || Number(header[1]) !== Number(header[3]) || Number(header[2] ?? 1) !== Number(header[4] ?? 1)) throw new Error('Dependency update moves workflow lines');
        const old = Number(header[1]); const next = Number(header[3]);
        if (hunk && old < hunk.oldEnd) throw new Error('Dependency patch hunks overlap');
        hunk = { old, next, oldEnd: old + Number(header[2] ?? 1), nextEnd: next + Number(header[4] ?? 1) }; continue;
      }
      if (line.startsWith('-') || line.startsWith('+')) {
        const parsed = pin.exec(line.slice(1)); if (!parsed || !hunk) throw new Error('Dependency update changes more than an existing action pin');
        if (line[0] === '-') before.push({ pin: parsed, line: hunk.old++ }); else after.push({ pin: parsed, line: hunk.next++ });
      } else if (line.startsWith(' ') && hunk) { hunk.old++; hunk.next++; }
      else if (line && line !== '\\ No newline at end of file') throw new Error('Unsupported dependency patch');
    }
    completeHunk();
    if (!before.length || before.length !== after.length || file.additions !== after.length || file.deletions !== before.length) throw new Error('Dependency patch is incomplete');
    for (let index = 0; index < before.length; index++) if (before[index].line !== after[index].line || before[index].pin[1] !== after[index].pin[1] || before[index].pin[2] !== after[index].pin[2] || before[index].pin[3] === after[index].pin[3]) throw new Error('Dependency update changes the action identity, location or no pin');
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
