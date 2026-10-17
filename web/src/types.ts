// Response types, derived from the API code so web and API cannot drift apart.
import type { Proposal } from '../../api/src/ai/proposals';
import type { ItemView, ProjectView } from '../../api/src/rules';
import type { Settings, Update, User } from '../../api/src/types';
import type { buildDashboard, buildPublic } from '../../api/src/views';

export type { ItemView, ProjectView, Proposal, Settings, Update, User };
export type Dashboard = ReturnType<typeof buildDashboard>;
export type PublicDashboard = ReturnType<typeof buildPublic>;
export type ProjectSummary = Dashboard['attention'][number];
export type DashboardItem = Dashboard['upcoming'][number];

export interface ProjectDetail {
  project: ProjectView;
  /** Newest updates; `nextBefore` pages to older ones (GET /projects/:id/updates?before=). */
  updates: Update[];
  nextBefore?: string;
  items: ItemView[];
}
