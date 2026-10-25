# CertiFlow — AI-assisted transaction fraud monitoring with Exasol Personal

CertiFlow is a digital-banking simulation that evaluates synthetic transactions with behavioural signals, configurable rules, and a Python/scikit-learn model. It is designed to demonstrate how transaction processing and analytical fraud monitoring can work together.

**ExaThon track:** Money, Risk & Regulation  
**Data platform:** Exasol Personal (analytics and risk reporting)  
**Operational stack:** React + Vite · Node.js/Express · MongoDB · Redis · Python/scikit-learn · Docker Compose

> **Important status note:** The Exasol integration in this repository requires a real Exasol Personal instance and credentials. Set the `EXASOL_*` variables below, start the stack, and verify that transaction events are visible in Exasol before claiming a completed end-to-end integration. If Exasol is not configured, the banking demo can still run but this does **not** satisfy the challenge's data-platform requirement.

## Problem statement

Fraud analysts and digital-banking operations teams need to connect transaction outcomes, behavioural signals, and risk decisions across many payments. Operational systems are designed to process individual payments, while cross-transaction analysis can be fragmented or delayed. CertiFlow combines a synthetic banking workflow and ML-assisted risk decisions with Exasol Personal analytics to help reviewers explore risk decisions and trends.

## Architecture

```text
Customer / Fraud analyst / Admin (React)
                  |
            Express REST API
             /     |      \
       MongoDB    Redis    Python ML service
    operational   state      risk scoring
       ledger       |
          committed transaction decision
                  |
         Exasol analytics adapter
                  |
       Exasol Personal / SQL analytics
```

- **MongoDB** is the operational source of truth for accounts, balances, and the transaction ledger.
- **Redis** supports low-latency behavioural state, sessions, locks, caching, and live events.
- **Python/scikit-learn + rules** assess risk and recommend allow, notify, hold, or block outcomes.
- **Exasol Personal** is the analytics platform. After a transaction decision commits, the backend asynchronously sends a minimal event to the analytics adapter, which writes it to `CERTIFLOW.TRANSACTION_EVENTS`. Aggregations are queried from Exasol by the adapter's `/overview` endpoint and exposed to an authenticated admin at `/api/admin/exasol`.
- Analytics delivery is best-effort and never rolls back a committed payment. For production, replace the simple HTTP delivery with a durable queue/outbox and add retry/dead-letter handling.

## Quick start

### 1. Prerequisites

