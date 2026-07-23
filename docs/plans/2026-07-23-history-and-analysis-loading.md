# Implementation plan

## Task 1: Make one-hour history resilient

- Add a failing delayed-schedule history test.
- Normalize a recent fallback interval and expose estimation metadata.
- Carry the metadata through `GameMetric` and render it honestly in details.
- Run the focused Python and JavaScript tests.

## Task 2: Publish a made-scope artifact

- Add failing pipeline assertions for the made artifact and manifest metadata.
- Extract one analysis-payload builder and publish full and made variants.
- Add version metadata for quality data.
- Run pipeline and validator tests.

## Task 3: Shorten the browser critical path

- Add failing data-client tests for bucketed manifests and SHA URLs.
- Load made data by default and full data only on demand.
- Render before quality data resolves.
- Bundle the analysis entry with the existing build tool and enforce a budget.

## Task 4: Regression and visual QA

- Run all Python tests, JavaScript unit tests, and Chromium E2E tests.
- Check production-sized artifact sizes and bundle size.
- Verify desktop and mobile rendering, console health, and the made-to-all flow
  in the in-app browser.

## Task 5: Commit

- Review the diff for generated or unrelated changes.
- Commit the focused history and loading optimization on the current branch.
