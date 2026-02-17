---
name: eval-bench
description: Run comprehensive model evaluation across benchmark suites, RAG quality checks, perplexity tracking, and readable reporting.
---

# Eval Bench

Use this skill to evaluate newly trained models before release.
Evaluation must be repeatable, comparable across runs, and easy for humans to interpret.

## Core Benchmarking (lm-evaluation-harness)

Use `lm-evaluation-harness` as the default benchmark runner.
Include common suites such as:

- MMLU
- HellaSwag
- ARC (Easy/Challenge)
- and other relevant tasks for the model domain

Benchmark requirements:

- pin benchmark/task versions when possible
- record prompt/eval configuration and decoding settings
- keep scores comparable across model revisions

## RAG Evaluation (Ragas)

When the target use case includes retrieval-augmented generation, run `Ragas` evaluation with documented settings.
Track retrieval + generation quality signals and summarize failure patterns.

## Perplexity Measurement

Compute perplexity on representative held-out datasets.
Report:

- overall perplexity
- perplexity by domain/slice
- notable regressions vs prior checkpoints

## Reporting

Generate a human-readable evaluation report that includes:

- benchmark score table
- perplexity summary
- RAG metrics (if applicable)
- strengths, weaknesses, and release-readiness recommendation

## Deliverables

1. `eval_config.yaml` (tasks + settings)
2. `benchmark_results.json` (raw machine-readable outputs)
3. `evaluation_report.md` (human-readable summary)
