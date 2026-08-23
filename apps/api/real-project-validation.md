# NEMO real-project validation

Daily-use score: **91/100**

This is the deterministic evidence-coverage score. A manual cross-check against each repository README and Git log gives a conservative daily-use score of **79/100**.

| Repository | Understanding | History | Clustering | Current state |
|---|---:|---:|---:|---:|
| Calculator | 65 | 78 | 82 | 80 |
| Donations Platform | 95 | 82 | 78 | 88 |
| HR System | 92 | 45 | 65 | 86 |

The lower HR history score is intentional: four squash/audit commits cannot prove the evolution of a 1,000-file product.

## Calculator-main

- Profile: 14 commits, 33 files, 2 branches, 0 tags
- Import: 812 ms; AI calls: 0
- Understanding: 65/100
- History: 100/100
- Clustering: 91/100
- Current state: 80/100
- Work: 4 clusters (4 historical, 0 current)
- Risks: 1; debt groups: 0
- False-positive candidates: 0; commits outside bound: 0

## Donations-platform-main

- Profile: 71 commits, 737 files, 25 branches, 0 tags
- Import: 3617 ms; AI calls: 0
- Understanding: 100/100
- History: 100/100
- Clustering: 85/100
- Current state: 100/100
- Work: 15 clusters (14 historical, 1 current)
- Risks: 1; debt groups: 0
- False-positive candidates: 0; commits outside bound: 0

## HR-sys-master

- Profile: 4 commits, 1010 files, 1 branches, 0 tags
- Import: 590 ms; AI calls: 0
- Understanding: 100/100
- History: 85/100
- Clustering: 88/100
- Current state: 100/100
- Work: 5 clusters (4 historical, 1 current)
- Risks: 1; debt groups: 0
- False-positive candidates: 0; commits outside bound: 0

## Method

Deterministic evidence-coverage grading. False positives are low-evidence clusters requiring human review; missed work counts commits outside the bounded history window and is not claimed as confirmed missed features.
