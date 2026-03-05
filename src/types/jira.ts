/**
 * JIRA data models and types.
 */

export interface JiraIssue {
  key: string; // e.g., "PROJ-123"
  summary: string;
  status: string; // e.g., "In Progress"
  statusCategory: string; // "To Do" | "In Progress" | "Done"
  priority: string; // e.g., "High"
  issueType: string; // e.g., "Story", "Bug", "Task"
  updatedAt: Date;
  sprintName?: string;
  storyPoints?: number;
}

export interface Sprint {
  id: number;
  name: string;
  state: string; // "active" | "closed" | "future"
  startDate: Date;
  endDate: Date;
}

export interface JiraUserSearchResult {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active: boolean;
}

export interface DateRange {
  from: Date;
  to: Date;
}
