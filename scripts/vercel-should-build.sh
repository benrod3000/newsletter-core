#!/usr/bin/env bash
#
# Vercel "Ignored Build Step". Exit 1 to build, exit 0 to skip.
#
# CI (.github/workflows/ci.yml) runs typecheck, lint, test and build on every
# push to main - and Vercel deploys from the same push, independently of it. So
# a commit whose tests fail still shipped: the only thing CI could actually stop
# was a broken build, and only because Vercel happens to run one too.
#
# This closes that. The deploy runs the same gate before building, so a red test
# suite means no deployment rather than a red badge next to a live regression.
#
# Deliberately runs the checks here rather than polling the GitHub API for the
# CI run's conclusion. Polling needs a token, has a race against a run that has
# not started, and fails open when the API is unreachable - "could not tell" is
# indistinguishable from "passed", which is the failure mode this whole exercise
# keeps finding. Running them costs a couple of minutes and cannot be ambiguous.
#
# Not run for preview deployments: previews exist to look at work in progress,
# and a preview you cannot deploy because a test is failing is a preview you
# cannot use to work out why.
set -euo pipefail

if [ "${VERCEL_ENV:-}" != "production" ]; then
  echo "Preview build - skipping the production gate."
  exit 1
fi

echo "Production build. Running the CI gate before deploying."

npm run typecheck
npm run lint:ci
npm test

echo "Gate passed - proceeding with the build."
exit 1
