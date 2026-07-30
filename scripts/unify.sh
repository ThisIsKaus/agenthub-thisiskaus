#!/bin/zsh
#
# unify.sh — make ~/AgentHub and ~/Workspace/machine one tree.
#
# Why: the self-improvement cascade must branch, edit, run verify, and push. Today it can
# only push from ~/Workspace but verify tests ~/AgentHub. A change written in one would not
# be tested by the other, so the loop cannot close. Afterwards the runtime IS the working
# copy: verify tests exactly what the cascade wrote, and one push ships it.
#
# Method: sync AgentHub's newer commits up via git subtree, move the untracked data across,
# then replace ~/AgentHub with a symlink to ~/Workspace/machine. launchd plists use absolute
# paths that resolve through the symlink unchanged.
#
# Reversible: the original is renamed, never deleted. Rollback is printed at the end.
#
#   unify.sh --check    preflight only, change nothing
#   unify.sh --go       perform the unification
#
set -u

AH=~/AgentHub
WS=~/Workspace
WM=$WS/machine
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP=~/AgentHub.pre-unify-$STAMP
MODE=${1:---check}

red()   { print -P "%F{red}$1%f" }
green() { print -P "%F{green}$1%f" }
amber() { print -P "%F{yellow}$1%f" }
info()  { print -P "%F{cyan}$1%f" }

fail=0
check() {
  if eval "$2" >/dev/null 2>&1; then green "  ok    $1"; else red "  FAIL  $1"; fail=1; fi
}

# ----------------------------------------------------------------- preflight
info "PREFLIGHT"

check "on AC power (restic and the move both need it)" \
      "pmset -g batt | grep -q 'AC Power'"
check "~/AgentHub exists and is a real directory" \
      "[[ -d $AH && ! -L $AH ]]"
check "~/Workspace/machine exists" \
      "[[ -d $WM ]]"
check "workspace has a clean tree" \
      "[[ -z \$(git -C $WS status --porcelain) ]]"
check "workspace remote is the workspace repo" \
      "git -C $WS remote get-url origin | grep -q agenthub-thisiskaus"
check "console is responding (proves the runtime works before we touch it)" \
      "curl -sf -m 4 http://127.0.0.1:4100/api/capabilities"

RECENT=$(find ~/AgentHub/logs/backup.log -newermt '-6 hours' 2>/dev/null | wc -l | tr -d ' ')
LASTB=$(tail -1 ~/AgentHub/logs/backup.log 2>/dev/null)
if [[ "$LASTB" == *done* && "$RECENT" == "1" ]]; then
  green "  ok    recent successful backup"
else
  red   "  FAIL  no successful backup in the last 6 hours — this is the rollback, run backup.sh first"
  red   "        last line: ${LASTB:-none}"
  fail=1
fi

echo
info "DIVERGENCE"
AHEAD=$(git -C $AH rev-list --count origin/main..HEAD 2>/dev/null || echo "?")
DIRTY=$(git -C $AH status --porcelain | wc -l | tr -d ' ')
echo "  ~/AgentHub: $AHEAD commit(s) ahead, $DIRTY uncommitted change(s)"
git -C $AH status --short | sed 's/^/    /'

if [[ $fail -eq 1 ]]; then
  echo; red "Preflight failed. Nothing was changed."
  exit 1
fi

echo; green "Preflight passed."

if [[ "$MODE" != "--go" ]]; then
  echo
  info "This was a check only. Re-run with --go to perform the unification."
  echo "  It will:"
  echo "    1. commit outstanding changes in ~/AgentHub"
  echo "    2. git subtree pull them into ~/Workspace/machine and push"
  echo "    3. copy untracked data (kb, vault, logs, state, digests, inbox, drafts, venvs)"
  echo "    4. unload launchd jobs, rename ~/AgentHub to $BACKUP, symlink, reload"
  echo "    5. run verify and report"
  exit 0
fi

# ----------------------------------------------------------------- 1. commit
echo; info "1 · COMMIT OUTSTANDING WORK"
if [[ -n $(git -C $AH status --porcelain) ]]; then
  git -C $AH add -A
  git -C $AH commit -q -m "pre-unification: brief generator, contracts, eval sets, canon" \
    && green "  committed" || red "  commit failed"
else
  green "  nothing to commit"
fi

# ----------------------------------------------------------------- 2. subtree
echo; info "2 · SYNC INTO THE WORKSPACE REPOSITORY"
git -C $WS remote remove machine 2>/dev/null
git -C $WS remote add machine $AH
git -C $WS fetch -q machine main || { red "  fetch failed"; exit 1 }
if git -C $WS subtree pull --prefix=machine machine main -m "sync: machine half from the runtime" -q; then
  green "  subtree pull succeeded"
else
  red "  subtree pull hit a conflict — resolve in ~/Workspace, commit, then re-run with --go"
  exit 1
fi
git -C $WS push -q origin main && green "  pushed to origin/main" || amber "  push failed — resolve before continuing"

# ----------------------------------------------------------------- 3. data
echo; info "3 · MOVE UNTRACKED DATA ACROSS"
for d in kb vault logs state digests inbox drafts models evals/results report; do
  [[ -d $AH/$d ]] || continue
  mkdir -p $WM/$(dirname $d)
  rsync -a --exclude '__pycache__' $AH/$d/ $WM/$d/ 2>/dev/null \
    && echo "  copied $d" || amber "  skipped $d"
done
for v in console kbtool graphtool; do
  if [[ -d $AH/$v/.venv ]]; then
    rsync -a $AH/$v/.venv/ $WM/$v/.venv/ 2>/dev/null && echo "  copied $v/.venv"
  fi
done
for f in report/index.html report/state-prev.json report/state-history.jsonl; do
  [[ -f $AH/$f ]] && cp $AH/$f $WM/$f 2>/dev/null
done
green "  data moved"

# ----------------------------------------------------------------- 4. swap
echo; info "4 · SWAP THE RUNTIME"
for j in router console nightly backup; do
  launchctl unload ~/Library/LaunchAgents/com.agenthub.$j.plist 2>/dev/null
done
echo "  launchd jobs unloaded"

mv $AH $BACKUP || { red "  rename failed — nothing changed"; exit 1 }
ln -s $WM $AH || { red "  symlink failed — restoring"; mv $BACKUP $AH; exit 1 }
green "  ~/AgentHub -> $WM"

for j in router console nightly backup; do
  launchctl load ~/Library/LaunchAgents/com.agenthub.$j.plist 2>/dev/null
done
echo "  launchd jobs reloaded"
sleep 10

# ----------------------------------------------------------------- 5. verify
echo; info "5 · VERIFY"
curl -sf -m 6 http://127.0.0.1:4100/api/capabilities >/dev/null \
  && green "  console responds through the symlink" \
  || red   "  console did not come back — see rollback below"
curl -sf -m 6 http://127.0.0.1:4000/v1/models >/dev/null \
  && green "  router responds" || red "  router did not come back"

echo
python3 $AH/scripts/selftest.py --quiet 2>&1 | tail -3

echo
info "ROLLBACK, if anything is wrong:"
echo "  for j in router console nightly backup; do launchctl unload ~/Library/LaunchAgents/com.agenthub.\$j.plist; done"
echo "  rm ~/AgentHub && mv $BACKUP ~/AgentHub"
echo "  for j in router console nightly backup; do launchctl load ~/Library/LaunchAgents/com.agenthub.\$j.plist; done"
echo
info "Once verify is green and a day has passed, remove the backup:"
echo "  rm -rf $BACKUP"
