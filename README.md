# Storyteller's Library — Self-Hosted Edition

Illustrated 2D Library Mind Map, Notebook, & D&D (5e / 2024) Character Book with automatic server-side persistence and rolling backups.

## Quick Start (Docker Compose)

```bash
docker compose up -d --build
```

Then open `http://<your-server-ip>:3000` on your PC or phone.

## Data & Backups
- Your library is stored at `./data/library.json` (mounted to `/data/library.json` inside the container).
- Automatic rolling backups are saved in `./data/backups/` (up to 20 snapshots, at most 1 per minute).
- Rebuilding or updating the container (`docker compose up -d --build`) never overwrites `./data/`.

## Optional Password Protection
Uncomment `LIBRARY_PASSWORD` in `docker-compose.yml` to require a password when opening the app from any browser:

```yaml
environment:
  - LIBRARY_PASSWORD=your-secret-passphrase
```

(When prompted by your browser, leave the username blank or enter anything, and enter your password.)

## Local Development (Without Docker)
```bash
node server.js
```
