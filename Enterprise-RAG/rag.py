import os
import json
from urllib import error, parse, request

# Embedding and reranking artifacts must be mirrored/pre-provisioned. A test
# request is allowed to reach Gemini only; it must never trigger a second,
# implicit model download.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from dotenv import load_dotenv
from qdrant_client import QdrantClient, models
from fastembed import TextEmbedding, SparseTextEmbedding
from fastembed.rerank.cross_encoder import TextCrossEncoder

# Collection and model names must match ingest.py
COLLECTION_NAME = os.getenv("RAG_QDRANT_COLLECTION", "enterprise_docs_synthetic_v1")
DENSE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
SPARSE_MODEL = "prithivida/Splade_PP_en_v1"
RERANK_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2"
# Initialize expensive local dependencies only after the service's explicit
# provider/dataset guard has been checked. The offline flags above reject a
# missing model artifact instead of reaching a public model host.
_runtime = None


def local_runtime():
    global _runtime
    if _runtime is None:
        _runtime = (
            TextEmbedding(DENSE_MODEL),
            SparseTextEmbedding(SPARSE_MODEL),
            TextCrossEncoder(model_name=RERANK_MODEL),
            QdrantClient(url="http://localhost:6333"),
        )
    return _runtime


load_dotenv()

MAX_QUERY_CHARS = 4_000
MAX_CONTEXT_CHARS = 48_000
MAX_OUTPUT_TOKENS = 2_048


class RagServiceError(RuntimeError):
    """Safe, transportable error for the development-only RAG service."""


def gemini_test_settings():
    """Return the only permitted external provider configuration.

    This is intentionally an opt-in dummy-data path. It is not a production
    fallback and refuses to run unless all guards are explicitly supplied.
    """
    if os.getenv("RAG_PROVIDER") != "gemini-test":
        raise RagServiceError("External generation is disabled.")
    if os.getenv("RAG_TEST_DATA_ONLY") != "true" or os.getenv("RAG_DATASET_CLASSIFICATION") != "synthetic":
        raise RagServiceError("Gemini testing is limited to explicitly declared synthetic data.")
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RagServiceError("Gemini test credentials are unavailable.")
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not model or "/" in model or ".." in model:
        raise RagServiceError("Gemini test model configuration is invalid.")
    return api_key, model

def hybrid_search(query, doc_type_filter=None, limit=10):
    dense_model, sparse_model, _, qdrant = local_runtime()
    # Embed the query with both dense and sparse models
    query_dense = list(dense_model.embed([query]))[0].tolist()
    query_sparse_raw = list(sparse_model.embed([query]))[0]
    query_sparse = models.SparseVector(
        indices=query_sparse_raw.indices.tolist(),
        values=query_sparse_raw.values.tolist(),
    )
    # Build an optional filter to narrow results by document type
    query_filter = None
    if doc_type_filter:
        query_filter = models.Filter(
            must=[
                models.FieldCondition(
                    key="doc_type",
                    match=models.MatchValue(value=doc_type_filter),
                )
            ]
        )
    # Search both indexes and fuse with Reciprocal Rank Fusion
    results = qdrant.query_points(
        collection_name=COLLECTION_NAME,
        prefetch=[
            models.Prefetch(
                query=query_dense,
                using="dense",
                limit=20,
            ),
            models.Prefetch(
                query=query_sparse,
                using="sparse",
                limit=20,
            ),
        ],
        query=models.FusionQuery(fusion=models.Fusion.RRF),
        query_filter=query_filter,
        with_payload=True,
        limit=limit,
    ).points

    return results
def rerank_results(query, search_results, limit=3):
    if not search_results:
        return search_results

    documents = [r.payload["text"] for r in search_results]

    _, _, reranker, _ = local_runtime()
    scores = list(
        reranker.rerank(query, documents)
    )

    ranked_pairs = sorted(
        zip(search_results, scores),
        key=lambda x: x[1],
        reverse=True
    )

    return [pair[0] for pair in ranked_pairs[:limit]]
def generate_answer(query, search_results):
    # Format each retrieved chunk with a source label
    context_parts = []
    for i, result in enumerate(search_results, 1):
        payload = result.payload
        context_parts.append(
            f"[Source {i}] Document: {payload['source']}, "
            f"Section: {payload['section']}\n"
            f"{payload['text']}"
        )
    context = "\n\n".join(context_parts)
    if len(context) > MAX_CONTEXT_CHARS:
        raise RagServiceError("Retrieved context exceeds the approved test bound.")
    # Build a prompt that constrains Gemini to the provided sources
    prompt = (
        "You are an enterprise analyst assistant. Answer the question based "
        "ONLY on the provided sources. For every factual claim in your answer, "
        "include a citation in the format [Source N]. If the sources do not "
        "contain enough information to answer, say so explicitly.\n\n"
        f"Sources:\n{context}\n\n"
        f"Question: {query}\n\n"
        "Answer with citations:"
    )
    api_key, model = gemini_test_settings()
    endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{parse.quote(model, safe='-_.')}:generateContent"
    )
    payload = json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": MAX_OUTPUT_TOKENS},
    }).encode("utf-8")
    http_request = request.Request(
        endpoint,
        data=payload,
        headers={"content-type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    try:
        with request.urlopen(http_request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (error.URLError, error.HTTPError, TimeoutError, ValueError) as exc:
        raise RagServiceError("Gemini test provider is unavailable.") from exc
    try:
        answer = body["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RagServiceError("Gemini test provider returned an invalid response.") from exc
    if not isinstance(answer, str) or not answer.strip():
        raise RagServiceError("Gemini test provider returned an empty response.")
    return answer.strip()


def answer_query(query, doc_type_filter=None):
    """Run bounded hybrid retrieval and return citation metadata for Lens."""
    if not isinstance(query, str) or not query.strip() or len(query) > MAX_QUERY_CHARS:
        raise RagServiceError("The query is invalid.")
    results = hybrid_search(query.strip(), doc_type_filter)
    ranked = rerank_results(query.strip(), results)
    if not ranked:
        return {"output": "I do not have enough authorized source material to answer that.", "citations": []}
    return {
        "output": generate_answer(query.strip(), ranked),
        "citations": [
            {"source": result.payload["source"], "section": result.payload["section"]}
            for result in ranked
        ],
    }
def ask(query, doc_type_filter=None):
    print(f"\nQuestion: {query}")
    if doc_type_filter:
        print(f"Filter: doc_type = {doc_type_filter}")
    print("-" * 60)

    results = hybrid_search(query, doc_type_filter)

    # Print retrieved sources with their RRF fusion scores
    print(f"\nRetrieved {len(results)} sources:")
    for i, r in enumerate(results, 1):
        score_str = f"{r.score:.4f}" if r.score is not None else "N/A"
        print(
            f"  [{i}] {r.payload['source']} - "
            f"{r.payload['section']} (score: {score_str})"
        )
    results = rerank_results(query, results)
    answer = generate_answer(query, results)
    print(f"\nAnswer:\n{answer}")
    return answer

if __name__ == "__main__":

    print("Enterprise RAG")
    print("Type 'exit' to quit.")

    while True:

        query = input("\nAsk a question: ").strip()

        if query.lower() == "exit":
            break

        if not query:
            continue

        ask(query)
