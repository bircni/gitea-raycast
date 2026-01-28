import {
  Action,
  ActionPanel,
  Detail,
  Icon,
  List,
  LocalStorage,
  Toast,
  getPreferenceValues,
  showToast,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatStatus, isValidBaseUrl, normalizeBaseUrl, truncate, type GiteaPullRequest } from "./lib/gitea";
import { fetchAllRepos, fetchCommitStatus, fetchCurrentUser, fetchPaged, GiteaApiError } from "./lib/gitea-api";
import { GiteaSetupForm } from "./lib/GiteaSetupForm";
import { loadStoredGiteaSettings } from "./lib/gitea-settings";

interface Preferences {
  baseUrl?: string;
  accessToken?: string;
  cacheTtlMinutes?: string;
  debug?: boolean;
}

type GiteaPullRequestWithRepo = GiteaPullRequest & {
  repository?: { full_name?: string | null } | null;
  base?: { repo?: { full_name?: string | null } | null } | null;
};

function redactToken(token?: string) {
  if (!token) return "(empty)";
  if (token.length <= 8) return "********";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function toDebugError(err: unknown) {
  if (err instanceof GiteaApiError) {
    return { type: "GiteaApiError", status: err.status, message: err.message, url: err.url };
  }
  if (err instanceof Error) {
    return { type: err.name || "Error", message: err.message };
  }
  return { type: "Unknown", message: String(err) };
}

function inferRepoFullNameFromPullUrl(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    // Common Gitea format: /{owner}/{repo}/pulls/{index}
    if (parts.length >= 4 && (parts[2] === "pulls" || parts[2] === "pull")) {
      return `${parts[0]}/${parts[1]}`;
    }
  } catch {
    // ignore
  }
  return null;
}

function getPullRepoFullName(pull: GiteaPullRequestWithRepo) {
  return pull.repository?.full_name || pull.base?.repo?.full_name || inferRepoFullNameFromPullUrl(pull.html_url);
}

function sortByUpdatedAtDesc(a: GiteaPullRequest, b: GiteaPullRequest) {
  const at = Date.parse(a.updated_at);
  const bt = Date.parse(b.updated_at);
  if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
  if (Number.isNaN(at)) return 1;
  if (Number.isNaN(bt)) return -1;
  return bt - at;
}

function getRepoOwnerAndName(pull: GiteaPullRequestWithRepo) {
  const full = getPullRepoFullName(pull);
  if (!full) return null;
  const [owner, name] = full.split("/");
  if (!owner || !name) return null;
  return { owner, name };
}

type PullInboxCachePayload = {
  created: GiteaPullRequest[];
  reviewRequested: GiteaPullRequest[];
  statusById?: Record<number, string>;
};

function prCacheKey(baseUrl: string) {
  return `gitea-pr-inbox-cache:${encodeURIComponent(baseUrl)}`;
}

function prCacheTimeKey(baseUrl: string) {
  return `gitea-pr-inbox-cache-time:${encodeURIComponent(baseUrl)}`;
}

async function loadCachedInbox(baseUrl: string) {
  const [raw, rawTime] = await Promise.all([
    LocalStorage.getItem<string>(prCacheKey(baseUrl)),
    LocalStorage.getItem<string>(prCacheTimeKey(baseUrl)),
  ]);

  if (!raw || !rawTime) return { payload: null as PullInboxCachePayload | null, timestamp: null as number | null };
  const timestamp = Number(rawTime);
  if (Number.isNaN(timestamp)) return { payload: null, timestamp: null };

  try {
    const payload = JSON.parse(raw) as PullInboxCachePayload;
    if (!payload || !Array.isArray(payload.created) || !Array.isArray(payload.reviewRequested)) {
      return { payload: null, timestamp: null };
    }
    return { payload, timestamp };
  } catch {
    return { payload: null, timestamp: null };
  }
}

async function saveCachedInbox(baseUrl: string, payload: PullInboxCachePayload) {
  await Promise.all([
    LocalStorage.setItem(prCacheKey(baseUrl), JSON.stringify(payload)),
    LocalStorage.setItem(prCacheTimeKey(baseUrl), String(Date.now())),
  ]);
}

async function clearCachedInbox(baseUrl: string) {
  await Promise.all([LocalStorage.removeItem(prCacheKey(baseUrl)), LocalStorage.removeItem(prCacheTimeKey(baseUrl))]);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]!, idx);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

