import { Action, ActionPanel, Detail, Form, Icon } from "@raycast/api";
import { useEffect, useState } from "react";
import { clearStoredGiteaSettings, loadStoredGiteaSettings, saveStoredGiteaSettings } from "./gitea-settings";

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

  useEffect(() => {
    loadStoredGiteaSettings()
      .then((stored) => {
        setBaseUrl(stored.baseUrl ?? "");
        setAccessToken(stored.accessToken ?? "");
      })
      .finally(() => setIsLoading(false));
  }, []);

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
        onChange={setBaseUrl}
      />
      <Form.PasswordField
        id="accessToken"
        title="Access Token"
        placeholder={requireToken ? "Required for this command" : "Optional (for private repositories)"}
        value={accessToken}
        onChange={setAccessToken}
      />
    </Form>
  );
}
