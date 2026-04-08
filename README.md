# Spare Part Tracker

Lightweight full-stack spare parts tracker for an automobile workshop.

## Quick start (Docker)
1. Copy env:
   - `cp .env.example .env`
2. Start services:
   - `docker compose up --build`
3. Open UI:
   - http://localhost:3001

Backend API:
- http://localhost:8001/docs

## Dev (without Docker)
### Backend
- Create venv, then `pip install -r backend/requirements.txt`
- Set `DATABASE_URL` to point at your Postgres
- Run: `uvicorn app.main:app --reload --app-dir backend`

### Frontend
- `cd frontend && npm install`
- `npm run dev`

## Exports
- PDF: `GET /export/pdf/{order_id}`
- Excel: `GET /export/excel/{order_id}`
