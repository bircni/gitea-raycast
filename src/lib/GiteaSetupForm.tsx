import { Action, ActionPanel, Detail, Form, Icon, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import { clearStoredGiteaSettings, loadStoredGiteaSettings, saveStoredGiteaSettings } from "./gitea-settings";

function isValidUrl(urlString: string): boolean {
  if (!urlString) return false;
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function GiteaSetupForm({
  requireToken,
  onSaved,
  onCancel,
}: {
  requireToken: boolean;
  onSaved: (settings: { baseUrl: string; accessToken?: string }) => void;
  onCancel?: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [baseUrlError, setBaseUrlError] = useState<string | undefined>();
  const [tokenError, setTokenError] = useState<string | undefined>();

  useEffect(() => {
    loadStoredGiteaSettings()
      .then((stored) => {
        setBaseUrl(stored.baseUrl ?? "");
        setAccessToken(stored.accessToken ?? "");
      })
      .finally(() => setIsLoading(false));
  }, []);

  const validateBaseUrl = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setBaseUrlError("Base URL is required");
      return false;
    }
    if (!isValidUrl(trimmed)) {
      setBaseUrlError("Must be a valid URL (e.g., https://gitea.example.com)");
      return false;
    }
    setBaseUrlError(undefined);
    return true;
  };

  const validateToken = (value: string) => {
    if (requireToken && !value.trim()) {
      setTokenError("Access token is required for this command");
      return false;
    }
    setTokenError(undefined);
    return true;
  };

  return (
    <Form
      isLoading={isLoading}
      navigationTitle="Set up Gitea"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={requireToken ? "Save Base URL and Token" : "Save Base URL"}
            icon={Icon.Check}
            onSubmit={async () => {
              const cleanedBaseUrl = baseUrl.trim();
              const cleanedToken = accessToken.trim();

              const urlValid = validateBaseUrl(cleanedBaseUrl);
              const tokenValid = validateToken(cleanedToken);

              if (!urlValid || !tokenValid) {
                await showToast({ style: Toast.Style.Failure, title: "Please fix the errors above" });
                return;
              }

              await saveStoredGiteaSettings({ baseUrl: cleanedBaseUrl, accessToken: cleanedToken });
              onSaved({ baseUrl: cleanedBaseUrl, accessToken: cleanedToken || undefined });
            }}
          />
          <ActionPanel.Section title="Other">
            <Action
              title="Clear Saved Settings"
              icon={Icon.Trash}
              onAction={async () => {
                await clearStoredGiteaSettings();
                setBaseUrl("");
                setAccessToken("");
                setBaseUrlError(undefined);
                setTokenError(undefined);
              }}
            />
            {onCancel ? <Action title="Cancel" icon={Icon.XMarkCircle} onAction={onCancel} /> : null}
            <Action.Push
              title="Why a Setup Screen?"
              icon={Icon.QuestionMarkCircle}
              target={
                <Detail
                  markdown={[
                    "# Setup Screen",
                    "",
                    "Raycast command preferences are not editable programmatically.",
                    "This form stores your Base URL and token in the extension’s local storage so commands can prompt you on first run and reuse credentials.",
                    "",
                    "If you prefer, you can still set Base URL / token in the extension preferences instead.",
                  ].join("\n")}
                />
              }
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    >
      <Form.Description text="Enter your Gitea instance details. These will be reused by all commands." />
      <Form.TextField
        id="baseUrl"
        title="Gitea Base URL"
        placeholder="https://gitea.example.com"
        value={baseUrl}
        error={baseUrlError}
        onChange={(value) => {
          setBaseUrl(value);
          if (baseUrlError) validateBaseUrl(value);
        }}
        onBlur={(e) => {
          const target = e.target as HTMLInputElement | null;
          if (target?.value) validateBaseUrl(target.value);
        }}
      />
      <Form.PasswordField
        id="accessToken"
        title="Access Token"
        placeholder={requireToken ? "Required for this command" : "Optional (for private repositories)"}
        value={accessToken}
        error={tokenError}
        onChange={(value) => {
          setAccessToken(value);
          if (tokenError) validateToken(value);
        }}
        onBlur={(e) => {
          if (requireToken) {
            const target = e.target as HTMLInputElement | null;
            validateToken(target?.value ?? "");
          }
        }}
      />
    </Form>
  );
}
