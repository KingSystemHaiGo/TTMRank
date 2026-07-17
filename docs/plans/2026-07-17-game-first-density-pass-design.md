# TTMRank game-first density pass

## Goal

Make the existing game-first redesign faster to read without changing its data
contract or removing any preserved ranking surface. TapTap制造 remains the
primary analytical sample; all games remain a reference scope.

## Reading path

1. Select scope, platform, and time range.
2. Read four primary metrics and four supporting statistics.
3. Compare six type signals in one desktop viewport.
4. Open a representative game directly from a type signal.
5. Continue into distributions and the thirteen preserved analysis boards.

## Presentation changes

- Compress the analysis hero and utility controls.
- Collapse export utilities and data-quality detail behind compact disclosures.
- Keep eight metrics but distinguish primary evidence from supporting averages.
- Replace the tall type-signal list with a comparison grid and representative
  game links.
- Use logarithmic heat buckets so a few extremely hot games do not collapse the
  rest of the distribution into one bar.
- Reduce the home page to one focused screen with live, useful counts instead of
  explanatory card sections.
- Keep the original ranking structure intact and only tighten vertical spacing.

## Constraints and verification

- No developer profile, vendor verification, vendor scale, or identity scoring.
- Original rankings and all thirteen analysis boards remain available.
- Scope and filter state remain URL-backed.
- Representative games must open the existing accessible detail dialog.
- Desktop and mobile must have no page-level horizontal overflow.
- Python, JavaScript, Chromium E2E, and real-browser visual checks must pass.
