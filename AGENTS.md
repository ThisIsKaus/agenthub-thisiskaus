<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## machine/ deletions are blocked in CI

A workflow refuses any push that deletes a file under `machine/`, or that leaves fewer than
60 tracked files there. That directory is Python, zsh and launchd maintained outside Lovable;
you cannot edit it productively and have no reason to remove any of it. If a publish appears
to need a deletion there, the editor snapshot is stale — pull before publishing rather than
committing a tree that is missing files it never knew about.

Before publishing, pull. The repository has two authors.
