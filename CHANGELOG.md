# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.1.7](https://github.com/bmesquitadev/opencode-opencron/compare/v0.1.6...v0.1.7) (2026-05-25)


### Bug Fixes

* restore notification UI across dashboard, task/template forms and improve test UX ([73c4344](https://github.com/bmesquitadev/opencode-opencron/commit/73c4344ec874e8cdc36dd406bab859dc28335e8d))

## [0.1.6](https://github.com/bmesquitadev/opencode-opencron/compare/v0.1.5...v0.1.6) (2026-05-25)


### Bug Fixes

* prevent auto-refresh from clearing unsaved form data ([83b0a38](https://github.com/bmesquitadev/opencode-opencron/commit/83b0a3858122cd2703b1be66fa30cd218743282a))
* auto-refresh skips when input/textarea/select has focus (activeElement check)
* auto-refresh skips on form pages (/new, /system, /notifications)
* auto-refresh skips when modal dialog is open

### Features

* i18n support with locale files (en, pt-BR) and client-side translation helpers
* translated all dashboard UI strings (navigation, buttons, alerts, status labels)

## [0.1.5](https://github.com/bmesquitadev/opencode-opencron/compare/v0.1.4...v0.1.5) (2026-05-25)


### Features

* add notification channels and auto-refresh dashboard ([17f3768](https://github.com/bmesquitadev/opencode-opencron/commit/17f376866aa6dbf0bb0246835dc3150d6be18932))
* notifications: 5 channels — Telegram, Discord, Slack, Email, Webhook
* notifications: per-task channel configuration (custom or all channels)
* notifications: test button per channel with real message delivery
* notifications: setup guides inline per channel (Token/Chat ID, Webhook URL, SMTP)
* notifications: automatic notifications on task completion and failure
* notifications: notification tab on dashboard with channel management UI
* dashboard: smart auto-refresh via fetch + DOMParser + DOM replacement (no full page flash)
* dashboard: auto-refresh toggle with configurable interval (5s/10s/30s/60s)
* dashboard: auto-refresh preference persisted in localStorage
* dashboard: auto-refresh skips when modal dialog is open (no data loss)
* dashboard: actions (Retry, Delete, Enable, Disable, Trigger, Clear) use smart refresh instead of full page reload
* dashboard: smart refresh preserves scroll position across updates

## [0.1.4](https://github.com/bmesquitadev/opencode-opencron/compare/v0.1.3...v0.1.4) (2026-05-25)


### Features

* dashboard task editing, template editing, and task cloning ([659e6b9](https://github.com/bmesquitadev/opencode-opencron/commit/659e6b910e78a7e0cde0de1997add4e5630ce26e))

## [0.1.3](https://github.com/bmesquitadev/opencode-opencron/compare/v0.1.2...v0.1.3) (2026-05-25)


### Features

* add token usage and cost tracking with time-range dashboard filter ([742ad2e](https://github.com/bmesquitadev/opencode-opencron/commit/742ad2e1acd5914042d43445ed2a8af2f1fceab1))
* extract and persist tools/skills used per run (tools_used, skills_used columns)
* centralize agent/model/config resolution in opencode-config module
* gateway: auto port fallback when 4680 is in use (scans 4680-4779)
* dashboard: time range filter (24h/7d/30d/All) on Task Queue and Execution Logs
* dashboard: cards for Total Cost, Total Tokens, Done, Failed (filtered by period)
* dashboard: Tokens and Cost columns in runs table
* dashboard: session view with tokens/cost in info bar
* worker: extract token usage (input/output/total) and cost from SDK response
* backfill script for existing records

## [0.1.2](https://github.com/bmesquitadev/opencode-opencron/compare/v0.1.1...v0.1.2) (2026-05-24)


### Features

* dashboard task creation form with scheduling and session conversation view ([d995d1c](https://github.com/bmesquitadev/opencode-opencron/commit/d995d1c5c6eb8d9394d0160cc8006b117ed43aac))

## 0.1.1 (2026-05-24)


### Features

* replace process spawn with OpenCode SDK for headless task execution ([1e3b5e9](https://github.com/bmesquitadev/opencode-opencron/commit/1e3b5e996b97a82402272ace012ea6407338841c))
