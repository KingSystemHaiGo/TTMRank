# Full-Site Analysis Fetch Resilience

## Context

The optimized analysis page renders its TapTap-made view from the HTML document and loads the full-site dataset only after the user selects `Full-site reference`. The live immutable artifact is about 1.06 MB uncompressed and 151 KB over gzip. Normal requests complete quickly, but observed GitHub Pages/Fastly stalls can exceed the shared 10-second JSON timeout. The current retry policy aborts at 10 seconds and immediately starts the same immutable download again. During live verification this produced two requests and a 19.5-second interaction.

## Request Decision

Keep the existing artifact and page architecture. Add a request option that distinguishes request timeouts from other transient failures. The full-site analysis artifact gets a 30-second timeout and does not automatically retry after that timeout. HTTP 408/425/429/5xx responses and immediate network `TypeError` failures still retry once. Other JSON consumers keep the existing 10-second timeout and retry behavior.

This is preferable to changing the data schema or splitting the artifact. Gzip already compresses repeated JSON keys effectively, while a new compact schema would add migration and compatibility cost for limited transfer savings. It is also preferable to background prefetching because default analysis must remain a one-document first view and must not spend bandwidth before user intent.

## Web Payload Decision

Production verification of the single-request policy still found a cold-cache transfer that exceeded 30 seconds. The canonical `analysis-current` artifact therefore remains complete and unchanged for data consumers, while the Pages build also publishes `analysis-web.<hash>.json` with the same schema and analysis semantics. The web projection removes precomputed sections, unused fields, and full-site icon URLs. It retains every field used by filters, metrics, boards, detail facts, and TapTap links.

The embedded TapTap-made dataset remains unchanged. After the web projection loads, the client restores matching TapTap-made icon URLs from that embedded data. Priority games keep their visual identity without making every visitor download hundreds of unrelated random image URLs. Other full-site reference games use the existing text fallback.

## Failure Behavior

While the full-site request is active, both scope controls remain disabled and the page keeps the TapTap-made analysis visible. A timeout or final error restores the controls and reports that the full-site reference is unavailable. The existing rejected-promise reset remains in place, so a later user click starts a fresh request.

## Verification

Unit tests cover both default transient retries and the new timeout opt-out. Projection tests prove identical filtered games, metrics, latest releases, and board membership. Analysis data-client tests continue to prove that the embedded made-only scope performs no request and that full-site scope fetches exactly one immutable web artifact. The built-site performance suite must still prove zero default data requests and enforce a web payload at most 75% of the canonical gzip size. Live Playwright verification checks one full-site request, a successful switch to the current all-site count, no console errors, and unchanged desktop/mobile first views.
