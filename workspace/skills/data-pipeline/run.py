#!/usr/bin/env python3
"""
Dataset Creator – General Data Pipeline Runner
Processes an already-uploaded file through the cleaning, dedup, and filtering pipeline.
Called by dataset-worker.mjs for standard (non-scraping, non-API) file processing jobs.

Usage:
  python run.py --input <file_key> --output-format jsonl
"""

import argparse
import json
import os
import sys
import time
import hashlib
import re
from pathlib import Path

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log(msg):
    print(f"[data-pipeline] {msg}", flush=True)

def sha256_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def write_jsonl(records, output_path):
    with open(output_path, "w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    log(f"Wrote {len(records)} records to {output_path}")

# ---------------------------------------------------------------------------
# Text Cleaning
# ---------------------------------------------------------------------------

def clean_text(text):
    """Basic text cleaning: normalize whitespace, strip boilerplate markers."""
    text = re.sub(r'\s+', ' ', text).strip()
    # Remove common boilerplate patterns
    text = re.sub(r'(Cookie Policy|Privacy Policy|Terms of Service|All rights reserved).*?\.', '', text, flags=re.IGNORECASE)
    return text

# ---------------------------------------------------------------------------
# PII Removal
# ---------------------------------------------------------------------------

PII_PATTERNS = [
    (r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL_REDACTED]'),  # emails
    (r'\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b', '[PHONE_REDACTED]'),  # US phone numbers
    (r'\b\d{3}-\d{2}-\d{4}\b', '[SSN_REDACTED]'),  # SSN
    (r'\b(?:\d{4}[-\s]?){3}\d{4}\b', '[CARD_REDACTED]'),  # credit card numbers
]

def remove_pii(text):
    """Remove likely PII from text."""
    for pattern, replacement in PII_PATTERNS:
        text = re.sub(pattern, replacement, text)
    return text

# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------

def deduplicate_records(records, key="text"):
    """Simple exact deduplication based on content hash."""
    seen = set()
    unique = []
    dupes = 0
    for record in records:
        content = str(record.get(key, ""))
        h = sha256_hash(content)
        if h not in seen:
            seen.add(h)
            unique.append(record)
        else:
            dupes += 1
    log(f"Dedup: {dupes} duplicates removed, {len(unique)} records retained.")
    return unique

# ---------------------------------------------------------------------------
# Quality Filtering
# ---------------------------------------------------------------------------

def quality_filter(records, min_length=50):
    """Remove low-quality records (too short, mostly whitespace, etc.)."""
    filtered = []
    removed = 0
    for record in records:
        text = str(record.get("text", ""))
        if len(text.strip()) < min_length:
            removed += 1
            continue
        # Check for repetitive n-grams (spam indicator)
        words = text.lower().split()
        if len(words) > 10:
            unique_ratio = len(set(words)) / len(words)
            if unique_ratio < 0.2:  # 80%+ repeated words = spam
                removed += 1
                continue
        filtered.append(record)
    log(f"Quality filter: {removed} low-quality records removed, {len(filtered)} retained.")
    return filtered

# ---------------------------------------------------------------------------
# Main Pipeline
# ---------------------------------------------------------------------------

def process_file(input_path, output_format, output_dir):
    """Process a raw file through the full cleaning pipeline."""
    log(f"Processing file: {input_path}")

    # Read input
    if not os.path.exists(input_path):
        log(f"ERROR: Input file not found: {input_path}")
        sys.exit(1)

    ext = Path(input_path).suffix.lower()
    records = []

    if ext == ".jsonl":
        with open(input_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    try:
                        records.append(json.loads(line))
                    except json.JSONDecodeError:
                        records.append({"text": line})
    elif ext == ".json":
        with open(input_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            if isinstance(data, list):
                records = data
            else:
                records = [data]
    elif ext == ".csv":
        try:
            import pandas as pd
            df = pd.read_csv(input_path)
            records = df.to_dict(orient="records")
        except ImportError:
            log("pandas not installed. Reading CSV as plain text lines.")
            with open(input_path, "r", encoding="utf-8") as fh:
                for line in fh:
                    records.append({"text": line.strip()})
    else:
        # Plain text – split by double newlines into records
        with open(input_path, "r", encoding="utf-8") as fh:
            text = fh.read()
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        records = [{"text": p} for p in paragraphs]

    log(f"Loaded {len(records)} raw records.")

    # Pipeline stages
    log("Stage 1: Cleaning text...")
    for record in records:
        if "text" in record:
            record["text"] = clean_text(record["text"])

    log("Stage 2: PII removal...")
    pii_count = 0
    for record in records:
        if "text" in record:
            original = record["text"]
            record["text"] = remove_pii(record["text"])
            if record["text"] != original:
                pii_count += 1
    log(f"  PII redacted in {pii_count} records.")

    log("Stage 3: Deduplication...")
    records = deduplicate_records(records)

    log("Stage 4: Quality filtering...")
    records = quality_filter(records)

    # Add metadata
    for i, record in enumerate(records):
        record["__pipeline_id"] = i
        record["__processed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # Output
    os.makedirs(output_dir, exist_ok=True)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    base_name = Path(input_path).stem

    if output_format == "jsonl":
        output_path = os.path.join(output_dir, f"{base_name}_cleaned_{timestamp}.jsonl")
        write_jsonl(records, output_path)
    elif output_format == "parquet":
        try:
            import pandas as pd
            df = pd.DataFrame(records)
            output_path = os.path.join(output_dir, f"{base_name}_cleaned_{timestamp}.parquet")
            df.to_parquet(output_path, index=False)
            log(f"Wrote {len(records)} records to {output_path}")
        except ImportError:
            log("WARNING: pandas/pyarrow not installed. Falling back to JSONL.")
            output_path = os.path.join(output_dir, f"{base_name}_cleaned_{timestamp}.jsonl")
            write_jsonl(records, output_path)
    elif output_format == "csv":
        try:
            import pandas as pd
            df = pd.DataFrame(records)
            output_path = os.path.join(output_dir, f"{base_name}_cleaned_{timestamp}.csv")
            df.to_csv(output_path, index=False)
            log(f"Wrote {len(records)} records to {output_path}")
        except ImportError:
            log("WARNING: pandas not installed. Falling back to JSONL.")
            output_path = os.path.join(output_dir, f"{base_name}_cleaned_{timestamp}.jsonl")
            write_jsonl(records, output_path)

    # Write manifest
    manifest = {
        "input": input_path,
        "output": output_path,
        "format": output_format,
        "total_records": len(records),
        "pipeline_version": "1.0.0",
        "processed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    manifest_path = os.path.join(output_dir, f"{base_name}_manifest_{timestamp}.json")
    with open(manifest_path, "w") as fh:
        json.dump(manifest, fh, indent=2)
    log(f"Manifest written to {manifest_path}")

    log("Pipeline complete.")


def main():
    parser = argparse.ArgumentParser(description="Dataset Creator – Data Pipeline Runner")
    parser.add_argument("--input", required=True, help="Path to raw input file")
    parser.add_argument("--output-format", default="jsonl", choices=["jsonl", "parquet", "csv"])
    parser.add_argument("--output-dir", default="./output", help="Directory to write cleaned output")
    args = parser.parse_args()

    process_file(args.input, args.output_format, args.output_dir)


if __name__ == "__main__":
    main()
