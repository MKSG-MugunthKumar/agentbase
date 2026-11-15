# AgentBase

[![Latest release](https://img.shields.io/github/v/release/SeanPreusse/agentbase?label=release)](https://github.com/SeanPreusse/agentbase/releases/latest) [![Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**Open-source project memory for coding agents.** Keep tasks, decisions, evidence, and handoffs in a local database that Codex and Claude Code can use through MCP. Explore and correct that context in the desktop app.

[Download for Windows](https://github.com/SeanPreusse/agentbase/releases/latest/download/AgentBase-0.7.6-windows-x64.zip) · [Download for macOS](https://github.com/SeanPreusse/agentbase/releases/latest/download/AgentBase-0.7.6-macos-arm64.pkg) · [See all releases](https://github.com/SeanPreusse/agentbase/releases/latest)

![AgentBase graph and task board](docs/screenshots/showcase.gif)

## Ask about your project

![Example questions you can ask AgentBase](docs/agentbase-question-guide.png)

[More example questions](Questions.md)

## Get started

| Desktop app | Download and open |
| --- | --- |
| Windows 10/11, x64 | Extract the [Windows ZIP](https://github.com/SeanPreusse/agentbase/releases/latest/download/AgentBase-0.7.6-windows-x64.zip) and run `AgentBase.exe`. |
| macOS 14+, Apple silicon | Open the [Mac installer](https://github.com/SeanPreusse/agentbase/releases/latest/download/AgentBase-0.7.6-macos-arm64.pkg), or download the [app ZIP](https://github.com/SeanPreusse/agentbase/releases/latest/download/AgentBase-0.7.6-macos-arm64.zip). |

The desktop bundles include Node.js and the AgentBase runtime. They are awaiting store signing and Apple notarization, so your operating system may ask you to approve opening them.

To connect **Codex**, install the plugin from source with Node.js 22.22+:

```sh
git clone https://github.com/SeanPreusse/agentbase.git
cd agentbase
npm ci
npm run plugin:up
```

For **Claude Code**, build the same checkout with `npm run build`, then use the macOS app’s **Connections** view to install its MCP server, or configure Claude Code to run `node bin/agentbase.mjs serve` from the checkout. Restart the agent session, then ask it to resume your workspace or track a task. Point both agents at the same local data folder to share context (default: `~/.local/share/agentbase`).

## What you can do

- **Pick up where you left off:** Find linked tasks, plans, sources, decisions, and handoffs across sessions.
- **Inspect and correct memory:** Review the graph and task board, then supersede or forget records.
- **Analyse project data:** Import CSV, JSON, JSONL, or Parquet and run sandboxed SQL with saved queries and provenance.
- **Keep it portable:** Back up project records and imported data together.

Project data stays local. AgentBase has no hosted project-data service or silent conversation collection. Optional **Your AI** sends only the material you select to your configured provider when you press **Judge**. Read the [privacy policy](PRIVACY.md).

## Contribute

Issues and pull requests are welcome. See [contributing](CONTRIBUTING.md) for setup and checks. AgentBase is licensed under [Apache 2.0](LICENSE).
