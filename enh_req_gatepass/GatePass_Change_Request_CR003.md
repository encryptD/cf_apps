# Issue Fix: Open Items in GatePass Applications

**Issue ID**: ISSUE-GATEPASS-FIX-003  
**Priority**: Medium  
**Status**: Open → In Progress  
**Created**: 2026-07-15  
**Owner**: Md Asad Uz Zaman  

---

## Open Issues Summary

The following points are currently open in the GatePass solution:

### 1. Purchase Order Field Should Be Editable in Gate Pass Page
**Description**:  
If PO is not entered at the time of Gate Entry, the PO field should still be editable later on the Gate Pass page.

**Application Scope**: GatePass Entry Form / Gate Pass Detail Page

**Fix Required**:
- Make the PO field editable (remove `readOnly` or `enabled: false`).
- Add validation on save (PO format / existence check optional).
- Ensure that changing PO later triggers re-fetch of item data if applicable.

**Status**: Open  
**Assigned To**: Frontend Developer

---

### 2. Show Busy Indicator While Saving GateEntry
**Description**:  
While saving a GateEntry in the GateEntry app, the page should show a busy/loading indicator so the user knows the save is in progress.

**Application Scope**: GateEntry App (Create / Save Flow)

**Fix Required**:
- Before calling the save OData / service, set `view.setBusy(true)`.
- On success/error, set `view.setBusy(false)`.
- Add appropriate timeout or error handling.

**Status**: Open  
**Assigned To**: Frontend Developer

---

### 3. “End Date and Time Cannot Be in the Future” Error on Gate Exit
**Description**:  
While closing Gate Exit, an error popup appears: “End date and time cannot be in the future”.

**Application Scope**: Gate Exit App (Close Gate Pass Flow)

**Fix Required**:
- Fix the date/time validation logic (compare with current system time).
- Allow current time or slight buffer.
- Improve error message or prevent the validation from triggering incorrectly.
- Check timezone handling (system vs user).

**Status**: Open  
**Assigned To**: Backend + Frontend Developer

---

## Action Plan

1. **Immediate**  
   - Assign developers to each point.
   - Reproduce all three issues in test environment.

2. **Fix & Test**  
   - Implement fixes one by one.
   - Test end-to-end flow (Gate Entry → Gate Pass → Gate Exit).

3. **Verification**  
   - PO field editable after initial save.
   - Busy indicator appears during save.
   - No future date error on Gate Exit.

4. **Deployment**  
   - Deploy updated version to QA.
   - Update requirement docs and Obsidian vault.

---

**Target Resolution**: 2026-07-22

**Related Documents**:
- REQ-GATEPASS-ENH-002
- GatePass Application Flow

---

**Comments**  
- 2026-07-15: Issue tracking document created for remaining open points.
