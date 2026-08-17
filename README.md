# snow-brothers-3d

Also contains **Cat & Mouse — Chase Protocol** under [`cat-mouse/`](./cat-mouse/) and the **101-slot Lucy AGI control plane** under [`agi/`](./agi/).

## Cloud Agent environment

`.cursor/environment.json` installs both packages and starts the control plane on `127.0.0.1:8787`. See `agi/README.md`.

Live fleet dispatch uses the official Cursor Cloud Agents API and the `CURSOR_API_KEY` environment secret. Unofficial Cursor proxies are out of scope.
