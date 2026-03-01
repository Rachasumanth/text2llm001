#!/usr/bin/env python3
"""
Dataset Creator – External API Aggregation Engine
Fetches datasets from public APIs (Kaggle, YouTube, PubMed, Wikipedia, HuggingFace).
Called by dataset-worker.mjs when an API aggregation job is dispatched.

Usage:
  python api_aggregate.py --provider kaggle --query "dog heartbeat" --output-format jsonl
"""

import argparse
import json
import os
import sys
import time
import hashlib
from pathlib import Path
from urllib.parse import quote_plus

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log(msg):
    print(f"[api_aggregate] {msg}", flush=True)

def sha256_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def write_jsonl(records, output_path):
    with open(output_path, "w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    log(f"Wrote {len(records)} records to {output_path}")

def http_get_json(url, headers=None):
    """Simple HTTP GET returning parsed JSON, using only stdlib."""
    import urllib.request
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "Text2LLM-DatasetCreator/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

# ---------------------------------------------------------------------------
# Kaggle
# ---------------------------------------------------------------------------

def fetch_kaggle(query):
    """
    Searches Kaggle for datasets matching the query.
    Requires KAGGLE_USERNAME and KAGGLE_KEY env vars (from kaggle.json).
    Falls back to the public Kaggle API search endpoint.
    """
    records = []
    username = os.environ.get("KAGGLE_USERNAME", "")
    key = os.environ.get("KAGGLE_KEY", "")

    try:
        if username and key:
            # Use the official Kaggle API
            from kaggle.api.kaggle_api_extended import KaggleApi
            api = KaggleApi()
            api.authenticate()
            datasets = api.dataset_list(search=query, max_size=None, file_type="all")
            for ds in datasets[:50]:
                records.append({
                    "provider": "kaggle",
                    "id": str(ds.ref),
                    "title": str(ds.title),
                    "size": str(ds.totalBytes) if hasattr(ds, "totalBytes") else "unknown",
                    "url": f"https://www.kaggle.com/datasets/{ds.ref}",
                    "description": str(getattr(ds, "subtitle", "")),
                    "last_updated": str(getattr(ds, "lastUpdated", "")),
                    "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })
        else:
            # Fallback: public search API
            log("No Kaggle credentials found. Using public search API.")
            url = f"https://www.kaggle.com/api/v1/datasets/list?search={quote_plus(query)}&sortBy=relevance"
            try:
                data = http_get_json(url)
                for ds in (data if isinstance(data, list) else []):
                    records.append({
                        "provider": "kaggle",
                        "id": ds.get("ref", ""),
                        "title": ds.get("title", ""),
                        "url": f"https://www.kaggle.com/datasets/{ds.get('ref', '')}",
                        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    })
            except Exception as e:
                log(f"Kaggle public API error: {e}")
                records.append({"provider": "kaggle", "query": query, "error": str(e)})

    except ImportError:
        log("kaggle package not installed. Using metadata-only mode.")
        records.append({
            "provider": "kaggle",
            "query": query,
            "note": "Install kaggle package and set KAGGLE_USERNAME/KAGGLE_KEY to fetch full datasets.",
        })

    return records

# ---------------------------------------------------------------------------
# YouTube (audio extraction)
# ---------------------------------------------------------------------------

def fetch_youtube(query):
    """
    Searches YouTube and extracts audio URLs using yt-dlp.
    Requires: pip install yt-dlp
    """
    records = []
    try:
        import yt_dlp

        ydl_opts = {
            "quiet": True,
            "extract_flat": True,
            "default_search": f"ytsearch20:{query}",  # top 20 results
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            result = ydl.extract_info(query, download=False)
            entries = result.get("entries", []) if result else []

            for entry in entries:
                video_url = entry.get("url") or f"https://www.youtube.com/watch?v={entry.get('id', '')}"
                records.append({
                    "provider": "youtube",
                    "id": entry.get("id", ""),
                    "title": entry.get("title", ""),
                    "url": video_url,
                    "duration": entry.get("duration"),
                    "channel": entry.get("uploader", ""),
                    "note": "Use yt-dlp to download audio: yt-dlp -x --audio-format wav <url>",
                    "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })

    except ImportError:
        log("yt-dlp not installed. Returning search metadata only.")
        records.append({
            "provider": "youtube",
            "query": query,
            "note": "Install yt-dlp to enable YouTube audio extraction.",
        })

    return records

# ---------------------------------------------------------------------------
# PubMed (medical/scientific articles)
# ---------------------------------------------------------------------------

def fetch_pubmed(query):
    """Fetches article metadata from PubMed E-utilities (no API key required for low-volume)."""
    records = []
    base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

    try:
        # Step 1: Search for IDs
        search_url = f"{base}/esearch.fcgi?db=pubmed&term={quote_plus(query)}&retmax=50&retmode=json"
        search_data = http_get_json(search_url)
        ids = search_data.get("esearchresult", {}).get("idlist", [])

        if not ids:
            log("No PubMed results found.")
            return records

        # Step 2: Fetch summaries
        id_str = ",".join(ids)
        summary_url = f"{base}/esummary.fcgi?db=pubmed&id={id_str}&retmode=json"
        summary_data = http_get_json(summary_url)
        results = summary_data.get("result", {})

        for pmid in ids:
            article = results.get(pmid, {})
            if not isinstance(article, dict):
                continue
            records.append({
                "provider": "pubmed",
                "id": pmid,
                "title": article.get("title", ""),
                "authors": [a.get("name", "") for a in article.get("authors", [])],
                "source": article.get("source", ""),
                "pub_date": article.get("pubdate", ""),
                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })

    except Exception as e:
        log(f"PubMed API error: {e}")
        records.append({"provider": "pubmed", "query": query, "error": str(e)})

    return records

# ---------------------------------------------------------------------------
# Wikipedia
# ---------------------------------------------------------------------------

def fetch_wikipedia(query):
    """Fetches Wikipedia articles matching the query via the MediaWiki API."""
    records = []
    try:
        search_url = (
            f"https://en.wikipedia.org/w/api.php?action=query&list=search"
            f"&srsearch={quote_plus(query)}&srlimit=50&format=json"
        )
        data = http_get_json(search_url)
        results = data.get("query", {}).get("search", [])

        for item in results:
            page_id = item.get("pageid", "")
            title = item.get("title", "")

            # Fetch full extract
            extract_url = (
                f"https://en.wikipedia.org/w/api.php?action=query&pageids={page_id}"
                f"&prop=extracts&explaintext=true&format=json"
            )
            extract_data = http_get_json(extract_url)
            page = extract_data.get("query", {}).get("pages", {}).get(str(page_id), {})
            extract = page.get("extract", "")

            records.append({
                "provider": "wikipedia",
                "id": str(page_id),
                "title": title,
                "url": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
                "content_length": len(extract),
                "text": extract[:50000],
                "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })

    except Exception as e:
        log(f"Wikipedia API error: {e}")
        records.append({"provider": "wikipedia", "query": query, "error": str(e)})

    return records

# ---------------------------------------------------------------------------
# Hugging Face
# ---------------------------------------------------------------------------

def fetch_huggingface(query):
    """Searches Hugging Face Hub for datasets matching the query."""
    records = []
    try:
        url = f"https://huggingface.co/api/datasets?search={quote_plus(query)}&limit=50"
        data = http_get_json(url)

        for ds in (data if isinstance(data, list) else []):
            ds_id = ds.get("id", "")
            records.append({
                "provider": "huggingface",
                "id": ds_id,
                "author": ds.get("author", ""),
                "downloads": ds.get("downloads", 0),
                "likes": ds.get("likes", 0),
                "tags": ds.get("tags", []),
                "url": f"https://huggingface.co/datasets/{ds_id}",
                "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })

    except Exception as e:
        log(f"Hugging Face API error: {e}")
        records.append({"provider": "huggingface", "query": query, "error": str(e)})

    return records

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

PROVIDER_MAP = {
    "kaggle": fetch_kaggle,
    "youtube": fetch_youtube,
    "pubmed": fetch_pubmed,
    "wikipedia": fetch_wikipedia,
    "huggingface": fetch_huggingface,
}

def main():
    parser = argparse.ArgumentParser(description="Dataset Creator – External API Aggregation")
    parser.add_argument("--provider", required=True, choices=PROVIDER_MAP.keys())
    parser.add_argument("--query", required=True, help="Search query or resource ID")
    parser.add_argument("--output-format", default="jsonl", choices=["jsonl", "parquet", "csv"])
    parser.add_argument("--output-dir", default="./output", help="Directory to write results")
    args = parser.parse_args()

    if not args.query.strip():
        log("ERROR: Empty query provided.")
        sys.exit(1)

    log(f"Starting API aggregation: provider={args.provider}, query={args.query}")

    fetch_fn = PROVIDER_MAP[args.provider]
    records = fetch_fn(args.query)

    log(f"Fetched {len(records)} records from {args.provider}.")

    # Write output
    os.makedirs(args.output_dir, exist_ok=True)
    timestamp = time.strftime("%Y%m%d_%H%M%S")

    if args.output_format == "jsonl":
        output_path = os.path.join(args.output_dir, f"{args.provider}_{timestamp}.jsonl")
        write_jsonl(records, output_path)
    elif args.output_format == "parquet":
        try:
            import pandas as pd
            df = pd.DataFrame(records)
            output_path = os.path.join(args.output_dir, f"{args.provider}_{timestamp}.parquet")
            df.to_parquet(output_path, index=False)
            log(f"Wrote {len(records)} records to {output_path}")
        except ImportError:
            log("WARNING: pandas/pyarrow not installed. Falling back to JSONL.")
            output_path = os.path.join(args.output_dir, f"{args.provider}_{timestamp}.jsonl")
            write_jsonl(records, output_path)
    elif args.output_format == "csv":
        try:
            import pandas as pd
            df = pd.DataFrame(records)
            output_path = os.path.join(args.output_dir, f"{args.provider}_{timestamp}.csv")
            df.to_csv(output_path, index=False)
            log(f"Wrote {len(records)} records to {output_path}")
        except ImportError:
            log("WARNING: pandas not installed. Falling back to JSONL.")
            output_path = os.path.join(args.output_dir, f"{args.provider}_{timestamp}.jsonl")
            write_jsonl(records, output_path)

    log("Aggregation complete.")

if __name__ == "__main__":
    main()
