import { LocalStorage } from "@raycast/api";

const BASE_URL_KEY = "gitea-base-url";
const ACCESS_TOKEN_KEY = "gitea-access-token";

export type StoredGiteaSettings = {
  baseUrl?: string;
  accessToken?: string;
};

export async function loadStoredGiteaSettings(): Promise<StoredGiteaSettings> {
  const [baseUrl, accessToken] = await Promise.all([
    LocalStorage.getItem<string>(BASE_URL_KEY),
    LocalStorage.getItem<string>(ACCESS_TOKEN_KEY),
  ]);
  return {
    baseUrl: typeof baseUrl === "string" ? baseUrl : undefined,
    accessToken: typeof accessToken === "string" ? accessToken : undefined,
  };
}

export async function saveStoredGiteaSettings(next: StoredGiteaSettings) {
  const baseUrl = next.baseUrl?.trim() ?? "";
  const accessToken = next.accessToken?.trim() ?? "";

  await Promise.all([LocalStorage.setItem(BASE_URL_KEY, baseUrl), LocalStorage.setItem(ACCESS_TOKEN_KEY, accessToken)]);
}

export async function clearStoredGiteaSettings() {
  await Promise.all([LocalStorage.removeItem(BASE_URL_KEY), LocalStorage.removeItem(ACCESS_TOKEN_KEY)]);
}
