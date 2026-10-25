"""Exasol analytics adapter for CertiFlow.

MongoDB remains the operational ledger. This service writes a minimal, synthetic/demo-safe
analytics event for each committed payment and serves aggregated views from Exasol.
Configure EXASOL_DSN, EXASOL_USER, and EXASOL_PASSWORD to enable database operations.
"""
import os
from datetime import datetime, timezone
from flask import Flask, jsonify, request
import pyexasol

app = Flask(__name__)
DSN = os.getenv("EXASOL_DSN", "").strip()
USER = os.getenv("EXASOL_USER", "").strip()
PASSWORD = os.getenv("EXASOL_PASSWORD", "")
SCHEMA = os.getenv("EXASOL_SCHEMA", "CERTIFLOW").strip().upper()
SERVICE_KEY = os.getenv("EXASOL_INGEST_KEY", "")


def configured():
    return bool(DSN and USER and PASSWORD)


def connect():
    if not configured():
        raise RuntimeError("Exasol is not configured. Set EXASOL_DSN, EXASOL_USER, EXASOL_PASSWORD.")
    return pyexasol.connect(dsn=DSN, user=USER, password=PASSWORD, encryption=True, compression=True)


def qident(value):
    # Restrict schema identifiers to avoid SQL identifier injection.
    if not value or not value.replace("_", "").isalnum():
        raise ValueError("Invalid Exasol schema name")
    return '"' + value.upper() + '"'


def sqlstr(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def ensure_table(conn):
    schema = qident(SCHEMA)
    try:
        conn.execute(f"CREATE SCHEMA {schema}")
    except Exception as exc:
        # Exasol returns an error if the schema already exists; don't suppress other errors.
        if "already exists" not in str(exc).lower() and "object already exists" not in str(exc).lower():
            raise
    conn.execute(f'''CREATE TABLE IF NOT EXISTS {schema}.TRANSACTION_EVENTS (
        EVENT_ID VARCHAR(80) NOT NULL,
        TRANSACTION_ID VARCHAR(80),
        EVENT_TYPE VARCHAR(40) NOT NULL,
        CUSTOMER_ID VARCHAR(80),
        AMOUNT DECIMAL(18,2),
        TXN_STATUS VARCHAR(30),
        RISK_SCORE DECIMAL(6,2),
        RISK_LEVEL VARCHAR(20),
        DECISION VARCHAR(30),
        TRANSACTION_TYPE VARCHAR(30),
        CATEGORY VARCHAR(80),
        PAYMENT_MODE VARCHAR(40),
        EVENT_TIME TIMESTAMP NOT NULL,
        SOURCE VARCHAR(40) DEFAULT 'CERTIFLOW'
    )''')


def insert_event(payload):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat(sep=" ", timespec="seconds")
    event_id = str(payload.get("event_id") or f"txn-{payload.get('transaction_id','unknown')}-{payload.get('event_type','DECISION')}")[:80]
    values = [event_id, payload.get("transaction_id"), payload.get("event_type", "RISK_DECISION"),
              payload.get("customer_id"), payload.get("amount"), payload.get("status"),
              payload.get("risk_score"), payload.get("risk_level"), payload.get("decision"),
              payload.get("transaction_type"), payload.get("category"), payload.get("payment_mode"), now]
    cols = "EVENT_ID, TRANSACTION_ID, EVENT_TYPE, CUSTOMER_ID, AMOUNT, TXN_STATUS, RISK_SCORE, RISK_LEVEL, DECISION, TRANSACTION_TYPE, CATEGORY, PAYMENT_MODE, EVENT_TIME"
    rendered = []
    for i, value in enumerate(values):
        if i in (4, 6) and value is not None:
            try:
                rendered.append(str(round(float(value), 2)))
            except (TypeError, ValueError):
                rendered.append("NULL")
        else:
            rendered.append(sqlstr(value))
    schema = qident(SCHEMA)
    with connect() as conn:
        ensure_table(conn)
        # Idempotent event key avoids duplicate ingestion on client retries.
        conn.execute(f"DELETE FROM {schema}.TRANSACTION_EVENTS WHERE EVENT_ID = {sqlstr(event_id)}")
        conn.execute(f"INSERT INTO {schema}.TRANSACTION_EVENTS ({cols}) VALUES ({', '.join(rendered)})")
    return event_id


@app.get("/health")
def health():
    return jsonify({"service": "certiflow-exasol-analytics", "configured": configured(), "status": "ready" if configured() else "unconfigured"})


@app.post("/events")
def events():
    if SERVICE_KEY and request.headers.get("X-Service-Key") != SERVICE_KEY:
        return jsonify({"error": "unauthorized"}), 401
    payload = request.get_json(silent=True) or {}
    required = ("transaction_id", "decision", "status")
    if any(payload.get(k) is None for k in required):
        return jsonify({"error": "transaction_id, decision and status are required"}), 400
    try:
        event_id = insert_event(payload)
        return jsonify({"ok": True, "event_id": event_id, "platform": "Exasol"}), 201
    except Exception as exc:
        app.logger.exception("Exasol event ingestion failed")
        return jsonify({"error": "Exasol ingestion failed", "detail": str(exc) if not configured() else "Check Exasol credentials, network, schema permissions, and logs"}), 503


@app.get("/overview")
def overview():
    try:
        schema = qident(SCHEMA)
        with connect() as conn:
            ensure_table(conn)
            row = conn.execute(f'''SELECT COUNT(*),
                COALESCE(SUM(CASE WHEN DECISION = 'BLOCK' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN DECISION = 'HOLD' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN RISK_SCORE >= 70 THEN 1 ELSE 0 END), 0),
                COALESCE(AVG(RISK_SCORE), 0)
                FROM {schema}.TRANSACTION_EVENTS''').fetchone()
            decisions = conn.execute(f'''SELECT DECISION, COUNT(*) FROM {schema}.TRANSACTION_EVENTS
                GROUP BY DECISION ORDER BY COUNT(*) DESC''').fetchall()
            daily = conn.execute(f'''SELECT CAST(EVENT_TIME AS DATE), COUNT(*), COALESCE(SUM(AMOUNT),0)
                FROM {schema}.TRANSACTION_EVENTS WHERE EVENT_TYPE = 'RISK_DECISION'
                GROUP BY CAST(EVENT_TIME AS DATE) ORDER BY CAST(EVENT_TIME AS DATE) DESC LIMIT 14''').fetchall()
        return jsonify({"platform": "Exasol Personal", "connected": True,
                        "total_events": int(row[0]), "blocked": int(row[1]), "held": int(row[2]),
                        "high_risk": int(row[3]), "average_risk_score": round(float(row[4]), 2),
                        "decisions": [{"decision": x[0], "count": int(x[1])} for x in decisions],
                        "daily": [{"date": str(x[0]), "events": int(x[1]), "amount": float(x[2])} for x in daily]})
    except Exception as exc:
        app.logger.exception("Exasol analytics query failed")
        return jsonify({"platform": "Exasol Personal", "connected": False,
                        "error": str(exc) if not configured() else "Unable to query Exasol; check service logs"}), 503
