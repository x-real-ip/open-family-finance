# Open Family Finance

*Read this in [Dutch / Nederlands](README.md).*

An open-source web app to split a family's shared household finances fairly,
based on net income. Expenses plus savings, minus government benefits, is what
you finance together; that amount is split in proportion to income, plus a
small buffer margin.

**No personal figures in this repo.** The code only contains empty defaults.
You enter your real amounts in the app and they are stored in a PostgreSQL
database — not in the source code. That is why this repo can safely be public.

## Stack

- **Frontend:** React (JSX) + Vite, served by nginx.
- **Backend:** Node.js + Express + `pg`.
- **Database:** PostgreSQL (state as JSONB).

```
open-family-finance/
├── .github/workflows/      # CI: Docker build + push to GHCR
│   └── build.yml
├── docker-compose.yml      # full stack locally
├── .env.example            # copy to .env
├── frontend/               # React + Vite (nginx in production)
│   ├── src/App.jsx         # the app (empty defaults)
│   ├── src/api.js          # talks to /api
│   └── default.conf.template
├── backend/                # Express API
│   ├── server.js
│   ├── db.js
│   └── migrations/001_init.sql
└── k8s/                    # Kubernetes manifests
    ├── postgres.yaml        # Secret + PVC + Postgres Deployment/Service
    ├── secret.example.yaml  # Secret template (do not commit real values)
    ├── configmap.yaml       # non-secret runtime config
    ├── deployment.yaml      # frontend + backend in one pod + Service
    └── httproute.yaml       # Gateway API HTTPRoute
```

## Run locally (full stack)

Requires: Docker with Compose (Docker Desktop, or the `docker compose` plugin).

```bash
cp .env.example .env          # change the password
docker compose up --build
```

Open http://localhost:8080. The database is created automatically and the
table is set up on startup.

Stop with `Ctrl+C`. Clean up containers: `docker compose down`.
Also wipe the database data: `docker compose down -v`.

## Local development (hot reload in VS Code)

Run the database and the API via Compose, and the frontend separately with
Vite. That way you see changes in the browser instantly, without rebuilding.

**Terminal 1 — database + backend:**
```bash
cp .env.example .env
docker compose up db api
```

**Terminal 2 — frontend (hot reload):**
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` to the backend on port 3000
(see `vite.config.js`). Changes in `frontend/src/` show up immediately.

### Working on the backend only

Run just the database via Compose and start the backend directly:

**Terminal 1:**
```bash
docker compose up db
```

**Terminal 2:**
```bash
cd backend
npm install
PORT=3000 DATABASE_URL=postgres://off:verander-mij@localhost:5432/open-family-finance npm run dev
```

The backend restarts automatically on changes (Node `--watch`).
You can then start the frontend with `npm run dev` in the `frontend/` folder
in a third terminal, or test the API with curl:

```bash
curl http://localhost:3000/api/health
```

## Building container images with GitHub Actions

The images are built and pushed to **GitHub Container Registry (ghcr.io)**
automatically by the workflow in `.github/workflows/build.yml`:

- On every push to `main` → tags `latest` + the short commit SHA.
- On a version tag (`git tag v1.0.0 && git push --tags`) → tag `1.0.0`.
- On a pull request the images are only built (not pushed), as a test.

**No extra secrets** are needed: the workflow logs in with the built-in
`GITHUB_TOKEN`. The images appear as:

```
ghcr.io/<your-github-account>/open-family-finance-web
ghcr.io/<your-github-account>/open-family-finance-api
```

After the first push: make the packages **public** (GitHub → Packages →
package → Package settings → Change visibility), or create an
`imagePullSecret` in your cluster so the pods can pull the (private) images:

```bash
kubectl create secret docker-registry ghcr \
  --docker-server=ghcr.io \
  --docker-username=<your-github-account> \
  --docker-password=<personal-access-token-with-read:packages> \
  && kubectl patch serviceaccount default \
       -p '{"imagePullSecrets":[{"name":"ghcr"}]}'
```

> Building locally by hand still works too, for example for testing:
> `docker build -t ghcr.io/<account>/open-family-finance-web:dev ./frontend`.
> If you build on ARM for an amd64 cluster, use `--platform linux/amd64`.

## Kubernetes

Frontend and backend run together in **one pod**: nginx serves the app on
`:80` and proxies `/api` internally to the api container on `localhost:8080`.
Only port 80 is exposed, through a Service and a Gateway API `HTTPRoute`.

1. Create the Secret: copy `k8s/secret.example.yaml`, set a real password and
   update `DATABASE_URL` to match. Prefer a secret manager (sealed-secrets,
   External Secrets, SOPS); never commit real secrets. Optionally set an
   `API_TOKEN`.
2. In `k8s/deployment.yaml`, pick your image registry/tag (default
   `ghcr.io/x-real-ip/...:latest`; consider pinning a version tag). If the
   images are private, enable `imagePullSecrets` (an example is in the file).
3. In `k8s/httproute.yaml`, adjust the `parentRefs` (your Gateway) and
   `hostnames` (your domain). Requires a Gateway API controller (Envoy
   Gateway, Cilium, NGINX Gateway Fabric, Istio, ...).
4. Apply:

   ```bash
   kubectl apply -f k8s/
   ```

5. Quick test without a Gateway:

   ```bash
   kubectl port-forward svc/open-family-finance 8080:80
   ```

The pod is ready as soon as Postgres is up; the backend retries the database
connection on startup, so boot order does not matter.

## API

| Method  | Path                 | Description              |
|---------|----------------------|--------------------------|
| GET     | `/api/health`        | Status + db check        |
| GET     | `/api/state/:key`    | Fetch state (or 404)     |
| PUT     | `/api/state/:key`    | Save state (upsert)      |
| DELETE  | `/api/state/:key`    | Delete state             |

The app uses a single key (`open-family-finance:v1`) for the whole document
containing all months.

## Security

- By default the API is **open**. Set `API_TOKEN` (backend) and build the
  frontend with the same `VITE_API_TOKEN` for simple bearer protection.
  Preferably put the app behind authentication on your gateway/ingress.
- Never commit `.env` or real Secret values.

## Next steps

- A normalized database schema (separate tables for months, entries, savings
  goals) instead of a single JSONB document.
- Real authentication and multiple households.
- The savings projection and private accounts from the original spreadsheet.
