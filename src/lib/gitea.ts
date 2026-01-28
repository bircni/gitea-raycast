export interface GiteaRepo {
  id: number;
  full_name: string;
  description?: string | null;
  html_url: string;
  owner?: {
    login?: string;
    avatar_url?: string;
  };
}

export interface GiteaUser {
  login: string;
  avatar_url?: string;
}

export interface GiteaIssue {
  id: number;
  number: number;
  title: string;
  html_url: string;
  user: GiteaUser;
  updated_at: string;
  state: string;
}

export interface GiteaPullRequest extends GiteaIssue {
  draft?: boolean;
  head?: {
    sha: string;
  };
  assignee?: GiteaUser | null;
  assignees?: GiteaUser[];
  requested_reviewers?: GiteaUser[];
}

export interface GiteaRelease {
  id: number;
  name?: string | null;
  tag_name: string;
  html_url: string;
  published_at?: string | null;
}

export function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

export function buildRepoUrl(baseUrl: string, repo: GiteaRepo, suffix?: string) {
  const repoUrl = repo.html_url || `${baseUrl}/${repo.full_name}`;
  if (!suffix) {
    return repoUrl;
  }
  return `${repoUrl.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

export function truncate(text: string, maxLength = 120) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

export function isValidBaseUrl(baseUrl?: string) {
  if (!baseUrl) {
    return false;
  }
  try {
    const parsed = new URL(baseUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function formatUpdatedAt(updatedAt: string) {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return updatedAt;
  }
  return date.toLocaleString();
}

export function formatStatus(state?: string) {
  const normalized = (state ?? "").toLowerCase();
  if (normalized === "success") {
    return "✅ passed";
  }
  if (normalized === "failure") {
    return "❌ failed";
  }
  if (normalized === "pending") {
    return "⏳ pending";
  }
  if (normalized === "error") {
    return "⚠️ error";
  }
  return "⚪ unknown";
}
