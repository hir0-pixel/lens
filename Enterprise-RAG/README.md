# Enterprise-RAG development bridge

QUARANTINED — not part of the active RAG path. `server/src/index.ts` wires
`/api/rag/ask` to the internal Orchestrator (`server/src/rag/orchestratorClient.ts`)
only; nothing in `server/src` references this folder. This is a standalone,
development-only Python RAG demonstration for the synthetic documents in
`documents/`, kept for reference/experimentation and not deployed or reachable
from the desktop client. The desktop UI does not receive the Gemini API key
and does not call Gemini through this or any other path.

## Preconditions

- A local Qdrant instance is running at `http://localhost:6333`.
- Dense, sparse, and reranker artifacts are already available locally. The
  runtime sets Hugging Face/Transformers offline mode and will fail rather than
  downloading models.
- The corpus is synthetic only.

## Configuration

Create `Enterprise-RAG/.env` locally (never commit it):

```dotenv
RAG_PROVIDER=gemini-test
RAG_TEST_DATA_ONLY=true
RAG_DATASET_CLASSIFICATION=synthetic
RAG_SERVICE_TOKEN=replace-with-a-random-secret-of-at-least-32-characters
GEMINI_API_KEY=server-side-only-key
GEMINI_MODEL=gemini-2.5-flash
RAG_QDRANT_COLLECTION=enterprise_docs_synthetic_v1
```

Configure the Lens BFF with the same `RAG_SERVICE_TOKEN` plus:

```dotenv
RAG_PROVIDER_MODE=gemini-test
RAG_SERVICE_URL=http://127.0.0.1:8010
```

## Run

From this folder, first ingest the synthetic corpus, then run the loopback
service:

```powershell
.\.venv\Scripts\python.exe ingest.py
.\.venv\Scripts\python.exe api.py
```

The BFF calls `POST /v1/ask` only on loopback and attaches its service token.
The RAG service rejects missing guards, non-loopback binding, malformed input,
missing local artifacts, unavailable dependencies, and invalid provider output.

This path is intentionally rejected by the BFF in production. A privately
hosted model must use the `internal` provider mode and pass the normal identity,
network, audit, retention, capacity, and release gates before promotion.
