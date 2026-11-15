# AgentBase privacy

Last updated: 15 November 2026

AgentBase's project store and MCP server run locally. Project records, saved analyses, and imported dataset snapshots are stored in a folder on your device. AgentBase does not operate a hosted project-data service.

The macOS Inspector can read the local project store and local Codex and Claude Code connection settings to show their status. You choose the projects and files used with AgentBase.

## Optional AI judge

If you configure **Your AI** and press **Judge**, the Inspector sends the criteria, reference context, and submission shown in the judge window to the HTTPS endpoint you selected. These fields may contain task content or personal information you entered. The request also includes your provider API key for authentication. If you save the key, AgentBase stores it in macOS Keychain.

The provider processes the request under its own privacy terms, which may include retention of submitted content. Review the fields and the provider's terms before using Judge. AgentBase does not control the provider's handling of a request.

If you use AgentBase through a separate coding agent such as Codex or Claude Code, that agent and its provider handle information under their own settings and privacy terms.

## Retention and control

AgentBase retains local records until you delete them through its controls or remove the data folder. Backups you create are separate readable copies that you manage. AgentBase does not make automatic backups. Removing a local record does not erase copies already sent to an AI provider or included in a backup.

For privacy questions, contact [sppreus@gmail.com](mailto:sppreus@gmail.com).
