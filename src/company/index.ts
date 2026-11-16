// The company seam (docs/architecture.md, "Seams between the streams"): createCompany for a new company, openCompany
// for one already in a folder's .worklings/. Both give the hub a CompanyHandle. Tests pass a fake `git`; the hub
// passes nothing and gets the real one.
import type { PlainLaunch } from '../core/plain.ts';
import type { CompanyDeps } from '../core/company.ts';
import { type Company, foundCompany, type GitOps, reopenCompany } from './company.ts';
import type { LookRunner } from './app-look.ts';
import type { CheckRunner } from './check-run.ts';
import { useApprovalKey } from '../org/approved-loads.ts';
import * as realGit from './git.ts';

export type { Company, GitOps } from './company.ts';
export { companyIdAt, hasCompany, screenshotFile, STATE_DIR } from './store.ts';

interface Extras {
  git?: GitOps;
  /** Problems the company carries on after (a dropped log line, a failed listener); console.warn by default. */
  warn?: (message: string) => void;
  /** How a task's check is run (src/company/check-run.ts); tests pass a fake, the hub the real one. */
  runCheck?: CheckRunner;
  /** v0.3: how the office looks at the running app before a final review (src/company/app-look.ts); tests pass a fake. */
  lookApp?: LookRunner;
}

/** A Company is a CompanyHandle; its `idle()` resolves once the git work queued so far is done. */
export function createCompany(o: CompanyDeps & { root: string; prompt: string; stakeholder: string; id?: string; shape?: 'plain' | 'solo' | 'harness' | 'classic'; launch?: PlainLaunch } & Extras): Company {
  // The record of what each desk may load is signed with the same key as the log (src/org/approved-loads.ts).
  useApprovalKey(o.root, o.key);
  return foundCompany({ ...o, git: o.git ?? realGit });
}

export function openCompany(o: CompanyDeps & { root: string } & Extras): Company {
  useApprovalKey(o.root, o.key);
  return reopenCompany({ ...o, git: o.git ?? realGit });
}
