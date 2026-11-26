# Requirement: Enhancements for GatePass Application (Points 1-4)

**Requirement ID**: REQ-GATEPASS-ENH-002  
**Priority**: High  
**Status**: Draft  
**Date**: 2026-07-02  
**Owner**: Md Asad Uz Zaman  
**Scope**: GatePass Module + Related Screens

---

## Overview

This requirement covers specific UI/functional improvements for the GatePass application based on user feedback.

---

## Detailed Requirements

### 1. Change Tiles Description
**Description**: Update the tile description to **“STORAGE DEPARTMENT”**.

**Application Scope**: GatePass Dashboard (Home Screen / Tile View)

**Acceptance Criteria**:
- Tile text must read exactly “STORAGE DEPARTMENT”.
- Tile remains clickable and functional.

---

### 2. Auto Fetch Time on Save Gate Entry
**Description**: When saving a Gate Entry, the system should automatically fetch and populate the current system time.

**Application Scope**: GatePass Entry Form (Create / Edit Gate Entry Screen)

**Acceptance Criteria**:
- Time field is auto-populated with current system time on save.
- User can still manually override if needed.
- Time format consistent with existing application (e.g., HH:MM).

---

### 3. Make Invoice Date & Invoice No Mandatory
**Description**: Invoice Date and Invoice No fields must be mandatory in the GatePass form.

**Application Scope**: GatePass Entry Form (Create / Edit Gate Entry Screen)

**Acceptance Criteria**:
- Form validation prevents save if fields are empty.
- Clear error messages shown for missing fields.
- Fields marked with * (mandatory indicator).

---

### 4. Auto Populate Unit from PO
**Description**: Unit field should be automatically populated from the linked Purchase Order.

**Application Scope**: GatePass Entry Form (Create / Edit Gate Entry Screen, Line Item Level)

**Acceptance Criteria**:
- Unit is auto-filled when PO line item is selected.
- Consistent with PO unit of measure.
- Editable override allowed.

---

## Implementation Notes

- All changes must maintain existing functionality and data integrity.
- Use existing OData services for auto-population (PO data, supplier master, etc.).
- Add proper validation messages and loading indicators where applicable.
- Test across different devices (responsive).

---

## Acceptance Criteria (Overall)

- All points 1-4 implemented and working as described.
- No regression on existing GatePass flows.
- UI remains clean and user-friendly.
- Changes documented in the project wiki / Obsidian vault.

**References**:
- GatePass Application
- GatePass Dashboard
- Related PO OData Services

**Target Completion**: 2026-07-10
