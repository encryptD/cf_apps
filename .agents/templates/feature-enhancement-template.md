# Feature/Enhancement Execution Template (Caveman + Ponytail)

## 1) Ticket Header
- Feature name:
- Requested by:
- Date:
- Primary flow:
- Non-goals (what we will not touch):

## 2) Scope Lock (max 5 lines)
- Business outcome:
- UI screens impacted:
- Backend entities/actions impacted:
- External S/4 endpoints impacted:
- Acceptance criteria (testable, 1-3 lines):

## 3) Single Vertical Slice Plan
### Slice 1 (must-have path only)
- UI binding/model changes:
- Controller changes:
- Service/action changes:
- Payload mapping changes:

### Slice 2 (optional enhancements only after Slice 1 passes)
- Optional fields:
- UX polish:

## 4) Caveman Rules (Build Minimum First)
- Implement only required fields first.
- No refactor unless needed to unblock.
- One failing path at a time (no parallel debugging tracks).
- One hypothesis per code patch.

## 5) Ponytail Checkpoints (Hard Gates)
### Gate A — Evidence ready
- Exact repro steps:
- Exact error text/timestamp (if bugfix):

### Gate B — Minimal patch done
- Files changed:
- Why this patch only:

### Gate C — Validation
- Syntax check result:
- Build result:

### Gate D — Deploy
- Package result:
- Deploy result:
- Runtime app status:

### Gate E — Functional verify
- User flow result:
- Acceptance criteria pass/fail:

## 6) Deploy Throttle Policy
- Max one deploy per confirmed hypothesis.
- If fail: stop, gather fresh evidence, then patch.
- No repeated deploy without new signal.

## 7) Token Budget Guardrails
- Keep updates short: change, reason, result, next step.
- Avoid full-log dumps unless explicitly asked.
- After 2 failed cycles on same error family: pause and request missing evidence before new edits.

## 8) Final Closeout Format
- What changed:
- Why it fixed the issue:
- Validation proof:
- Deployment proof:
- Any known residual risks:
- Next recommended action:
