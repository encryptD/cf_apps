# Gate Pass

A SAPUI5 application for managing visitor, vehicle, and material gate passes.

## Project Structure

```
gatepass/
├── db/                    # CAP data models
├── srv/                   # CAP service definitions
├── webapp/                # SAPUI5 application
│   ├── controller/        # Controllers
│   ├── view/              # XML views
│   ├── i18n/              # Translations
│   ├── css/               # Styles
│   ├── localService/      # Mock data
│   ├── model/             # Models & helpers
│   ├── Component.js       # UI5 component
│   ├── index.html         # Entry point
│   └── manifest.json      # App descriptor
├── package.json           # npm config
├── ui5.yaml               # UI5 tooling config
├── REQUIREMENTS.md        # Functional & technical requirements
└── AGENTS.md              # Development agents & guidelines
```

## Getting Started

### Prerequisites
- Node.js (LTS version)
- `@ui5/cli` (install via `npm install --global @ui5/cli`)

### Install Dependencies
```bash
cd gatepass
npm install
```

### Run Locally
```bash
npm start
# or
ui5 serve --open index.html
```

The app will be available at `http://localhost:8080`.

## Backend (CAP)
The `srv/` and `db/` directories contain Cloud Application Programming model artifacts for backend services and data persistence.
## BTP CF Fix Notes (503/Auth)
The deployed app experienced intermittent `503`/`500` responses and recurring login redirect failures. The following changes resolved the issue:

- Updated XSUAA redirect whitelist in `xs-security.json` and re-applied service config.
- Recreated HTML5 repo services (`gatepass-html5-host`, `gatepass-html5-runtime`) and republished UI content.
- Corrected app-router entry routing in `approuter/xs-app.json`:
  - `welcomeFile` now points to `/commdasadgatepass-1.0.0/index.html`.
- Corrected embedded UI runtime route metadata in `webapp/xs-app.json` to use:
  - `service: "html5-apps-repo-rt"`
  - `authenticationType: "xsuaa"`
- Rebuilt and redeployed MTAR after each routing/security update.

### Validation checks used
- Root URL redirects correctly to versioned app path.
- `index.html` on both root path and versioned path returns healthy responses.
- Repeated request stress checks completed without new `503`/`500`.
- App-router recent logs no longer show:
  - `html5-apps-repo-rt ... status 503 Service Unavailable`
  - route validation/static fallback errors from prior configuration.

## License
Private — for internal use only.
