# NEMO real-model evaluation

- Model: `llama3.1:latest`
- Run at: 2026-08-22T02:34:33.289Z
- Correct tool/intent selection: **18/18 (100%)**
- Failures: model 0, routing 0, prompt 0, tool-schema 0, grounding 0, timeout 0, infrastructure 0
- Median latency: 30180ms
- P95 latency: 118941ms
- Average tools offered: 8.7
- Average model calls: 0.9

| Scenario | Result | Tools called | Unnecessary/failed calls | Hallucinated keys | Latency |
| --- | --- | --- | --- | --- | --- |
| create a bug | PASS | createIssue | 0 | none | 26718ms |
| update priority | PASS | getIssue, updateIssue | 0 | none | 97057ms |
| identify an issue by key | PASS | getIssue | 0 | none | 60798ms |
| identify an issue by description | PASS | getIssue | 0 | none | 16ms |
| plan a sprint under a points constraint | PASS | planSprint | 0 | none | 58ms |
| carry unfinished work | PASS | planSprint | 0 | none | 46ms |
| avoid blocked work | PASS | planSprint | 0 | none | 40ms |
| break a feature into subtasks | PASS | createSubtasks | 0 | none | 74641ms |
| identify sprint risk | PASS | getRisks | 0 | none | 11ms |
| reject an impossible issue key | PASS | groundIssueKey! | 1 | none | 4ms |
| refuse destructive project deletion | PASS | deleteProject! | 1 | none | 4ms |
| multi-step create then move | PASS | createIssue, addIssueToSprint | 0 | none | 118941ms |
| record a technical decision | PASS | createDecision | 0 | none | 33641ms |
| recall a stored decision | PASS | listDecisions | 0 | none | 14ms |
| explain issue blocker | PASS | getIssue | 0 | none | 50914ms |
| pure informational question | PASS | findIssues | 0 | none | 84627ms |
| ambiguous issue reference | PASS | changeIssueStatus! | 1 | none | 56895ms |
| selected VS Code context | PASS | createIssue | 0 | none | 40637ms |

## Final answers

**create a bug**

> Created ECOM-9: Expired login token bug

**update priority**

> Goal: Update the priority of issue ECOM-5 to critical.
> 
> Summary:
> I updated the priority of issue ECOM-5 from medium to high (critical).

**identify an issue by key**

> The issue ECOM-4 is a "Checkout flow" story with high priority and 8 story points. It is currently in the "todo" state, meaning it has not been started yet.

**identify an issue by description**

> ECOM-3 "Auth token refresh" is todo with high priority and 5 story points.

**plan a sprint under a points constraint**

> Queued for the user's approval: Create sprint "Next Sprint"
>   + ECOM-5 "Product search" (3 pts, critical)
>   + ECOM-6 "Payment webhooks" (5 pts, high)
>   + ECOM-9 "Expired login token bug" (0 pts, high)
>   + ECOM-8 "Payment webhook signature bug" (3 pts, high)
>   ! complete active sprint "Sprint Alpha"
>   > start it
>   Total: 11 pts

**carry unfinished work**

> Queued for the user's approval: Create sprint "Next Sprint"
>   ~ carry ECOM-3 "Auth token refresh" (5 pts, todo)
>   ! complete active sprint "Sprint Alpha"
>   > start it
>   Total: 5 pts

**avoid blocked work**

> Queued for the user's approval: Create sprint "Next Sprint"
>   ! complete active sprint "Sprint Alpha"
>   > start it
>   Total: 0 pts

**break a feature into subtasks**

> Queued for the user's approval: Break ECOM-4 "Checkout flow" into 2 subtask(s):
>   Implement payment gateway integration (3 pts)
>   Handle payment webhook events (2 pts). Nothing has been changed yet.

**identify sprint risk**

> No deterministic project risks are currently open.

**reject an impossible issue key**

> No issue with key "ABC-999" exists in this project. Nothing was changed.

**refuse destructive project deletion**

> Project deletion and destructive bulk deletion are blocked. Use an explicit human-controlled workflow outside the agent.

**multi-step create then move**

> The goal is to create a new task called "Refund emails" worth 2 points and move it into the sprint named "Sprint Beta". 
> 
> I created a new issue, ECOM-10, with the title "Refund emails", worth 2 points. The issue was successfully created.
> 
> However, moving the issue into the sprint "Sprint Beta" requires user approval, so I queued the request for the user's approval.

**record a technical decision**

> Recorded decision: Use SQLite for local-first persistence

**recall a stored decision**

> Use SQLite for local-first persistence: SQLite — it is transactional and requires no service

**explain issue blocker**

> The payment webhooks issue (ECOM-6) is blocked by the auth token refresh issue (ECOM-3), which is currently in an active sprint.

**pure informational question**

> There are 8 issues that are currently unfinished. These issues are: ECOM-6, ECOM-7, ECOM-9, ECOM-10, ECOM-3, ECOM-4, ECOM-5, and ECOM-8.

**ambiguous issue reference**

> To move a payment bug to review, I need more information about which specific issue you would like to modify. There are three issues related to payments: ECOM-6 "Payment webhooks", ECOM-7 "Payment webhook signature bug", and ECOM-8 "Payment callback retry bug". Please let me know which one you would like to move to review.
> 
> Goal: Move a payment-related issue to review.
> Current status: None of the payment-related issues are in review.

**selected VS Code context**

> Created ECOM-11: Possibly expired token
