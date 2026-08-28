# Review Analyzer

Review Analyzer turns messy, multi-channel customer reviews into prioritized and inspectable customer issues using deterministic preprocessing, constrained LLM classification, and deterministic aggregation.

## What it does

- Cleans empty, junk, and obvious spam reviews before inference.
- Deduplicates cross-channel reviews with deterministic, precision-first rules.
- Retains multilingual reviews and classifies them in their original language.
- Extracts sentiment, normalized issues, and severity through strict structured output.
- Aggregates issue frequency, severity, product distribution, and representative feedback.
- Presents product and severity filters with click-through to underlying reviews.
- Evaluates predictions against 20 manually labeled examples.

## Architecture

```text
reviews.json
  → clean
  → deduplicate
  → Groq structured extraction
  → aggregate
  → processed-reviews.json
  → dashboard / eval
```

Deterministic operations surround the probabilistic LLM step. Cleaning, deduplication, validation, ID assignment, aggregation, and evaluation remain reproducible and auditable. The LLM only classifies the ordered review content; trusted review IDs are attached locally afterward.

## Tech stack

- Next.js 16 and React 19
- TypeScript
- Tailwind CSS 4
- Groq TypeScript SDK
- `openai/gpt-oss-20b`
- Local JSON artifacts for input, checkpoints, processed output, and evaluation labels

## Setup

```bash
npm install
```

Copy `.env.example` to `.env.local` and add a Groq key only if you need to rerun analysis:

```text
GROQ_API_KEY=
```

The included `data/processed-reviews.json` lets the completed dashboard and evaluation run without a Groq key. `.env.local` is ignored and must not be committed.

## Run dashboard

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Run analysis

```bash
npm run analyze
```

Analysis uses batches of five and atomically checkpoints each fully validated batch in `data/analysis-checkpoint.json`. Rerunning the command resumes completed work. Useful targeted modes are:

```bash
npm run analyze -- --limit 20
npm run analyze -- --eval
npm run analyze -- --eval --limit 5
```

`--eval` prioritizes eligible reviews from the manual evaluation set. Cleaning-rejected and deduplicated IDs are reported rather than sent to the model.

## Run evaluation

```bash
npm run eval
```

Current results:

| Metric | Result |
| --- | ---: |
| Labeled cases | 20 |
| Cases with predictions | 19 |
| Sentiment accuracy | 94.7% (18/19) |
| Issue precision | 91.3% (21/23) |
| Issue recall | 91.3% (21/23) |
| Issue F1 | 91.3% |
| Severity accuracy | 76.2% (16/21) |

Coverage is 19/20 because one manually labeled promotional spam case is intentionally rejected by deterministic preprocessing before LLM inference. Missing predictions are reported separately and excluded from agreement denominators.

## Data flow and artifacts

- `data/reviews.json`: 300 source reviews across five products and five channels.
- `data/analysis-checkpoint.json`: temporary resumability state for batch analysis.
- `data/processed-reviews.json`: completed, validated analysis used by the dashboard and evaluator.
- `evaluation/labels.json`: 20 manually labeled evaluation cases.
- `scripts/analyze.ts`: cleaning, deduplication, checkpointed Groq analysis, and artifact generation.
- `scripts/evaluate.ts`: local evaluation and observed-disagreement reporting; it never invokes the LLM.
