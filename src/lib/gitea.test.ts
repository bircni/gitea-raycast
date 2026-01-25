import { describe, expect, it } from "vitest";
import { buildRepoUrl, formatStatus, isValidBaseUrl, normalizeBaseUrl, truncate, type GiteaRepo } from "./gitea";

describe("gitea helpers", () => {
  it("normalizes base URLs", () => {
    expect(normalizeBaseUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeBaseUrl("https://example.com////")).toBe("https://example.com");
  });

  it("builds repo URLs with or without suffix", () => {
    const repo: GiteaRepo = {
      id: 1,
      full_name: "owner/repo",
      html_url: "https://gitea.example.com/owner/repo",
    };
    expect(buildRepoUrl("https://gitea.example.com", repo)).toBe("https://gitea.example.com/owner/repo");
    expect(buildRepoUrl("https://gitea.example.com", repo, "issues")).toBe(
      "https://gitea.example.com/owner/repo/issues",
    );
  });

  it("truncates long text", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("long-text", 5)).toBe("long…");
  });

  it("validates base URLs", () => {
    expect(isValidBaseUrl("https://gitea.example.com")).toBe(true);
    expect(isValidBaseUrl("http://localhost:3000")).toBe(true);
    expect(isValidBaseUrl("ftp://example.com")).toBe(false);
    expect(isValidBaseUrl("not-a-url")).toBe(false);
  });

  it("formats check statuses", () => {
    expect(formatStatus("success")).toBe("✅ checks passed");
    expect(formatStatus("failure")).toBe("❌ checks failed");
    expect(formatStatus("pending")).toBe("⏳ checks pending");
    expect(formatStatus("error")).toBe("⚠️ checks error");
    expect(formatStatus("unknown")).toBe("⚪ checks unknown");
  });
});
