# Gitea for Raycast

Browse your Gitea repositories directly from Raycast. Search repos, drill into sections, and list open issues, pull requests (with check status), and releases.

## Features

- Fast repository search with usage-based ranking
- Repo sections: Code, Issues, Pull Requests, Releases, Wiki, Projects, Settings
- Lists open issues and pull requests with author + last update
- Pull requests show combined check status (✅/❌/⏳)
- Release list with tag/name and published date
- Optional access token for private repos
- Caching to keep results snappy

## Requirements

- Raycast (Windows or macOS)
- A reachable Gitea instance (e.g. `http://localhost:3000`)
- A personal access token with read access

## Installation

1. Clone this repo.
2. Run:

```bash
   npm install
   npm run dev
```

3. In Raycast, enable the extension.

## Configuration

Open Raycast → **Extensions** → **Gitea** → **Preferences** and set:

- **Gitea Base URL**: e.g. `https://gitea.example.com` or `http://localhost:3000`
- **Access Token**: needed for private repositories
- **Cache TTL (minutes)**: how long to cache repo results
- **Quick Open Repository**: skip section picker when opening repos

## Usage

Run the command:

- **Gitea Repositories**
- **Gitea Pull Requests** (shows open PRs you created and open PRs where review is requested)

From a repository:

- **Issues** → list open issues
- **Pull Requests** → list open PRs + check status
- **Releases** → list releases
- **Code / Wiki / Projects / Settings** → open directly in browser

## Troubleshooting

- **Invalid URL**: ensure the base URL includes protocol, e.g. `http://` or `https://`.
- **No private repos**: add a personal access token in preferences.
- **PR inbox empty / errors**: ensure your access token can read pull requests (and that your Gitea version supports the required endpoints; the extension will fall back to scanning repos if needed).
- **Missing data**: use “Refresh Repositories” or increase cache TTL.

## Development

```bash
npm run lint
npm run test
npm run dev
```

## License

MIT
