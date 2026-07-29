# Retrieval eval - local-brain - 2026-07-27

| id | source found | top hit | distance | answer |
|---|---|---|---|---|
| q01 | PASS | top1 | 0.432 | grounded |
| q02 | PASS | top1 | 0.608 | grounded |
| q03 | PASS | top1 | 0.578 | grounded |
| q04 | want policies.md/02-decision-log.md/01-architecture.md | PRODUCT-LOGIC-AND-10X-SCAN-STRATEGY.md | 0.643 | weak answer |
| q05 | PASS | top1 | 0.552 | grounded |
| q06 | want 01-architecture.md/02-decision-log.md | CHANGELOG.md | 0.547 | grounded |
| q07 | PASS | top1 | 0.484 | grounded |
| q08 | PASS | top1 | 0.506 | weak answer |
| q09 | want 04-runbook.md/07-operators-manual.md | 06-ops-runbook.md | 0.739 | grounded |
| q10 | PASS | top1 | 0.684 | grounded |
| q12 | n/a | - | 0.72 | refused correctly |
| q11 | n/a | - | 0.692 | refused correctly |

## Score
- recall@5: 7/10 (70%)
- top-1 accuracy: 7/10 (70%)
- grounded answers: 8/10 (80%)
- correct refusals: 2/2 (100%)

**Correct refusals must be 2/2. A system that invents an answer when the corpus is silent is worse than one that has no corpus at all.**
