# Repository identity

- All GitHub work for this repository must use **TommyAllsup**, never a work account such as `tallsup-jm`.
- Use `git gh <arguments>` (the configured local alias), or `node scripts/gh.mjs <arguments>`. Do not invoke raw `gh` for repository operations. The wrapper selects the stored TommyAllsup credential and verifies its identity before proceeding.
- In linked worktrees whose branch does not yet contain the wrapper script, use `git gh`; the alias points to the main checkout's script.
- Keep repository-local Git author settings as `Tommy Allsup <tommy.allsup@gmail.com>`. Do not override them with a work identity.
- The local Git credential helper pins HTTPS GitHub authentication to TommyAllsup and fails closed if it cannot verify that account. The alias and helper share the repository's common Git config across linked worktrees.
- Do not switch gh's global active account or change global Git identity to service this repository. Raw `gh` is not intercepted; other projects retain their existing global identity.
- Local aliases/helpers are machine configuration, not cloned Git content. If absent or stale after moving the checkout, use the wrapper directly for GitHub commands and restore the local helper before authenticated Git operations. See [agent integration](docs/agent-integration.md#repository-github-identity).
