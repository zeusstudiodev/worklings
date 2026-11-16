// The real parts the hub wires together, at the paths docs/architecture.md gives them. Loaded only when startHub isn't
// given every part, so tests that pass fakes never load these.
import { companyIdAt, createCompany, openCompany } from '../company/index.ts';
import { orgOps } from '../org/index.ts';
import { orgToolsHandler } from '../orgtools/index.ts';
import { classifyPermission, stopsByPid } from '../runtime/approvals.ts';
import { createSwitchboard, startedBy } from '../runtime/index.ts';
import { createPreviews } from '../server/preview.ts';
import { startTailnet } from '../server/tailnet.ts';
import type { HubMakers } from './seams.ts';

export const REAL: HubMakers = {
  createCompany, openCompany, companyIdAt, orgOps, createSwitchboard, classifyPermission, orgToolsHandler, createPreviews, startTailnet,
  ownProcesses: startedBy, stopsByPid,
};
