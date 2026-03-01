# Petabyte-Scale Dataset Creator Implementation Plan

This document outlines the architecture and implementation roadmap to elevate the "Dataset Creator" feature to the scale and capability of tier-1 AI research labs (DeepMind, OpenAI, Meta, etc.). This architecture moves away from single-node Python scripts and assumes access to massive, distributed compute and storage infrastructure.

## Proposed Architecture Breakdown

### 1. Storage & Orchestration Layer

To handle billions of documents and petabytes of data, local storage and simple polling mechanisms are insufficient.

- **Workflow Orchestration**: Replace the simple `setInterval` polling in `dataset-worker.mjs` with an enterprise-grade orchestrator like **Apache Airflow** or **Temporal**. This will manage complex Directed Acyclic Graphs (DAGs) for data pipelines.
- **Data Lake Storage**: Move all data storage to an **S3-compatible Object Store** (AWS S3, Google Cloud Storage, or MinIO for on-prem).
- **Data Format**: Store all intermediate and final text data in **Apache Parquet** format for extreme read/write efficiency, compression, and columnar querying, rather than flat JSONL files.

### 2. Massive Data Ingestion (Crawling)

Scraping Wikipedia and Reddit via public APIs is heavily rate-limited and slow.

- **CommonCrawl Integration**: Build pipelines to directly ingest and parse raw WARC (Web ARChive) files from CommonCrawl.
- **Distributed Crawler Fleet**: Deploy a horizontally auto-scaling fleet of headless browser nodes (using Playwright + Scrapy-Cluster + Kafka) to crawl specific high-value domains dynamically, handling proxy rotation and JavaScript rendering at scale.

### 3. The "AI Lab" Data Refinement Pipeline (Spark & Ray)

The core of modern LLM training isn't just getting data, but aggressively filtering it. This requires massive distributed computing.

- **Stage 1: Extraction & Language ID** (Apache Spark)
  - Extract pristine text from raw HTML using libraries like `trafilatura` or `jusText`.
  - Run `fastText` language identification across billions of documents in parallel using Spark UDFs (User Defined Functions).
- **Stage 2: Heuristic & Quality Filtering** (Apache Spark)
  - Filter out documents based on hard rules: text-to-code ratios, n-gram repetition (to catch spam/SEO text), and length requirements.
- **Stage 3: Massive-Scale Deduplication** (Apache Spark)
  - **Exact Dedup**: Use Bloom filters or distributed SHA-256 hashing.
  - **Fuzzy Dedup (Near-Duplicate)**: Implement **MinHash and Locality-Sensitive Hashing (LSH)** to find and remove near-duplicate documents across the entire petabyte corpus.
- **Stage 4: ML-Based Quality Classification** (Ray Cluster)
  - Train small, incredibly fast classifiers (e.g., fastText or small Transformers) on high-quality text (Wikipedia, ArXiv, Books). Use a **Ray cluster** to score every single web document against this model, keeping only the highest-scoring text.
- **Stage 5: Toxicity & PII Scrubbing** (Ray Cluster w/ GPUs)
  - Deploy NER (Named Entity Recognition) models across Ray GPU workers to detect and mask PII (Emails, Phones, SSNs) and filter highly toxic content.

### 4. Advanced Synthetic Data Generation (vLLM & Evol-Instruct)

Current synthetic generation relies on hardcoded templates and simple word substitutions, which produces highly repetitive data.

- **Inference Fleet**: Deploy a cluster of powerful open-source models (e.g., Llama 3 70B, Mixtral) using high-throughput serving engines like **vLLM** or **TensorRT-LLM**.
- **Evol-Instruct Workflow**: Implement agentic workflows where a "Teacher" LLM autonomously generates, evolves, complicates, and critiques prompts. A "Student" model attempts to answer, and the Teacher grades it. This produces hyper-diverse, complex reasoning trajectories for training, matching the methodologies used for modern instruction-tuned models.

### 5. Data Mixing & Distributed Tokenization

- **Strategic Blending**: Implement Spark jobs to intelligently sample and mix different domains (e.g., 60% High-Quality Web, 15% Code, 15% Math, 10% curated Wikipedia/Books) to prevent catastrophic forgetting during model training.
- **Pre-Tokenization**: Run distributed tokenization using the specific target model's tokenizer across the Spark cluster, outputting highly optimized `.bin` or `.tfrecord` chunk files ready for immediate GPU cluster ingestion.

---

## Proposed Changes to the Codebase (Scaffolding)

If approved, I will begin scaffolding the new architecture in the `workspace/skills/data-pipeline/` directory:

### [NEW] `airflow_dags/`

- `dataset_pipeline_dag.py`: The master orchestration DAG defining the flow from ingestion to tokenization.

### [NEW] `spark_jobs/`

- `01_extract_and_langid.py`: PySpark job for HTML extraction and language translation.
- `02_minhash_lsh_dedup.py`: PySpark job for massive-scale fuzzy deduplication.
- `03_data_mixer.py`: PySpark job for strategic domain blending and sampling.

### [NEW] `ray_tasks/`

- `quality_scorer.py`: Distributed Ray task for running ML quality classifiers over the dataset.
- `pii_scrubber.py`: Distributed Ray task for NER-based PII redaction.
- `evol_instruct_generator.py`: Ray task orchestrating vLLM inference nodes for synthetic data generation.

### [MODIFY] `dataset-worker.mjs`

- Will be refactored to act solely as a job submitter to the Airflow API, rather than executing Python scripts locally.

## Verification Plan

Because this requires massive infrastructure, verification will be done via unit tests and local mock clusters:

### Automated Tests

- Write PySpark local-mode unit tests for `02_minhash_lsh_dedup.py` to ensure LSH bucketing and Jaccard similarity thresholding work correctly on small mock datasets.
- Write Ray local-mode unit tests for the `quality_scorer.py` using dummy classifier models.
- Write Airflow DAG validation tests to ensure the pipeline structure contains no cyclical dependencies and loads correctly.

### Manual Verification

- Deploy a local mocked Airflow instance (using `docker-compose`) and verify the UI correctly submits a job that triggers a mock Spark pipeline.
