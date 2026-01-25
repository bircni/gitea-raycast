import {
  Action,
  ActionPanel,
  Detail,
  Icon,
  List,
  LocalStorage,
  Toast,
  showToast,
  getPreferenceValues,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildRepoUrl,
  formatStatus,
  formatUpdatedAt,
  isValidBaseUrl,
  normalizeBaseUrl,
  truncate,
  type GiteaIssue,
  type GiteaPullRequest,
  type GiteaRelease,
  type GiteaRepo,
} from "./lib/gitea";

interface Preferences {
  baseUrl: string;
  accessToken?: string;
  cacheTtlMinutes?: string;
  quickOpen?: boolean;
}
const CACHE_KEY = "gitea-repos-cache";
const CACHE_TIME_KEY = "gitea-repos-cache-time";
const USAGE_KEY = "gitea-repos-usage";
const DEFAULT_CACHE_TTL_MINUTES = 60;
const PER_PAGE = 100;

function RepoSections({
  baseUrl,
  repo,
  onOpen,
  accessToken,
}: {
  baseUrl: string;
  repo: GiteaRepo;
  onOpen: (repoId: number) => void;
  accessToken?: string;
}) {
  const items = [
    { title: "Code", suffix: "", icon: Icon.Code, type: "link" as const },
    { title: "Issues", suffix: "issues", icon: Icon.Bug, type: "issues" as const },
    { title: "Pull Requests", suffix: "pulls", icon: Icon.ArrowRightCircle, type: "pulls" as const },
    { title: "Releases", suffix: "releases", icon: Icon.Tag, type: "releases" as const },
    { title: "Wiki", suffix: "wiki", icon: Icon.Book, type: "link" as const },
    { title: "Projects", suffix: "projects", icon: Icon.List, type: "link" as const },
    { title: "Settings", suffix: "settings", icon: Icon.Gear, type: "link" as const },
  ];

  return (
    <List searchBarPlaceholder={`Open ${repo.full_name}`}>
      {items.map((item) => (
        <List.Item
          key={item.title}
          title={item.title}
          icon={item.icon}
          actions={
            <ActionPanel>
              {item.type === "issues" ? (
                <Action.Push
                  title="Show Open Issues"
                  icon={Icon.Bug}
                  target={<IssuesList baseUrl={baseUrl} repo={repo} accessToken={accessToken} />}
                />
              ) : item.type === "pulls" ? (
                <Action.Push
                  title="Show Open Pull Requests"
                  icon={Icon.ArrowRightCircle}
                  target={<PullRequestsList baseUrl={baseUrl} repo={repo} accessToken={accessToken} />}
                />
              ) : item.type === "releases" ? (
                <Action.Push
                  title="Show Releases"
                  icon={Icon.Tag}
                  target={<ReleasesList baseUrl={baseUrl} repo={repo} accessToken={accessToken} />}
                />
              ) : (
                <>
                  <Action.OpenInBrowser
                    title={`Open ${item.title}`}
                    url={buildRepoUrl(baseUrl, repo, item.suffix)}
                    onOpen={() => onOpen(repo.id)}
                  />
                  <Action.CopyToClipboard title="Copy URL" content={buildRepoUrl(baseUrl, repo, item.suffix)} />
                </>
              )}
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function ErrorDetail({ message }: { message: string }) {
  return <List.EmptyView title="Gitea Error" description={message} />;
}

function PreferencesHelp() {
  const markdown = [
    "# Open Extension Preferences",
    "",
    "1. Open Raycast.",
    "2. Run the **Extensions** command.",
    "3. Select **Gitea**.",
    "4. Choose **Preferences** and update the Base URL.",
  ].join("\n");

  return <Detail markdown={markdown} />;
}

async function fetchPaged<T>(url: string, accessToken?: string) {
  const items: T[] = [];
  let page = 1;

  while (true) {
    const apiUrl = new URL(url);
    apiUrl.searchParams.set("limit", String(PER_PAGE));
    apiUrl.searchParams.set("page", String(page));
    if (accessToken) {
      apiUrl.searchParams.set("token", accessToken);
    }

    const response = await fetch(apiUrl.toString(), {
      headers: accessToken ? { Authorization: `token ${accessToken}` } : undefined,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Gitea API error (${response.status}): ${message || response.statusText}`);
    }

    const data = (await response.json()) as T[];
    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    items.push(...data);
    if (data.length < PER_PAGE) {
      break;
    }

    page += 1;
  }

  return items;
}

async function fetchCommitStatus(baseUrl: string, owner: string, name: string, sha: string, accessToken?: string) {
  const statusUrl = `${normalizeBaseUrl(baseUrl)}/api/v1/repos/${owner}/${name}/commits/${sha}/status`;
  const response = await fetch(statusUrl, {
    headers: accessToken ? { Authorization: `token ${accessToken}` } : undefined,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Gitea API error (${response.status}): ${message || response.statusText}`);
  }

  const payload = (await response.json()) as { state?: string };
  return payload.state;
}

function IssuesList({ baseUrl, repo, accessToken }: { baseUrl: string; repo: GiteaRepo; accessToken?: string }) {
  const [issues, setIssues] = useState<GiteaIssue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const [owner, name] = repo.full_name.split("/");
    if (!owner || !name) {
      setErrorMessage("Invalid repository name.");
      setIsLoading(false);
      return;
    }

    const url = `${normalizeBaseUrl(baseUrl)}/api/v1/repos/${owner}/${name}/issues?state=open&type=issues`;
    fetchPaged<GiteaIssue>(url, accessToken)
      .then((data) => setIssues(data))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to load issues.";
        setErrorMessage(message);
      })
      .finally(() => setIsLoading(false));
  }, [accessToken, baseUrl, repo.full_name]);

  return (
    <List isLoading={isLoading} searchBarPlaceholder={`Open issues in ${repo.full_name}`}>
      {errorMessage ? (
        <List.EmptyView icon={Icon.ExclamationMark} title="Could not load issues" description={errorMessage} />
      ) : null}
      {issues.map((issue) => (
        <List.Item
          key={issue.id}
          title={`#${issue.number} ${issue.title}`}
          subtitle={`${issue.user.login} • Updated ${formatUpdatedAt(issue.updated_at)}`}
          icon={Icon.Bug}
          actions={
            <ActionPanel>
              <Action.OpenInBrowser title="Open Issue" url={issue.html_url} />
              <Action.CopyToClipboard title="Copy Issue URL" content={issue.html_url} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function PullRequestsList({ baseUrl, repo, accessToken }: { baseUrl: string; repo: GiteaRepo; accessToken?: string }) {
  const [pulls, setPulls] = useState<GiteaPullRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusById, setStatusById] = useState<Record<number, string>>({});

  useEffect(() => {
    const [owner, name] = repo.full_name.split("/");
    if (!owner || !name) {
      setErrorMessage("Invalid repository name.");
      setIsLoading(false);
      return;
    }

    const url = `${normalizeBaseUrl(baseUrl)}/api/v1/repos/${owner}/${name}/pulls?state=open`;
    fetchPaged<GiteaPullRequest>(url, accessToken)
      .then((data) => setPulls(data))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to load pull requests.";
        setErrorMessage(message);
      })
      .finally(() => setIsLoading(false));
  }, [accessToken, baseUrl, repo.full_name]);

  useEffect(() => {
    const [owner, name] = repo.full_name.split("/");
    if (!owner || !name || pulls.length === 0) {
      return;
    }

    let isMounted = true;

    Promise.all(
      pulls.map(async (pull) => {
        const sha = pull.head?.sha;
        if (!sha) {
          return { id: pull.id, state: "unknown" };
        }
        try {
          const state = await fetchCommitStatus(baseUrl, owner, name, sha, accessToken);
          return { id: pull.id, state: state ?? "unknown" };
        } catch {
          return { id: pull.id, state: "unknown" };
        }
      }),
    ).then((results) => {
      if (!isMounted) {
        return;
      }
      const next: Record<number, string> = {};
      for (const result of results) {
        next[result.id] = result.state;
      }
      setStatusById(next);
    });

    return () => {
      isMounted = false;
    };
  }, [accessToken, baseUrl, pulls, repo.full_name]);

  return (
    <List isLoading={isLoading} searchBarPlaceholder={`Open pull requests in ${repo.full_name}`}>
      {errorMessage ? (
        <List.EmptyView icon={Icon.ExclamationMark} title="Could not load pull requests" description={errorMessage} />
      ) : null}
      {pulls.map((pull) => {
        const status = pull.draft ? "Draft" : pull.state;
        const checks = formatStatus(statusById[pull.id]);
        return (
          <List.Item
            key={pull.id}
            title={`#${pull.number} ${pull.title}`}
            subtitle={`${pull.user.login} • Updated ${formatUpdatedAt(pull.updated_at)}${status ? ` • ${status}` : ""} • ${checks}`}
            icon={Icon.ArrowRightCircle}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser title="Open Pull Request" url={pull.html_url} />
                <Action.CopyToClipboard title="Copy Pull Request URL" content={pull.html_url} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

function ReleasesList({ baseUrl, repo, accessToken }: { baseUrl: string; repo: GiteaRepo; accessToken?: string }) {
  const [releases, setReleases] = useState<GiteaRelease[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const [owner, name] = repo.full_name.split("/");
    if (!owner || !name) {
      setErrorMessage("Invalid repository name.");
      setIsLoading(false);
      return;
    }

    const url = `${normalizeBaseUrl(baseUrl)}/api/v1/repos/${owner}/${name}/releases`;
    fetchPaged<GiteaRelease>(url, accessToken)
      .then((data) => setReleases(data))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to load releases.";
        setErrorMessage(message);
      })
      .finally(() => setIsLoading(false));
  }, [accessToken, baseUrl, repo.full_name]);

  return (
    <List isLoading={isLoading} searchBarPlaceholder={`Releases in ${repo.full_name}`}>
      {errorMessage ? (
        <List.EmptyView icon={Icon.ExclamationMark} title="Could not load releases" description={errorMessage} />
      ) : null}
      {releases.map((release) => {
        const title = release.name && release.name.trim().length > 0 ? release.name : release.tag_name;
        const subtitle = release.published_at ? `Published ${formatUpdatedAt(release.published_at)}` : "Release";
        return (
          <List.Item
            key={release.id}
            title={title}
            subtitle={subtitle}
            icon={Icon.Tag}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser title="Open Release" url={release.html_url} />
                <Action.CopyToClipboard title="Copy Release URL" content={release.html_url} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

async function fetchAllRepos(baseUrl: string, accessToken?: string) {
  const apiUrl = `${normalizeBaseUrl(baseUrl)}/api/v1/repos/search`;
  const repos: GiteaRepo[] = [];
  let page = 1;
  let totalCount = 0;

  while (true) {
    const url = new URL(apiUrl);
    url.searchParams.set("limit", String(PER_PAGE));
    url.searchParams.set("page", String(page));
    if (accessToken) {
      url.searchParams.set("token", accessToken);
    }

    const response = await fetch(url.toString(), {
      headers: accessToken ? { Authorization: `token ${accessToken}` } : undefined,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Gitea API error (${response.status}): ${message || response.statusText}`);
    }

    const payload = (await response.json()) as { data?: GiteaRepo[]; total_count?: number | string };
    const data = Array.isArray(payload.data) ? payload.data : [];
    repos.push(...data);

    if (payload.total_count !== undefined) {
      const parsed = typeof payload.total_count === "string" ? Number(payload.total_count) : payload.total_count;
      if (!Number.isNaN(parsed)) {
        totalCount = parsed;
      }
    }

    if (data.length === 0) {
      break;
    }

    if (totalCount > 0 && repos.length >= totalCount) {
      break;
    }

    if (data.length < PER_PAGE) {
      break;
    }

    page += 1;
  }

  return repos;
}

async function loadCachedRepos() {
  const [rawRepos, rawTime] = await Promise.all([
    LocalStorage.getItem<string>(CACHE_KEY),
    LocalStorage.getItem<string>(CACHE_TIME_KEY),
  ]);

  if (!rawRepos || !rawTime) {
    return { repos: null, timestamp: null };
  }

  try {
    const repos = JSON.parse(rawRepos) as GiteaRepo[];
    const timestamp = Number(rawTime);
    if (!Array.isArray(repos) || Number.isNaN(timestamp)) {
      return { repos: null, timestamp: null };
    }
    return { repos, timestamp };
  } catch {
    return { repos: null, timestamp: null };
  }
}

async function saveCachedRepos(repos: GiteaRepo[]) {
  await Promise.all([
    LocalStorage.setItem(CACHE_KEY, JSON.stringify(repos)),
    LocalStorage.setItem(CACHE_TIME_KEY, String(Date.now())),
  ]);
}

async function clearCache() {
  await Promise.all([LocalStorage.removeItem(CACHE_KEY), LocalStorage.removeItem(CACHE_TIME_KEY)]);
}

async function loadUsage() {
  const rawUsage = await LocalStorage.getItem<string>(USAGE_KEY);
  if (!rawUsage) {
    return {} as Record<string, number>;
  }
  try {
    const usage = JSON.parse(rawUsage) as Record<string, number>;
    return usage ?? {};
  } catch {
    return {};
  }
}

async function saveUsage(usage: Record<string, number>) {
  await LocalStorage.setItem(USAGE_KEY, JSON.stringify(usage));
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const baseUrl = preferences.baseUrl?.trim();
  const accessToken = preferences.accessToken?.trim();
  const cacheTtlMinutes = Number(preferences.cacheTtlMinutes) || DEFAULT_CACHE_TTL_MINUTES;
  const quickOpen = preferences.quickOpen ?? false;

  const [repos, setRepos] = useState<GiteaRepo[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshRepos = useCallback(
    async (force = false) => {
      if (!baseUrl) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      if (!force) {
        const cached = await loadCachedRepos();
        if (cached.repos) {
          setRepos(cached.repos);
          const isFresh = cached.timestamp && Date.now() - cached.timestamp < cacheTtlMinutes * 60_000;
          if (isFresh) {
            setIsLoading(false);
            return;
          }
        }
      }

      try {
        const fetched = await fetchAllRepos(baseUrl, accessToken);
        setRepos(fetched);
        await saveCachedRepos(fetched);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load repositories.";
        setErrorMessage(message);
        await showToast({ style: Toast.Style.Failure, title: "Gitea error", message });
      } finally {
        setIsLoading(false);
      }
    },
    [accessToken, baseUrl, cacheTtlMinutes],
  );

  const handleClearCache = useCallback(async () => {
    await clearCache();
    await showToast({ style: Toast.Style.Success, title: "Cache cleared" });
    refreshRepos(true);
  }, [refreshRepos]);

  const handleResetUsage = useCallback(async () => {
    await saveUsage({});
    setUsage({});
    await showToast({ style: Toast.Style.Success, title: "Usage stats reset" });
  }, []);

  const handleRecordUsage = useCallback(
    async (repoId: number) => {
      const key = String(repoId);
      const next = { ...usage, [key]: (usage[key] ?? 0) + 1 };
      setUsage(next);
      await saveUsage(next);
    },
    [usage],
  );

  useEffect(() => {
    refreshRepos();
  }, [refreshRepos]);

  useEffect(() => {
    loadUsage().then(setUsage);
  }, []);

  const filteredRepos = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const filtered = query
      ? repos.filter((repo) => {
          const description = repo.description ?? "";
          return `${repo.full_name} ${description}`.toLowerCase().includes(query);
        })
      : repos;

    return [...filtered].sort((a, b) => {
      const aScore = usage[String(a.id)] ?? 0;
      const bScore = usage[String(b.id)] ?? 0;
      if (aScore !== bScore) {
        return bScore - aScore;
      }
      return a.full_name.localeCompare(b.full_name);
    });
  }, [repos, searchText, usage]);

  const hasValidBaseUrl = isValidBaseUrl(baseUrl);
  if (!hasValidBaseUrl) {
    return (
      <List>
        <List.Item
          icon={Icon.Gear}
          title="Set up your Gitea instance"
          subtitle="Open preferences to update the base URL"
          actions={
            <ActionPanel>
              <Action.Push title="How to Open Preferences" icon={Icon.Gear} target={<PreferencesHelp />} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search Gitea repositories"
      onSearchTextChange={setSearchText}
      throttle
    >
      {errorMessage ? (
        <List.Item
          icon={Icon.ExclamationMark}
          title="Could not load repositories"
          subtitle={truncate(errorMessage)}
          actions={
            <ActionPanel>
              <Action.Push title="How to Open Preferences" icon={Icon.Gear} target={<PreferencesHelp />} />
              <Action title="Refresh Repositories" icon={Icon.ArrowClockwise} onAction={() => refreshRepos(true)} />
              <Action.Push
                title="Show Full Error"
                icon={Icon.Document}
                target={<ErrorDetail message={errorMessage} />}
              />
              <Action.CopyToClipboard title="Copy Error Message" content={errorMessage} />
            </ActionPanel>
          }
        />
      ) : null}
      {filteredRepos.map((repo) => {
        const repoUrl = buildRepoUrl(baseUrl, repo);
        const iconSource = repo.owner?.avatar_url ? { source: repo.owner.avatar_url } : Icon.Code;

        return (
          <List.Item
            key={repo.id}
            title={repo.full_name}
            subtitle={repo.description ?? ""}
            icon={iconSource}
            actions={
              <ActionPanel>
                {quickOpen ? (
                  <>
                    <Action.Push
                      title="Choose Section"
                      icon={Icon.List}
                      target={
                        <RepoSections
                          baseUrl={baseUrl}
                          repo={repo}
                          onOpen={handleRecordUsage}
                          accessToken={accessToken}
                        />
                      }
                    />
                    <Action.OpenInBrowser
                      title="Quick Open Repository"
                      url={repoUrl}
                      onOpen={() => handleRecordUsage(repo.id)}
                    />
                  </>
                ) : (
                  <>
                    <Action.Push
                      title="Choose Section"
                      icon={Icon.List}
                      target={
                        <RepoSections
                          baseUrl={baseUrl}
                          repo={repo}
                          onOpen={handleRecordUsage}
                          accessToken={accessToken}
                        />
                      }
                    />
                    <Action.OpenInBrowser
                      title="Open Repository in Browser"
                      url={repoUrl}
                      onOpen={() => handleRecordUsage(repo.id)}
                    />
                  </>
                )}
                <Action.CopyToClipboard title="Copy Repository URL" content={repoUrl} />
                <Action title="Refresh Repositories" icon={Icon.ArrowClockwise} onAction={() => refreshRepos(true)} />
                <Action title="Clear Cache" icon={Icon.Trash} onAction={handleClearCache} />
                <Action title="Reset Usage Stats" icon={Icon.ArrowCounterClockwise} onAction={handleResetUsage} />
                <Action.Push title="How to Open Preferences" icon={Icon.Gear} target={<PreferencesHelp />} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
