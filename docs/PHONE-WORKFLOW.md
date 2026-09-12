# Kevin's phone workflow

## Use this app

Open [FamilyHub](https://vdskevin009.github.io/familyhub/) in your phone browser. Bookmark it or use Add to Home Screen. FamilyHub data, DevFlow drafts and saved scenarios are specific to the browser/device; they do not sync automatically.

## One-time Codex cloud setup

1. Open [Codex cloud](https://chatgpt.com/codex) in your phone browser and sign in to the ChatGPT account you already use. If your mobile app offers the same cloud surface, you can use it; the browser is the documented fallback. Availability depends on account access. Installing desktop Codex alone does not configure cloud environments.
2. Connect GitHub and allow access to **vdskevin009/familyhub**. If the repository is missing, update the GitHub connection's selected repositories. Do not create or paste a personal access token into a chat.
3. In environment settings, create an environment for this repository. Set the setup script to `bash scripts/setup.sh`. Make `$HOME/.dotnet` available on PATH for task commands, or ask Codex to invoke `$HOME/.dotnet/dotnet`. Dependency restore needs the official Microsoft download and NuGet endpoints during setup.
4. Select that environment and start a cloud task. Cloud work runs independently of this Windows computer. This setup requires your account session and is not automatically completed by publishing the repository.

These steps follow [official Codex cloud documentation](https://learn.chatgpt.com/docs/cloud): connect GitHub, create an environment, start a task, inspect the result and open a PR. The exact menus may vary with the current mobile UI.

## Request a change

Copy this into a new Codex cloud task for this repository:

> In vdskevin009/familyhub, read AGENTS.md and implement [describe the change]. Keep the app compatible with GitHub Pages, existing local data and phones. Work on a feature branch. Run the domain test harness and release publish. Open a PR describing the behavior, checks and limitations. Do not merge or add paid services.

Use ordinary ChatGPT to refine the idea if helpful, then submit the implementation request in the repository's Codex cloud environment. A normal chat without that environment is not guaranteed to have repository write access.

## Review, merge, deploy

1. Open the PR link in GitHub Mobile or your phone browser. Read the summary and changed files. Ask Codex for revisions in its cloud task if needed.
2. Check that **Build, test and deploy / build** is green for the latest commit. If it is red, ask Codex to fix the failing job and wait for the new check.
3. Review the behavior and select **Squash and merge**, then confirm. If the mobile app does not expose the needed control, use GitHub in the browser.
4. Open [Actions](https://github.com/vdskevin009/familyhub/actions). The main-branch run performs checks and then deploys. Wait for the deploy job to succeed.
5. Open the app URL. Close older app tabs and reopen if a cached PWA version is still showing.

## Redeploy or recover

To redeploy unchanged code, use Actions → Build, test and deploy → Run workflow, select main, and run. For a broken change, ask Codex to open a revert PR; review and merge it through the same checks. Never delete family backups to fix a deployment.

## Costs and boundaries

Hosting uses free public GitHub Pages and standard public-repository Actions runners. Codex cloud uses your account's existing access/usage allowance; this project does not purchase credits. No paid infrastructure was configured. Source code and the hosted shell are public. Do not place private records, secrets or tokens in issues, PRs, source files or AI prompts.
