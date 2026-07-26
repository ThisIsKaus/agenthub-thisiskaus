# Retrieval eval - local-brain - 2026-07-26

| id | source found | top hit | distance | answer |
|---|---|---|---|---|
| q01 | PASS | top1 | 0.523 | grounded |
| q02 | PASS | top1 | 0.71 | weak answer |
| q03 | PASS | top1 | 0.732 | weak answer |
| q04 | want policies.md | 02-decision-log.md | 0.685 | grounded |
| q05 | PASS | 07-operators-manual.md | 0.627 | grounded |
| q06 | want 01-architecture.md | 02-decision-log.md | 0.533 | grounded |
| q07 | PASS | top1 | 0.482 | weak answer |
| q08 | PASS | top1 | 0.524 | weak answer |
| q09 | PASS | top1 | 0.722 | weak answer |
| q10 | PASS | 04-runbook.md | 0.683 | grounded |
| q11 | n/a | - | 0.662 | refused correctly |
| q12 | n/a | - | 0.968 | refused correctly |

## Score
- recall@5: 8/10 (80%)
- top-1 accuracy: 6/10 (60%)
- grounded answers: 5/10 (50%)
- correct refusals: 2/2 (100%)

**Correct refusals must be 2/2. A system that invents an answer when the corpus is silent is worse than one that has no corpus at all.**