type PullInboxDebug = {
  startedAt: string;
  finishedAt?: string;
  baseUrl: string;
  usedGlobalEndpoints?: boolean;
  fallbackUsed?: boolean;
  createdUrl: string;
  reviewRequestedUrl: string;
  createdCount?: number;
  reviewRequestedCount?: number;
  currentUser?: { login: string } | null;
  repoCount?: number;
  perRepoFailures?: number;
  errors: Array<Record<string, unknown>>;
};

async function fetchPullRequestInbox(baseUrl: string, accessToken: string, debugEnabled: boolean) {
  const apiBase = normalizeBaseUrl(baseUrl);
  const createdUrl = `${apiBase}/api/v1/pulls/created?state=open`;
  const reviewRequestedUrl = `${apiBase}/api/v1/pulls/requested_review?state=open`;
  const dbg: PullInboxDebug = {
    startedAt: nowIso(),
    baseUrl: apiBase,
    createdUrl,
    reviewRequestedUrl,
    errors: [],
  };

  if (debugEnabled) {
    console.log(`[gitea-pull-requests] start ${dbg.startedAt}`);
    console.log(`[gitea-pull-requests] baseUrl=${apiBase}`);
    console.log(`[gitea-pull-requests] createdUrl=${createdUrl}`);
    console.log(`[gitea-pull-requests] reviewRequestedUrl=${reviewRequestedUrl}`);
  }

  const settled = await Promise.allSettled([
    fetchPaged<GiteaPullRequest>(createdUrl, accessToken),
    fetchPaged<GiteaPullRequest>(reviewRequestedUrl, accessToken),
  ]);

  const createdResult = settled[0];
  const reviewResult = settled[1];

  const any404 =
    (createdResult.status === "rejected" &&
      createdResult.reason instanceof GiteaApiError &&
      createdResult.reason.status === 404) ||
    (reviewResult.status === "rejected" &&
      reviewResult.reason instanceof GiteaApiError &&
      reviewResult.reason.status === 404);

  // Prefer global endpoints when supported.
  if (!any404) {
    dbg.usedGlobalEndpoints = true;
    dbg.fallbackUsed = false;
    if (createdResult.status === "rejected") {
      dbg.errors.push({ stage: "global_created", ...toDebugError(createdResult.reason) });
      throw Object.assign(createdResult.reason, { __debug: dbg });
    }
    if (reviewResult.status === "rejected") {
      dbg.errors.push({ stage: "global_review_requested", ...toDebugError(reviewResult.reason) });
      throw Object.assign(reviewResult.reason, { __debug: dbg });
    }
    dbg.createdCount = createdResult.value.length;
    dbg.reviewRequestedCount = reviewResult.value.length;
    dbg.finishedAt = nowIso();
    if (debugEnabled) {
      console.log(
        `[gitea-pull-requests] global ok created=${dbg.createdCount} reviewRequested=${dbg.reviewRequestedCount}`,
      );
      console.log(`[gitea-pull-requests] done ${dbg.finishedAt}`);
    }
    return { created: createdResult.value, reviewRequested: reviewResult.value, debug: dbg };
  }

  // Fallback: scan visible repos and split by author / requested reviewers.
  dbg.usedGlobalEndpoints = false;
  dbg.fallbackUsed = true;
  if (createdResult.status === "rejected") {
    dbg.errors.push({ stage: "global_created", ...toDebugError(createdResult.reason) });
  }
  if (reviewResult.status === "rejected") {
    dbg.errors.push({ stage: "global_review_requested", ...toDebugError(reviewResult.reason) });
  }

  const currentUser = await fetchCurrentUser(baseUrl, accessToken);
  if (!currentUser) {
    dbg.errors.push({ stage: "current_user", type: "Error", message: "Could not determine current user." });
    throw Object.assign(new Error("Could not determine current user. Check your access token."), { __debug: dbg });
  }
  dbg.currentUser = { login: currentUser.login };

  const repos = await fetchAllRepos(baseUrl, accessToken);
  dbg.repoCount = repos.length;
  let perRepoFailures = 0;

  const perRepo = await mapWithConcurrency(repos, 6, async (repo) => {
    const [owner, name] = repo.full_name.split("/");
    if (!owner || !name) {
      return { created: [] as GiteaPullRequest[], reviewRequested: [] as GiteaPullRequest[] };
    }

    const pullsUrl = `${apiBase}/api/v1/repos/${owner}/${name}/pulls?state=open`;
    try {
      const pulls = await fetchPaged<GiteaPullRequest>(pullsUrl, accessToken);
      const created = pulls.filter((pr) => pr.user?.login === currentUser.login);
      const reviewRequested = pulls.filter((pr) => pr.requested_reviewers?.some((r) => r.login === currentUser.login));
      return { created, reviewRequested };
    } catch (err) {
      // Ignore per-repo errors to keep inbox useful.
      perRepoFailures += 1;
      if (debugEnabled) {
        console.log(`[gitea-pull-requests] repo failed ${repo.full_name}`, toDebugError(err));
      }
      return { created: [] as GiteaPullRequest[], reviewRequested: [] as GiteaPullRequest[] };
    }
  });

  const created = perRepo.flatMap((r) => r.created);
  const reviewRequested = perRepo.flatMap((r) => r.reviewRequested);
  dbg.perRepoFailures = perRepoFailures;
  dbg.createdCount = created.length;
  dbg.reviewRequestedCount = reviewRequested.length;
  dbg.finishedAt = nowIso();
  if (debugEnabled) {
    console.log(
      `[gitea-pull-requests] fallback ok repos=${dbg.repoCount} perRepoFailures=${dbg.perRepoFailures} created=${dbg.createdCount} reviewRequested=${dbg.reviewRequestedCount}`,
    );
    console.log(`[gitea-pull-requests] done ${dbg.finishedAt}`);
  }
  return { created, reviewRequested, debug: dbg };
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const prefBaseUrl = preferences.baseUrl?.trim();
  const prefAccessToken = preferences.accessToken?.trim();
  const cacheTtlMinutes = Number(preferences.cacheTtlMinutes) || 60;
  const debugEnabled = preferences.debug ?? false;

  const [baseUrl, setBaseUrl] = useState<string | undefined>(prefBaseUrl);
  const [accessToken, setAccessToken] = useState<string | undefined>(prefAccessToken);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [createdPulls, setCreatedPulls] = useState<GiteaPullRequest[]>([]);
  const [reviewRequestedPulls, setReviewRequestedPulls] = useState<GiteaPullRequest[]>([]);
  const [statusById, setStatusById] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<PullInboxDebug | null>(null);
  const [lastError, setLastError] = useState<unknown>(null);

  useEffect(() => {
    let isMounted = true;
    loadStoredGiteaSettings()
      .then((stored) => {
        if (!isMounted) return;
        setBaseUrl((current) => current || stored.baseUrl);
        setAccessToken((current) => current || stored.accessToken);
      })
      .finally(() => {
        if (!isMounted) return;
        setSettingsLoaded(true);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const refreshInbox = useCallback(
    async (force = false) => {
      if (!baseUrl || !accessToken) {
        setIsLoading(false);
        return;
      }

      setErrorMessage(null);
      setDebugInfo(null);
      setLastError(null);

      let hasCached = false;
      if (!force) {
        const cached = await loadCachedInbox(baseUrl);
        if (cached.payload) {
          hasCached = true;
          setCreatedPulls(cached.payload.created);
          setReviewRequestedPulls(cached.payload.reviewRequested);
          if (cached.payload.statusById) setStatusById(cached.payload.statusById);

          const isFresh = cached.timestamp && Date.now() - cached.timestamp < cacheTtlMinutes * 60_000;
          if (isFresh) {
            setIsLoading(false);
            return;
          }
        }
      }

      // If we have cached data, keep UI responsive while refreshing in background.
      setIsLoading(!hasCached);

      if (debugEnabled) {
        console.log(
          `[gitea-pull-requests] refresh force=${force} baseUrl=${baseUrl} token=${redactToken(accessToken)}`,
        );
      }

      try {
        const { created, reviewRequested, debug } = await fetchPullRequestInbox(baseUrl, accessToken, debugEnabled);
        setCreatedPulls(created);
        setReviewRequestedPulls(reviewRequested);
        setDebugInfo(debug);
        // Cache PR lists; check-status cache is updated separately when statuses load.
        await saveCachedInbox(baseUrl, { created, reviewRequested });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load pull request inbox.";
        setErrorMessage(message);
        setLastError(error);
        const maybeDebug = (error as { __debug?: PullInboxDebug } | null | undefined)?.__debug;
        if (maybeDebug) setDebugInfo(maybeDebug);
        await showToast({ style: Toast.Style.Failure, title: "Gitea error", message });
      } finally {
        setIsLoading(false);
      }
    },
    [accessToken, baseUrl, cacheTtlMinutes, debugEnabled],
  );

  useEffect(() => {
    if (!settingsLoaded) return;
    if (!isValidBaseUrl(baseUrl) || !accessToken) {
      setIsLoading(false);
      return;
    }
    refreshInbox(false);
  }, [accessToken, baseUrl, refreshInbox, settingsLoaded]);

  const hasValidBaseUrl = isValidBaseUrl(baseUrl);
  const hasAccessToken = Boolean(accessToken);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (!isValidBaseUrl(baseUrl) || !accessToken) return;

    const all = [...createdPulls, ...reviewRequestedPulls] as GiteaPullRequestWithRepo[];
    if (all.length === 0) {
      setStatusById({});
      return;
    }

    let isMounted = true;

    Promise.all(
      all.map(async (pull) => {
        const sha = pull.head?.sha;
        const repo = getRepoOwnerAndName(pull);
        if (!sha || !repo) return { id: pull.id, state: "unknown" };
        try {
          const state = await fetchCommitStatus(baseUrl!, repo.owner, repo.name, sha, accessToken);
          return { id: pull.id, state: state ?? "unknown" };
        } catch {
          return { id: pull.id, state: "unknown" };
        }
      }),
    ).then((results) => {
      if (!isMounted) return;
      const next: Record<number, string> = {};
      for (const r of results) next[r.id] = r.state;
      setStatusById(next);
      if (baseUrl) {
        loadCachedInbox(baseUrl)
          .then((cached) => {
            if (!cached.payload) return;
            return saveCachedInbox(baseUrl, { ...cached.payload, statusById: next });
          })
          .catch(() => undefined);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [accessToken, baseUrl, createdPulls, reviewRequestedPulls, settingsLoaded]);

  const { createdFiltered, reviewRequestedFiltered } = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const matches = (pr: GiteaPullRequestWithRepo) => {
      if (!query) return true;
      const repoFullName = getPullRepoFullName(pr) ?? "";
      const haystack = `${repoFullName} ${pr.title} ${pr.number} ${pr.user?.login ?? ""}`.toLowerCase();
      return haystack.includes(query);
    };

    const created = createdPulls.filter((pr) => matches(pr as GiteaPullRequestWithRepo)).sort(sortByUpdatedAtDesc);
    const reviewRequested = reviewRequestedPulls
      .filter((pr) => matches(pr as GiteaPullRequestWithRepo))
      .sort(sortByUpdatedAtDesc);
    return { createdFiltered: created, reviewRequestedFiltered: reviewRequested };
  }, [createdPulls, reviewRequestedPulls, searchText]);

  if (!settingsLoaded) {
    return <List isLoading />;
  }

  if (!hasValidBaseUrl || !hasAccessToken) {
    return (
      <GiteaSetupForm
        requireToken
        onSaved={(next) => {
          setBaseUrl(next.baseUrl);
          setAccessToken(next.accessToken);
        }}
        onCancel={() => {
          // keep showing setup; no-op for now
        }}
      />
    );
  }

  const totalCount = createdFiltered.length + reviewRequestedFiltered.length;
  const debugMarkdown =
    debugInfo || debugEnabled
      ? [
          "# Debug Info",
          "",
          `- time: ${nowIso()}`,
          `- baseUrl: ${baseUrl ?? "(empty)"}`,
          `- accessToken: ${redactToken(accessToken)}`,
          "",
          "## Fetch",
          debugInfo
            ? [
                `- startedAt: ${debugInfo.startedAt}`,
                `- finishedAt: ${debugInfo.finishedAt ?? "(not finished)"}`,
                `- usedGlobalEndpoints: ${String(debugInfo.usedGlobalEndpoints ?? "(unknown)")}`,
                `- fallbackUsed: ${String(debugInfo.fallbackUsed ?? "(unknown)")}`,
                `- createdUrl: ${debugInfo.createdUrl}`,
                `- reviewRequestedUrl: ${debugInfo.reviewRequestedUrl}`,
                `- createdCount: ${String(debugInfo.createdCount ?? "(unknown)")}`,
                `- reviewRequestedCount: ${String(debugInfo.reviewRequestedCount ?? "(unknown)")}`,
                `- currentUser: ${debugInfo.currentUser?.login ?? "(unknown)"}`,
                `- repoCount: ${String(debugInfo.repoCount ?? "(n/a)")}`,
                `- perRepoFailures: ${String(debugInfo.perRepoFailures ?? "(n/a)")}`,
                "",
                "## Errors",
                debugInfo.errors.length
                  ? "```json\n" + JSON.stringify(debugInfo.errors, null, 2) + "\n```"
                  : "- (none)",
              ].join("\n")
            : "- (no debug data yet)",
          "",
          "## Last Error",
          lastError ? "```json\n" + JSON.stringify(toDebugError(lastError), null, 2) + "\n```" : "- (none)",
        ].join("\n")
      : null;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search open pull requests"
      onSearchTextChange={setSearchText}
      filtering={false}
      throttle
    >
      {errorMessage ? (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Could not load pull requests"
          description={truncate(errorMessage)}
        />
      ) : null}

      {!isLoading && !errorMessage && totalCount === 0 ? (
        <List.EmptyView icon={Icon.MagnifyingGlass} title="No matching open pull requests" />
      ) : null}

      <List.Section title="Created by Me" subtitle={`${createdFiltered.length} open`}>
        {createdFiltered.map((pull) => {
          const status = pull.draft ? "Draft" : pull.state;
          const checks = formatStatus(statusById[pull.id]);

          return (
            <List.Item
              key={`created-${pull.id}`}
              title={`#${pull.number} ${pull.title}`}
              subtitle={`${status ? `${status} • ` : ""}${checks}`}
              icon={Icon.ArrowRightCircle}
              accessories={pull.draft ? [{ tag: "Draft" }] : undefined}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser title="Open Pull Request" url={pull.html_url} />
                  <Action.CopyToClipboard title="Copy Pull Request URL" content={pull.html_url} />
                  <ActionPanel.Section title="Cache">
                    <Action
                      title="Refresh Pull Requests"
                      icon={Icon.ArrowClockwise}
                      onAction={() => refreshInbox(true)}
                    />
                    <Action
                      title="Clear Pull Request Cache"
                      icon={Icon.Trash}
                      onAction={async () => {
                        if (!baseUrl) return;
                        await clearCachedInbox(baseUrl);
                        await showToast({ style: Toast.Style.Success, title: "Pull request cache cleared" });
                        await refreshInbox(true);
                      }}
                    />
                  </ActionPanel.Section>
                  {debugEnabled && debugMarkdown ? (
                    <ActionPanel.Section title="Debug">
                      <Action.Push
                        title="Show Debug Info"
                        icon={Icon.Terminal}
                        target={<Detail markdown={debugMarkdown} />}
                      />
                      <Action.CopyToClipboard title="Copy Debug Info" content={debugMarkdown} />
                    </ActionPanel.Section>
                  ) : null}
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>

      <List.Section title="Review Requested" subtitle={`${reviewRequestedFiltered.length} open`}>
        {reviewRequestedFiltered.map((pull) => {
          const status = pull.draft ? "Draft" : pull.state;
          const checks = formatStatus(statusById[pull.id]);

          return (
            <List.Item
              key={`review-${pull.id}`}
              title={`#${pull.number} ${pull.title}`}
              subtitle={`${status ? `${status} • ` : ""}${checks}`}
              icon={Icon.ArrowRightCircle}
              accessories={pull.draft ? [{ tag: "Draft" }] : undefined}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser title="Open Pull Request" url={pull.html_url} />
                  <Action.CopyToClipboard title="Copy Pull Request URL" content={pull.html_url} />
                  <ActionPanel.Section title="Cache">
                    <Action
                      title="Refresh Pull Requests"
                      icon={Icon.ArrowClockwise}
                      onAction={() => refreshInbox(true)}
                    />
                    <Action
                      title="Clear Pull Request Cache"
                      icon={Icon.Trash}
                      onAction={async () => {
                        if (!baseUrl) return;
                        await clearCachedInbox(baseUrl);
                        await showToast({ style: Toast.Style.Success, title: "Pull request cache cleared" });
                        await refreshInbox(true);
                      }}
                    />
                  </ActionPanel.Section>
                  {debugEnabled && debugMarkdown ? (
                    <ActionPanel.Section title="Debug">
                      <Action.Push
                        title="Show Debug Info"
                        icon={Icon.Terminal}
                        target={<Detail markdown={debugMarkdown} />}
                      />
                      <Action.CopyToClipboard title="Copy Debug Info" content={debugMarkdown} />
                    </ActionPanel.Section>
                  ) : null}
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}
