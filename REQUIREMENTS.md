# Gate Pass Application - Requirements

## Overview
A SAPUI5-based Gate Pass management application for tracking and managing visitor/vehicle/material gate passes.

## Functional Requirements

### Core Features
1. **Gate Pass Creation**: Allow users to create new gate passes with visitor/vehicle/material details
2. **Gate Pass Approval Workflow**: Multi-level approval process for gate passes
3. **Gate Pass Tracking**: Real-time status tracking (Pending, Approved, Rejected, Completed)
4. **Dashboard**: Overview of all gate passes with filtering and search capabilities
5. **Notifications**: Status change alerts for relevant stakeholders

### User Roles
- **Requester**: Creates gate pass requests
- **Approver**: Reviews and approves/rejects requests
- **Security**: Validates gate passes at entry/exit points
- **Admin**: Full system access and configuration

## Technical Requirements
- SAPUI5 frontend (version 1.120.0+)
- SAP BTP / CDS backend (srv, db)
- Responsive design supporting desktop, tablet, and mobile
- OData V4 service integration
- Fiori-compliant UI/UX

## Non-Functional Requirements
- High availability and performance
- Secure authentication via SAP Cloud Identity
- Audit trail for all gate pass transactions
- Data retention policies compliance

## Change Request 1.3.0 Scope Updates
### GatePass application
- `Pass Time` defaults to current system time on form initialization/reset.
- Line-item schema/UI changes:
  - Removed `Supplier Invoice` and `Supplier Invoice Date`.
  - Renamed `Quantity` display header to `Order Quantity`.
  - Hid `Order Item` column in the item grid.
  - Added editable `Challan Quantity` persisted in line-item payload.
- Added disabled `Goods Receipt` button in the top-right area aligned with the `Gate Entry No` selector.

### GateExit application
- `Exit Time` defaults to current system time on screen initialization/reset.
- Added Display mode compact read-only section to show GatePass-related fields and material items.
- Enforced non-editable display behavior for GatePass snapshot fields.
- Added watermark-style visual treatment for the top movement-type header section.
