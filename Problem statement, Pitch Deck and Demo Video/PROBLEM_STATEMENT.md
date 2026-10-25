##### **Problem statement — CertiFlow**

**Track:** Money, Risk \& Regulation

**Who has the problem:** Fraud analysts and digital-banking operations teams at banks and financial service providers.

**Problem:** Fraud analysts cannot consistently connect transaction outcomes, risk signals, and customer behaviour quickly enough to spot patterns across many payments, because operational records and model decisions are often spread across systems and optimised for individual transactions rather than cross-transaction analysis.

**Why it matters:** Delayed pattern discovery can lead to missed fraud clusters, slow investigations, avoidable false positives, and limited visibility for operations leaders.

**Desired outcome:** Give analysts and administrators a consolidated analytics view of transaction outcomes, risk scores, holds, and blocks, while keeping payment execution fast and the operational ledger consistent.

**Solution summary:** CertiFlow is a synthetic-data digital banking simulation with rule-based and ML-assisted risk decisions. MongoDB remains the operational transaction ledger; Redis supports low-latency behavioural state; a Python/scikit-learn service scores transaction risk; and Exasol Personal is the analytics platform for transaction-decision events and aggregated risk reporting.

##### **Data and scope**

* Demo data is synthetic and generated for this project. Do not connect real customer or employer data.
* Exasol receives a minimal analytics event after a transaction decision commits in MongoDB. The analytics delivery is best-effort and does not determine whether a payment is committed.
* The project is a demonstrator, not a production banking system. Do not use it to process real funds or sensitive personal data.

