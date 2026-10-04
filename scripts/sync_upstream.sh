#!/usr/bin/env bash
# Sync this fork with the original agentscope repository.
#
# Usage:
#   scripts/sync_upstream.sh            # merge upstream/main into a new branch
#   scripts/sync_upstream.sh --into-main  # merge upstream/main straight into main
#
# The default mode is the safe one: it creates ``sync-upstream-<date>`` so you
# can run tests / open a PR before touching ``main``. If the merge conflicts,
# the script stops and leaves the conflicts for you to resolve; finish with
# ``git add`` + ``git commit``.
set -euo pipefail

UPSTREAM_URL="https://github.com/agentscope-ai/agentscope.git"
UPSTREAM_BRANCH="main"
BASE_BRANCH="main"

cd "$(git rev-parse --show-toplevel)"

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Working tree has uncommitted changes; commit or stash them first." >&2
    exit 1
fi

if ! git remote get-url upstream >/dev/null 2>&1; then
    echo "Adding remote 'upstream' -> ${UPSTREAM_URL}"
    git remote add upstream "${UPSTREAM_URL}"
fi

git fetch upstream "${UPSTREAM_BRANCH}"
git fetch origin "${BASE_BRANCH}"

git checkout "${BASE_BRANCH}"
git merge --ff-only "origin/${BASE_BRANCH}"

ahead=$(git rev-list --count "${BASE_BRANCH}..upstream/${UPSTREAM_BRANCH}")
if [ "${ahead}" -eq 0 ]; then
    echo "Already up to date with upstream/${UPSTREAM_BRANCH}."
    exit 0
fi
echo "Upstream has ${ahead} new commit(s)."

if [ "${1:-}" != "--into-main" ]; then
    branch="sync-upstream-$(date +%Y%m%d)"
    git checkout -b "${branch}"
fi

git merge "upstream/${UPSTREAM_BRANCH}" \
    -m "Merge upstream agentscope-ai/agentscope ${UPSTREAM_BRANCH}"

echo
echo "Merged. Review/test, then push:"
echo "  git push -u origin $(git rev-parse --abbrev-ref HEAD)"
