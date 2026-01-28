import { normalizeBaseUrl, type GiteaRepo } from "./gitea";

export const PER_PAGE = 100;

export class GiteaApiError extends Error {
  status: number;
  url?: string;

  constructor(status: number, message: string, url?: string) {
    super(message);
    this.name = "GiteaApiError";
    this.status = status;
    this.url = url;
  }
}

export interface GiteaAuthenticatedUser {
  id: number;
  login: string;
}

export async function fetchCurrentUser(baseUrl: string, accessToken: string): Promise<GiteaAuthenticatedUser | null> {
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/v1/user`, {
      headers: { Authorization: `token ${accessToken}` },
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as GiteaAuthenticatedUser;
    return data;
  } catch {
    return null;
  }
}

export async function fetchPaged<T>(url: string, accessToken?: string) {
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
      throw new GiteaApiError(
        response.status,
        `Gitea API error (${response.status}): ${message || response.statusText}`,
        apiUrl.toString(),
      );
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

export async function fetchAllRepos(baseUrl: string, accessToken?: string) {
  const repos: GiteaRepo[] = [];
  const seenIds = new Set<number>();

  // Always fetch all accessible repos via search endpoint
  // This includes public repos and repos the user has access to
  let page = 1;
  let prevCount = 0;
  while (true) {
    const url = new URL(`${normalizeBaseUrl(baseUrl)}/api/v1/repos/search`);
    url.searchParams.set("limit", String(PER_PAGE));
    url.searchParams.set("page", String(page));

    const response = await fetch(url.toString(), {
      headers: accessToken ? { Authorization: `token ${accessToken}` } : undefined,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Gitea API error (${response.status}): ${message || response.statusText}`);
    }

    const json = (await response.json()) as { data?: GiteaRepo[]; total_count?: number };
    const data: GiteaRepo[] = Array.isArray(json.data) ? json.data : [];
    const totalCount = json.total_count;

    for (const repo of data) {
      if (!seenIds.has(repo.id)) {
        seenIds.add(repo.id);
        repos.push(repo);
      }
    }

    // Stop if no data returned
    if (data.length === 0) {
      break;
    }

    // Stop if we got all repos according to total_count
    if (typeof totalCount === "number" && repos.length >= totalCount) {
      break;
    }

    // Stop if no new repos were added (we've seen all of them)
    if (repos.length === prevCount) {
      break;
    }
    prevCount = repos.length;

    page += 1;
  }

  // For authenticated users, also fetch private repos the user has access to
  if (accessToken) {
    page = 1;
    while (true) {
      const url = new URL(`${normalizeBaseUrl(baseUrl)}/api/v1/user/repos`);
      url.searchParams.set("limit", String(PER_PAGE));
      url.searchParams.set("page", String(page));

      const response = await fetch(url.toString(), {
        headers: { Authorization: `token ${accessToken}` },
      });

      if (!response.ok) {
        break; // Don't fail if this endpoint fails, we still have search results
      }

      const data = (await response.json()) as GiteaRepo[];

      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      const beforeCount = repos.length;
      for (const repo of data) {
        if (!seenIds.has(repo.id)) {
          seenIds.add(repo.id);
          repos.push(repo);
        }
      }

      // Stop if no new repos were added
      if (repos.length === beforeCount) {
        break;
      }

      page += 1;
    }

    // Fetch ALL organizations (not just ones user is member of)
    try {
      let orgPage = 1;
      const allOrgs: Array<{ username?: string; name?: string }> = [];

      while (true) {
        const orgsResponse = await fetch(`${normalizeBaseUrl(baseUrl)}/api/v1/orgs?limit=${PER_PAGE}&page=${orgPage}`, {
          headers: { Authorization: `token ${accessToken}` },
        });

        if (!orgsResponse.ok) {
          break;
        }

        const orgs = (await orgsResponse.json()) as Array<{ username?: string; name?: string }>;

        if (!Array.isArray(orgs) || orgs.length === 0) {
          break;
        }

        allOrgs.push(...orgs);

        if (orgs.length < PER_PAGE) {
          break;
        }
        orgPage += 1;
      }

      for (const org of allOrgs) {
        const orgName = org.username || org.name;
        if (!orgName) continue;

        let repoPage = 1;
        while (true) {
          const url = new URL(`${normalizeBaseUrl(baseUrl)}/api/v1/orgs/${orgName}/repos`);
          url.searchParams.set("limit", String(PER_PAGE));
          url.searchParams.set("page", String(repoPage));

          const response = await fetch(url.toString(), {
            headers: { Authorization: `token ${accessToken}` },
          });

          if (!response.ok) {
            break;
          }

          const data = (await response.json()) as GiteaRepo[];
          if (!Array.isArray(data) || data.length === 0) {
            break;
          }

          const beforeCount = repos.length;
          for (const repo of data) {
            if (!seenIds.has(repo.id)) {
              seenIds.add(repo.id);
              repos.push(repo);
            }
          }

          // Stop if no new repos were added
          if (repos.length === beforeCount) {
            break;
          }

          repoPage += 1;
        }
      }
    } catch {
      // Ignore org fetch errors, we still have other repos
    }
  }

  return repos;
}

export async function fetchCommitStatus(
  baseUrl: string,
  owner: string,
  name: string,
  sha: string,
  accessToken?: string,
) {
  const statusUrl = `${normalizeBaseUrl(baseUrl)}/api/v1/repos/${owner}/${name}/commits/${sha}/status`;
  const response = await fetch(statusUrl, {
    headers: accessToken ? { Authorization: `token ${accessToken}` } : undefined,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new GiteaApiError(
      response.status,
      `Gitea API error (${response.status}): ${message || response.statusText}`,
      statusUrl,
    );
  }

  const payload = (await response.json()) as { state?: string };
  return payload.state;
}
