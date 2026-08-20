import os
import hashlib
import uuid
from pathlib import Path
from docx import Document as DocxDocument
from qdrant_client import QdrantClient, models
from fastembed import TextEmbedding, SparseTextEmbedding

# Collection name and embedding model constants
COLLECTION_NAME = os.getenv("RAG_QDRANT_COLLECTION", "enterprise_docs_synthetic_v1")
DENSE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
SPARSE_MODEL = "prithivida/Splade_PP_en_v1"


# Classify document type based on filename keywords
def classify_document(filename):
    name = filename.lower()
    if "policy" in name:
        return "policy"
    elif "report" in name or "financial" in name:
        return "report"
    elif "agreement" in name or "contract" in name:
        return "contract"
    return "general"
# Parse a DOCX file into chunks split by section headings
def parse_docx(filepath):
    doc = DocxDocument(filepath)
    filename = os.path.basename(filepath)
    doc_type = classify_document(filename)

    chunks = []
    current_section = "Header"
    current_text = []

    for para in doc.paragraphs:
        if para.style.name.startswith("Heading"):
            if current_text:
                text = " ".join(current_text)
                if len(text.strip()) > 50:
                    chunks.append({
                        "text": text.strip(),
                        "source": filename,
                        "section": current_section,
                        "doc_type": doc_type,
                    })
                current_text = []
            current_section = para.text
        else:
            if para.text.strip():
                current_text.append(para.text.strip())
    if current_text:
        text = " ".join(current_text)
        if len(text.strip()) > 50:
            chunks.append({
                "text": text.strip(),
                "source": filename,
                "section": current_section,
                "doc_type": doc_type,
            })

    return chunks


def ingest_documents():
    if os.getenv("RAG_DATASET_CLASSIFICATION") != "synthetic":
        raise RuntimeError("This development ingester accepts only the explicitly synthetic demo corpus.")
    client = QdrantClient(url="http://localhost:6333")
    dense_model = TextEmbedding(DENSE_MODEL)
    sparse_model = SparseTextEmbedding(SPARSE_MODEL)

    # Parse all DOCX files and generate embeddings
    all_chunks = []
    doc_dir = Path(__file__).resolve().parent / "documents"
    for filename in os.listdir(doc_dir):
        if filename.endswith(".docx"):
            filepath = os.path.join(doc_dir, filename)
            chunks = parse_docx(filepath)
            all_chunks.extend(chunks)
            print(f"Parsed {filename}: {len(chunks)} chunks")

    texts = [chunk["text"] for chunk in all_chunks]
    print("Generating dense embeddings...")
    dense_vectors = list(dense_model.embed(texts))
    print("Generating sparse embeddings...")
    sparse_vectors = list(sparse_model.embed(texts))
    if not all_chunks:
        raise RuntimeError("No supported documents were found for ingestion.")

    # Never delete or replace an existing serving collection. A changed
    # embedding profile needs a new collection/generation and explicit
    # publication, even for this synthetic development corpus.
    if not client.collection_exists(COLLECTION_NAME):
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config={
                "dense": models.VectorParams(
                    size=len(dense_vectors[0]),
                    distance=models.Distance.COSINE,
                )
            },
            sparse_vectors_config={
                "sparse": models.SparseVectorParams()
            },
        )
    # Build points with both dense and sparse vectors
    points = []
    for i, chunk in enumerate(all_chunks):
        sv = sparse_vectors[i]
        stable_id = str(uuid.UUID(hex=hashlib.sha256(
            f"{chunk['source']}\0{chunk['section']}\0{chunk['text']}".encode("utf-8")
        ).hexdigest()[:32]))
        points.append(
            models.PointStruct(
                id=stable_id,
                vector={
                    "dense": dense_vectors[i].tolist(),
                    "sparse": models.SparseVector(
                        indices=sv.indices.tolist(),
                        values=sv.values.tolist(),
                    ),
                },
                payload={
                    "text": chunk["text"],
                    "source": chunk["source"],
                    "section": chunk["section"],
                    "doc_type": chunk["doc_type"],
                },
            )
        )

    client.upsert(collection_name=COLLECTION_NAME, points=points)
    print(f"\nIngested {len(points)} chunks into Qdrant")


if __name__ == "__main__":
    ingest_documents()
