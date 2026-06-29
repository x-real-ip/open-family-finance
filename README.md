# OpenFamilyFinance

Een open-source web-app om de gezamenlijke huishoudfinanciën van een gezin
eerlijk te verdelen op basis van netto-inkomen. Pot (uitgaven + sparen) min de
overheidsbijdrage wordt verdeeld naar inkomen, plus een kleine buffer-marge.

**Geen persoonlijke cijfers in deze repo.** De code bevat alleen lege
standaardwaarden. Je echte bedragen voer je in via de app en die worden
opgeslagen in een PostgreSQL-database — niet in de broncode. Daarom kan deze
repo veilig openbaar zijn.

## Stack

- **Frontend:** React (JSX) + Vite, geserveerd door nginx.
- **Backend:** Node.js + Express + `pg`.
- **Database:** PostgreSQL (state als JSONB).

```
OpenFamilyFinance/
├── docker-compose.yml      # volledige stack lokaal
├── .env.example            # naar .env kopiëren
├── frontend/               # React + Vite (nginx in productie)
│   ├── src/App.jsx         # de app (lege standaardwaarden)
│   ├── src/api.js          # praat met /api
│   └── default.conf.template
├── backend/                # Express-API
│   ├── server.js
│   ├── db.js
│   └── migrations/001_init.sql
└── k8s/                    # Kubernetes-manifests
    ├── postgres.yaml
    ├── backend.yaml
    ├── frontend.yaml
    └── ingress.yaml
```

## Lokaal draaien (hele stack)

Vereist: Docker + Docker Compose.

```bash
cp .env.example .env          # pas wachtwoord aan
docker compose up --build
```

Open http://localhost:8080. De database wordt automatisch aangemaakt en de
tabel wordt bij het opstarten klaargezet.

## Lokaal ontwikkelen (hot reload in VS Code)

Draai de database (en eventueel de API) via Compose, en de frontend los met Vite:

```bash
cp .env.example .env
docker compose up db api          # database + backend
cd frontend && npm install && npm run dev
```

Open http://localhost:5173. Vite stuurt `/api` door naar de backend op poort
8080 (zie `vite.config.js`), dezelfde URLs als in productie.

Alleen aan de backend werken:

```bash
cd backend && npm install
DATABASE_URL=postgres://off:verander-mij@localhost:5432/open-family-finance npm run dev
```

## Container-images bouwen via GitHub Actions

De images worden automatisch gebouwd en gepusht naar **GitHub Container
Registry (ghcr.io)** door de workflow in `.github/workflows/build.yml`:

- Bij elke push naar `main` → tags `latest` + de korte commit-SHA.
- Bij een versietag (`git tag v1.0.0 && git push --tags`) → tag `1.0.0`.
- Bij een pull request worden de images alleen gebouwd (niet gepusht), als test.

Er zijn **geen extra secrets** nodig: de workflow logt in met de ingebouwde
`GITHUB_TOKEN`. De images verschijnen als:

```
ghcr.io/<jouw-github-account>/open-family-finance-web
ghcr.io/<jouw-github-account>/open-family-finance-api
```

Na de eerste push: zet de packages op **public** (GitHub → Packages →
package → Package settings → Change visibility), of maak in je cluster een
`imagePullSecret` aan zodat de pods de (private) images kunnen ophalen:

```bash
kubectl create secret docker-registry ghcr \
  --docker-server=ghcr.io \
  --docker-username=<jouw-github-account> \
  --docker-password=<personal-access-token-met-read:packages> \
  && kubectl patch serviceaccount default \
       -p '{"imagePullSecrets":[{"name":"ghcr"}]}'
```

> Lokaal handmatig bouwen kan ook nog steeds, bijvoorbeeld om te testen:
> `docker build -t ghcr.io/<account>/open-family-finance-web:dev ./frontend`.
> Bouw je op ARM voor een amd64-cluster, gebruik dan `--platform linux/amd64`.

## Kubernetes

1. Pas `k8s/postgres.yaml` aan: zet een echt wachtwoord in het Secret en werk
   `DATABASE_URL` bij. Gebruik bij voorkeur een secret-manager; commit geen
   echte geheimen.
2. Vervang `OWNER` in `k8s/backend.yaml` en `k8s/frontend.yaml` door je
   GitHub-account (en kies eventueel een vaste versietag i.p.v. `latest`).
3. Toepassen:

   ```bash
   kubectl apply -f k8s/
   ```

4. Benaderen via de ingress (pas de host aan), of snel testen:

   ```bash
   kubectl port-forward svc/open-family-finance-web 8080:80
   ```

De web-pod proxyt `/api` intern naar de backend-service, dus de ingress hoeft
alleen naar `open-family-finance-web` te wijzen.

## API

| Methode | Pad                  | Omschrijving            |
|---------|----------------------|-------------------------|
| GET     | `/api/health`        | Status + db-check       |
| GET     | `/api/state/:key`    | State ophalen (of 404)  |
| PUT     | `/api/state/:key`    | State opslaan (upsert)  |
| DELETE  | `/api/state/:key`    | State verwijderen       |

De app gebruikt één sleutel (`open-family-finance:v1`) voor het hele document
met alle maanden.

## Beveiliging

- Standaard is de API **open**. Zet `API_TOKEN` (backend) en bouw de frontend
  met hetzelfde `VITE_API_TOKEN` voor een simpele bearer-bescherming. Zet de app
  bij voorkeur achter authenticatie op je ingress.
- Commit nooit `.env` of echte Secret-waarden.

## Volgende stappen

- Genormaliseerd databaseschema (aparte tabellen voor maanden, posten,
  spaardoelen) in plaats van één JSONB-document.
- Echte authenticatie en meerdere huishoudens.
- De Raisin-spaarprojectie en de privé-rekeningen uit de oorspronkelijke sheet.
