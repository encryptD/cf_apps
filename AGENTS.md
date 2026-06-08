# Agents & Development Guidelines

## Project Agents

This document describes the development agents and their responsibilities for the Gate Pass project.

### Frontend Agent (UI5)
- **Responsibility**: SAPUI5 application development
- **Tech Stack**: SAPUI5, XML views, JavaScript controllers, OData V4
- **Conventions**:
  - Use `com.mdasad.gatepass` namespace consistently
  - Follow Fiori design guidelines
  - Prefer XML views over JS views
  - Use i18n for all user-facing strings
  - Use skill `.agents/skills/sapui5-cap-delivery/SKILL.md` for all UI5/CAP tasks
  - Use skill `.agents/skills/sapui5-hotfix/SKILL.md` for urgent console/runtime fixes

## Project Workflow

- Canonical workflow for agent execution: `.agents/workflows/sapui5-cap-feature-workflow.yaml`
- Agents must follow this workflow for all feature work and bugfixes in this repository.

## High-priority SAPUI5/CAP Rules (from project learnings)

- OData V4 only: do not use V2 APIs (`.read`, callback `.create`, callback `.callFunction`).
- Keep `mainService` URI relative (`/gatepass/`) and use UI5 proxy middleware for local development.
- Keep `dataSources` under `sap.app` in `webapp/manifest.json`.
- Use `core:CustomData` for custom control metadata (not arbitrary `data-*` XML attributes).
- Validate BTP descriptor with `mbt build -p=cf -t .mtar_tmp` when deployment files change.

### Backend Agent (CAP)
- **Responsibility**: Cloud Application Programming model services
- **Tech Stack**: Node.js, CDS, SQLite/HANA
- **Areas**:
  - `srv/`: Service definitions and handlers
  - `db/`: Data models and schema definitions

### DevOps Agent
- **Responsibility**: Build, deployment, and CI/CD pipeline
- **Tech Stack**: SAP BTP, Cloud Foundry, MTA

### Billing Optimization Agent
- **Responsibility**: Optimize model-credit usage on every interaction
- **Skill**: `.agents/skills/billing-optimization-plan/SKILL.md`
- **Policy**:
  - Apply silently at the start of **every** interaction — before planning, code edits, or tool execution.
  - Classify the request as `lightweight`, `balanced`, or `deep`, then operate at the lowest sufficient tier.
  - **Inform the user after the skill has been applied.**

## Coding Standards

### JavaScript / UI5
- Use strict mode in all modules
- Prefer `sap.ui.define` over global declarations
- Follow SAPUI5 naming conventions for IDs and classes

### CDS / Backend
- Use camelCase for entity names
- Define proper associations and compositions
- Implement authorization checks on all exposed entities

## Communication
- All agents should update `REQUIREMENTS.md` when scope changes
- Backend/frontend contracts should be documented in `srv/` README
