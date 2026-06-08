# Change Request Specification: Gate Entry App

**Document Version:** 1.0.0  
**Target System:** Gate Entry Application  
**Objective:** Implement UI label updates, add system-generated fields, configure mock auto-fetch logic from Purchase Orders, and enforce mandatory validation fields.

---

## 1. UI Label Modifications

| Original Label | New Label | Scope / Location |
| :--- | :--- | :--- |
| `Party` | `Vendor` | Globally across all screens, forms, tables, and headers in the Gate Entry App. |

---

## 2. New Field Specifications

### 2.1. Gate Entry Number
* **Field Label:** `Gate Entry No`
* **Data Type:** String / Alphanumeric
* **Default Value:** `Null` / Empty
* **Behavior:** Automatically generated and populated by the system *after* the record is successfully created.
* **UI Properties:**
  * `Enabled`: `False` (Read-Only)

### 2.2. Gate Entry Year
* **Field Label:** `Gate Entry Year`
* **Data Type:** Integer / String
* **Default Value:** Current Year (e.g., `2026`)
* **Behavior:** Automatically populated with the current calendar year upon form initialization.
* **UI Properties:**
  * `Enabled`: `False` (Read-Only)

---

## 3. Auto-Fetched Fields (Purchase Order Integration Mock Logic)

When a Purchase Order (PO) is referenced or selected, the system must auto-populate the following fields using the specified fallback mock logic:

```json
{
  "Plant": {
    "type": "string",
    "description": "Dummy random 4-digit alphanumeric/numeric value",
    "generation_logic": "Random 4-digit integer (e.g., 1001 to 9999)"
  },
  "Vendor No": {
    "type": "string",
    "description": "Dummy random 10-digit numeric value",
    "generation_logic": "Random 10-digit integer"
  },
  "Vendor Name": {
    "type": "string",
    "description": "Mock vendor identifier selected from a predefined list",
    "allowed_values": ["VEN-234", "VEN-456", "VEN-876"],
    "generation_logic": "Random selection from the allowed_values array"
  }
}
```

---

## 4. Field Validation & Constraints

The following fields must be marked as mandatory. The form must prevent submission and display standard validation errors if these fields are null or empty:

1. **Vehicle Number**
   * **Required:** `True`
   * **Type:** String
2. **Vehicle Type**
   * **Required:** `True`
   * **Type:** String / Dropdown Selection
3. **Driver Name**
   * **Required:** `True`
   * **Type:** String

---

## 5. Acceptance Criteria for Validation Agents

* Verify that all instances of the word "Party" are replaced with "Vendor" in the user interface.
* Verify that `Gate Entry No` is read-only and initially empty, then populated with a value upon form submission.
* Verify that `Gate Entry Year` is read-only and pre-populated with the current year.
* Verify that selecting/referencing a Purchase Order triggers the mock generation of a 4-digit `Plant`, a 10-digit `Vendor No`, and selects one of the three specified `Vendor Name` values.
* Verify that the form cannot be submitted if `Vehicle Number`, `Vehicle Type`, or `Driver Name` are left blank.