- Docker Desktop with Docker Compose
- An Exasol Personal instance reachable from your computer/Docker environment. See the [Exasol Developer Documentation](https://exasol.github.io/developer-documentation/main/getting_started.html).

### 2. Configure environment

```bash
cp .env.example .env
```

Set `JWT_SECRET` to a long random value. Then set the following values from your Exasol Personal instance:

```dotenv
EXASOL_DSN=your-exasol-host:8563
EXASOL_USER=your-user
EXASOL_PASSWORD=your-password-or-access-token
EXASOL_SCHEMA=CERTIFLOW
EXASOL_INGEST_KEY=choose-a-long-random-shared-secret
```

Use the actual host, port, username and password/access token provided by your Exasol instance. The example DSN is illustrative; don't copy it unless it matches your instance. Ensure the Exasol network allows connections from the machine running Docker. Never commit `.env` or credentials.

### 3. Start services

```bash
docker compose up --build
```

Wait for the frontend, backend, MongoDB, Redis, ML service, and `exasol-analytics` service to start. The analytics adapter health endpoint is `http://localhost:8100/health`; it reports whether Exasol credentials are configured.

### 4. Seed synthetic demo data

In a second terminal, from the directory containing `docker-compose.yml`:

```bash
docker compose exec backend npm run seed
```

**Warning:** the seed script resets/recreates the MongoDB demo data. Do not rerun it if you need to preserve demo changes.

Open http://localhost:5173.

| Role | Email | Password |
|---|---|---|
| Customer | `aarav@certiflow.test` | `Customer@123` |
| Fraud analyst | `analyst@certiflow.test` | `Analyst@12345` |
| Admin | `admin@certiflow.test` | `Admin@12345` |

Customer transaction PIN: `482916`. These are synthetic demo credentials only.

## Verify the Exasol integration

1. Confirm `http://localhost:8100/health` returns `configured: true`.
2. Make a demo payment in the customer UI. A committed decision is sent asynchronously to the Exasol adapter.
3. Inspect adapter logs:

   ```bash
   docker compose logs --tail=100 exasol-analytics
   ```

4. Connect to Exasol Personal using your SQL client and verify rows in `CERTIFLOW.TRANSACTION_EVENTS`.
5. Log in as the admin and call `GET /api/admin/exasol` with the admin bearer token. The endpoint is role-protected and returns aggregate event, block, hold, high-risk and daily metrics queried from Exasol.
6. If no rows appear, inspect backend logs for `Exasol analytics ingestion` messages and analytics service logs. Check credentials, network access, schema permissions, and the configured schema name.

The analytics adapter creates its schema and table when the first event or overview request is received. The Exasol user must have permission to create/use the schema and table. `EXASOL_INGEST_KEY` protects ingestion when set; use the same value in `.env` for backend and analytics service.

## Useful commands

```bash
docker compose ps
docker compose logs --tail=100 backend
docker compose logs --tail=100 exasol-analytics
docker compose down
```

The named MongoDB, Redis and model volumes persist when `docker compose down` is run. Do not use `docker compose down -v` unless you intend to delete those volumes.

## Tests and development

Backend tests/type checking:

```bash
cd backend
npm ci
npm test
npm run typecheck
```

Frontend:

```bash
cd frontend
npm ci
npm run build
npm run lint
```

ML service tests (if installed in the local Python environment):

```bash
cd ml
pip install -r requirements.txt
python tests/test_ml.py
```

## Synthetic data and limitations

All bundled demo records and generated model-training records are synthetic. Do not connect real customer data. This is an educational demonstrator, not a production banking product or a system for making real credit/fraud decisions. The current analytics event delivery is best-effort; a durable outbox/queue, schema migrations, access-control hardening, retention policy, monitoring, and integration tests are recommended before any production use.

## Prior work and challenge-window disclosure

This repository is based on a pre-existing CertiFlow/Riskora prototype. **Do not represent the inherited application as entirely created during the ExaThon window.** Before submission, complete [`docs/ORIGINALITY_DISCLOSURE_TEMPLATE.md`](docs/ORIGINALITY_DISCLOSURE_TEMPLATE.md) with truthful dates and specific contributions. In particular, identify which banking UI, MongoDB/Redis workflows, risk engine, and ML components predated the challenge, and list the Exasol integration and other work that was actually built during the window. If the challenge's originality rule is unclear, ask the organisers whether extending the earlier prototype is eligible.

## Submission materials checklist

- [Problem statement](docs/PROBLEM_STATEMENT.md)
- [Three-minute demo script](docs/DEMO_VIDEO_SCRIPT.md)
- [Originality disclosure template — must be completed](docs/ORIGINALITY_DISCLOSURE_TEMPLATE.md)
- MIT licence: [`LICENSE`](LICENSE)
- Pitch deck: create/update `docs/CertiFlow_Pitch_Deck.pptx` after the Exasol integration has been tested and screenshots/results are real.
- Demo video (maximum 3 minutes): record and link the actual working integration; do not use mock results as proof.
- Public GitHub repository: publish only after removing secrets and confirming the licence, README, deck, and video link.

## Security

`.env` is ignored by Git and must never be committed. Rotate any credential that has accidentally been shared. Demo passwords are intentionally simple and must not be reused outside this local synthetic environment.
"# CertiFlow-Exasol" 
