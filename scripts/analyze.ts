import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import { RateLimitError } from "groq-sdk";

import type { BatchAnalysisItem } from "../lib/pipeline/analyze";
import type { Review, ReviewIssue } from "../types/review";

dotenv.config({
  path: path.join(process.cwd(), ".env.local"),
});

const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES_MS = 4000;
const MAX_ATTEMPTS = 4;
const MAX_VALIDATION_ATTEMPTS = 3;
const VALIDATION_RETRY_DELAY_MS = 1500;
const INITIAL_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 60000;
const MAX_SERVER_RETRY_DELAY_MS = 120000;

type AnalysisCheckpoint = {
  provider: string;
  model: string;
  datasetFingerprint: string;
  updatedAt: string;
  totalExpectedUniqueReviews: number;
  analyses: BatchAnalysisItem[];
};

type AnalyzeOptions = {
  evalMode: boolean;
  limit: number | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function calculateDatasetFingerprint(reviews: Review[]): string {
  return createHash("sha256").update(JSON.stringify(reviews)).digest("hex");
}

function parseOptions(args: string[]): AnalyzeOptions {
  let evalMode = false;
  let limit: number | null = null;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];

    if (argument === "--eval") {
      if (evalMode) {
        throw new Error("--eval may only be provided once.");
      }

      evalMode = true;
      continue;
    }

    if (argument === "--limit") {
      if (limit !== null) {
        throw new Error("--limit may only be provided once.");
      }

      const value = Number(args[index + 1]);

      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error("--limit must be followed by a positive integer.");
      }

      limit = value;
      index += 1;
      continue;
    }

    throw new Error("Usage: npm run analyze -- [--eval] [--limit N]");
  }

  return { evalMode, limit };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function loadEvaluationIds(filePath: string, reviewIds: Set<string>): string[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (!isRecord(parsed) || !Array.isArray(parsed.labels)) {
    throw new Error("Evaluation labels file must contain a labels array.");
  }

  const seenIds = new Set<string>();

  return parsed.labels.map((label, index) => {
    if (!isRecord(label) || typeof label.id !== "string") {
      throw new Error(`Evaluation label ${index + 1} has an invalid ID.`);
    }

    if (!reviewIds.has(label.id)) {
      throw new Error(`Evaluation label references unknown review ID ${label.id}.`);
    }

    if (seenIds.has(label.id)) {
      throw new Error(`Evaluation labels contain duplicate ID ${label.id}.`);
    }

    seenIds.add(label.id);
    return label.id;
  });
}

function validateCheckpointAnalysis(
  value: unknown,
  issueNames: Set<string>,
): BatchAnalysisItem {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error("Checkpoint contains an invalid analysis item.");
  }

  if (
    value.sentiment !== "positive" &&
    value.sentiment !== "neutral" &&
    value.sentiment !== "negative" &&
    value.sentiment !== "mixed"
  ) {
    throw new Error(`Checkpoint has invalid sentiment for ${value.id}.`);
  }

  if (typeof value.isSpam !== "boolean" || !Array.isArray(value.issues)) {
    throw new Error(`Checkpoint has invalid analysis for ${value.id}.`);
  }

  const issues: ReviewIssue[] = value.issues.map((issue) => {
    if (
      !isRecord(issue) ||
      typeof issue.name !== "string" ||
      !issueNames.has(issue.name) ||
      (issue.severity !== "low" &&
        issue.severity !== "medium" &&
        issue.severity !== "high")
    ) {
      throw new Error(`Checkpoint has an invalid issue for ${value.id}.`);
    }

    return {
      name: issue.name as ReviewIssue["name"],
      severity: issue.severity,
    };
  });

  return {
    id: value.id,
    sentiment: value.sentiment,
    issues,
    isSpam: value.isSpam,
  };
}

function loadCheckpoint(
  checkpointPath: string,
  provider: string,
  model: string,
  datasetFingerprint: string,
  expectedReviewIds: Set<string>,
  issueNames: Set<string>,
): AnalysisCheckpoint {
  if (!fs.existsSync(checkpointPath)) {
    return {
      provider,
      model,
      datasetFingerprint,
      updatedAt: new Date().toISOString(),
      totalExpectedUniqueReviews: expectedReviewIds.size,
      analyses: [],
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
  } catch (error) {
    throw new Error("Could not parse the analysis checkpoint.", {
      cause: error,
    });
  }

  if (!isRecord(parsed)) {
    throw new Error("Analysis checkpoint must be a JSON object.");
  }

  if (parsed.provider !== provider) {
    throw new Error(
      `Checkpoint provider ${String(parsed.provider)} does not match ${provider}.`,
    );
  }

  if (parsed.model !== model) {
    throw new Error(
      `Checkpoint model ${String(parsed.model)} does not match ${model}.`,
    );
  }

  if (parsed.datasetFingerprint !== datasetFingerprint) {
    throw new Error(
      "Checkpoint fingerprint does not match the current preprocessed dataset.",
    );
  }

  if (parsed.totalExpectedUniqueReviews !== expectedReviewIds.size) {
    throw new Error(
      "Checkpoint review count does not match the current preprocessed dataset.",
    );
  }

  if (
    typeof parsed.updatedAt !== "string" ||
    Number.isNaN(Date.parse(parsed.updatedAt))
  ) {
    throw new Error("Checkpoint has an invalid timestamp.");
  }

  if (!Array.isArray(parsed.analyses)) {
    throw new Error("Checkpoint analyses must be an array.");
  }

  const seenIds = new Set<string>();
  const analyses = parsed.analyses.map((item) => {
    const analysis = validateCheckpointAnalysis(item, issueNames);

    if (seenIds.has(analysis.id)) {
      throw new Error(`Checkpoint contains duplicate ID: ${analysis.id}.`);
    }

    if (!expectedReviewIds.has(analysis.id)) {
      throw new Error(`Checkpoint contains unexpected ID: ${analysis.id}.`);
    }

    seenIds.add(analysis.id);
    return analysis;
  });

  return {
    provider,
    model,
    datasetFingerprint,
    updatedAt: parsed.updatedAt,
    totalExpectedUniqueReviews: expectedReviewIds.size,
    analyses,
  };
}

function writeJsonAtomically(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
}

function getErrorStatus(error: unknown): number | null {
  if (error instanceof RateLimitError) {
    return error.status;
  }

  if (!isRecord(error)) {
    return null;
  }

  if (typeof error.status === "number") {
    return error.status;
  }

  if (typeof error.code === "number") {
    return error.code;
  }

  return null;
}

function isRateLimitError(error: unknown): boolean {
  if (getErrorStatus(error) === 429) {
    return true;
  }

  if (!isRecord(error)) {
    return false;
  }

  const code = typeof error.code === "string" ? error.code : "";
  const status = typeof error.status === "string" ? error.status : "";
  const message = error instanceof Error ? error.message : "";

  return /RATE_LIMIT|RATE LIMIT|RESOURCE_EXHAUSTED/i.test(
    `${code} ${status} ${message}`,
  );
}

function isDailyQuotaError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  const message = error instanceof Error ? error.message : "";
  const body = isRecord(error.error) ? JSON.stringify(error.error) : "";

  return /daily|per day|tokens per day|requests per day|\bTPD\b|\bRPD\b/i.test(
    `${message} ${body}`,
  );
}

function parseDelayMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value * 1000;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  const match = normalized.match(
    /^(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?)?$/i,
  );

  if (match) {
    const amount = Number(match[1]);
    return match[2]?.toLowerCase() === "ms" ? amount : amount * 1000;
  }

  const durationMatch = normalized.match(
    /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i,
  );

  if (durationMatch && durationMatch[0]) {
    const hours = Number(durationMatch[1] ?? 0);
    const minutes = Number(durationMatch[2] ?? 0);
    const seconds = Number(durationMatch[3] ?? 0);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  const date = Date.parse(normalized);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function findRetryDelayMs(value: unknown, depth = 0): number | null {
  if (depth > 3 || !isRecord(value)) {
    return null;
  }

  for (const key of ["retryDelay", "retry_delay", "retryAfter"]) {
    const delay = parseDelayMs(value[key]);

    if (delay !== null) {
      return delay;
    }
  }

  const headers = value.headers;

  if (headers instanceof Headers) {
    const retryAfterMs = headers.get("retry-after-ms");

    if (retryAfterMs !== null) {
      const milliseconds = Number(retryAfterMs);

      if (Number.isFinite(milliseconds) && milliseconds >= 0) {
        return milliseconds;
      }
    }

    for (const header of [
      "retry-after",
      "x-ratelimit-reset-requests",
      "x-ratelimit-reset-tokens",
    ]) {
      const delay = parseDelayMs(headers.get(header));

      if (delay !== null) {
        return delay;
      }
    }
  } else if (isRecord(headers)) {
    for (const header of [
      "retry-after",
      "x-ratelimit-reset-requests",
      "x-ratelimit-reset-tokens",
    ]) {
      const delay = parseDelayMs(headers[header]);

      if (delay !== null) {
        return delay;
      }
    }
  }

  for (const key of ["details", "errorDetails", "error", "response", "cause"]) {
    const nested = value[key];
    const values = Array.isArray(nested) ? nested : [nested];

    for (const item of values) {
      const delay = findRetryDelayMs(item, depth + 1);

      if (delay !== null) {
        return delay;
      }
    }
  }

  const message = value instanceof Error ? value.message : "";
  const match = message.match(
    /retry(?:ing)?(?:\s+in|\s+after)?\s+(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?)/i,
  );

  return match ? parseDelayMs(`${match[1]}${match[2]}`) : null;
}

async function main() {
  const { evalMode, limit } = parseOptions(process.argv.slice(2));
  const { getReviews } = await import("../lib/reviews");
  const { cleanReviews } = await import("../lib/pipeline/clean");
  const { deduplicateReviews } = await import("../lib/pipeline/deduplicate");
  const {
    analyzeReviewBatch,
    BatchValidationError,
    ISSUE_TAXONOMY,
    LLM_MODEL,
    LLM_PROVIDER,
  } = await import("../lib/pipeline/analyze");

  const reviews = getReviews();
  const cleaned = cleanReviews(reviews);
  const validReviews = cleaned
    .filter((result) => result.status === "valid")
    .map((result) => result.review);
  const deduplicated = deduplicateReviews(validReviews);
  const uniqueReviews = deduplicated
    .filter((result) => result.status === "unique")
    .map((result) => result.review);

  const evaluationIds = evalMode
    ? loadEvaluationIds(
        path.join(process.cwd(), "evaluation", "labels.json"),
        new Set(reviews.map((review) => review.id)),
      )
    : [];
  const uniqueReviewsById = new Map(
    uniqueReviews.map((review) => [review.id, review]),
  );
  const targetReviews = evalMode
    ? evaluationIds
        .map((id) => uniqueReviewsById.get(id))
        .filter((review): review is Review => Boolean(review))
    : uniqueReviews;

  const dataDirectory = path.join(process.cwd(), "data");
  const checkpointPath = path.join(
    dataDirectory,
    "analysis-checkpoint.json",
  );
  const outputPath = path.join(dataDirectory, "processed-reviews.json");
  const expectedReviewIds = new Set(uniqueReviews.map((review) => review.id));
  const datasetFingerprint = calculateDatasetFingerprint(uniqueReviews);
  const checkpoint = loadCheckpoint(
    checkpointPath,
    LLM_PROVIDER,
    LLM_MODEL,
    datasetFingerprint,
    expectedReviewIds,
    new Set(ISSUE_TAXONOMY),
  );
  const analysisById = new Map(
    checkpoint.analyses.map((analysis) => [analysis.id, analysis]),
  );
  const remainingReviews = targetReviews.filter(
    (review) => !analysisById.has(review.id),
  );
  const reviewsForThisRun =
    limit === null ? remainingReviews : remainingReviews.slice(0, limit);
  const batches = chunkArray(reviewsForThisRun, BATCH_SIZE);

  console.log("");
  console.log("Review Analyzer");
  console.log("------------------------------");
  console.log(`Raw reviews: ${reviews.length}`);
  console.log(`Valid after cleaning: ${validReviews.length}`);
  console.log(`Unique after deduplication: ${uniqueReviews.length}`);
  console.log(`Provider: ${LLM_PROVIDER}`);
  console.log(`Model: ${LLM_MODEL}`);
  console.log(`Mode: ${evalMode ? "evaluation" : "full dataset"}`);

  if (evalMode) {
    const cleanedById = new Map(
      cleaned.map((result) => [result.review.id, result]),
    );
    const deduplicatedById = new Map(
      deduplicated.map((result) => [result.review.id, result]),
    );
    const unavailableEvaluationIds: string[] = [];

    for (const id of evaluationIds) {
      const cleanResult = cleanedById.get(id);

      if (cleanResult?.status !== "valid") {
        const status = cleanResult?.status ?? "not found";
        unavailableEvaluationIds.push(
          `${id}: rejected by cleaning (${status})`,
        );
        continue;
      }

      const deduplicationResult = deduplicatedById.get(id);

      if (deduplicationResult?.status === "duplicate") {
        unavailableEvaluationIds.push(
          `${id}: deduplicated into ${deduplicationResult.duplicateOf}`,
        );
      }
    }

    console.log(`Evaluation IDs: ${evaluationIds.length}`);
    console.log(`Eligible unique evaluation reviews: ${targetReviews.length}`);

    if (unavailableEvaluationIds.length > 0) {
      console.log("Evaluation IDs not eligible for analysis:");

      for (const message of unavailableEvaluationIds) {
        console.log(`  - ${message}`);
      }
    }
  }

  console.log(
    `Already analyzed in current target: ${targetReviews.length - remainingReviews.length}`,
  );
  console.log(`Checkpoint total: ${analysisById.size}/${uniqueReviews.length}`);
  console.log(`Selected for this run: ${reviewsForThisRun.length}`);
  console.log(`LLM batches: ${batches.length}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log("");

  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index].filter(
      (review) => !analysisById.has(review.id),
    );

    if (batch.length === 0) {
      continue;
    }

    console.log(
      `Analyzing batch ${index + 1}/${batches.length} (${batch.length} reviews)...`,
    );

    let result: BatchAnalysisItem[] | null = null;

    let rateLimitAttempt = 1;
    let validationAttempt = 1;

    while (rateLimitAttempt <= MAX_ATTEMPTS) {
      try {
        result = await analyzeReviewBatch(batch);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        console.error(`Batch ${index + 1} failed: ${message}`);

        if (error instanceof BatchValidationError) {
          if (validationAttempt === MAX_VALIDATION_ATTEMPTS) {
            throw error;
          }

          console.log(
            `Validation failed. Waiting ${VALIDATION_RETRY_DELAY_MS / 1000}s before attempt ${validationAttempt + 1}/${MAX_VALIDATION_ATTEMPTS}...`,
          );

          validationAttempt += 1;
          await sleep(VALIDATION_RETRY_DELAY_MS);
          continue;
        }

        if (!isRateLimitError(error)) {
          throw error;
        }

        if (rateLimitAttempt === MAX_ATTEMPTS) {
          throw error;
        }

        if (isDailyQuotaError(error)) {
          console.error("Daily Groq quota is exhausted; not retrying.");
          throw error;
        }

        const reportedDelay = findRetryDelayMs(error);

        if (
          reportedDelay !== null &&
          reportedDelay > MAX_SERVER_RETRY_DELAY_MS
        ) {
          console.error(
            `Groq requested a ${Math.ceil(reportedDelay / 1000)}s retry delay; not retrying this run.`,
          );
          throw error;
        }

        const exponentialDelay = Math.min(
          INITIAL_BACKOFF_MS * 2 ** (rateLimitAttempt - 1),
          MAX_BACKOFF_MS,
        );
        const serverDelay = reportedDelay ?? 0;
        const waitMs = Math.max(exponentialDelay, serverDelay);

        console.log(
          `Groq rate limited. Waiting ${Math.ceil(waitMs / 1000)}s before attempt ${rateLimitAttempt + 1}/${MAX_ATTEMPTS}...`,
        );

        rateLimitAttempt += 1;
        await sleep(waitMs);
      }
    }

    if (!result) {
      throw new Error(`Batch ${index + 1} could not be completed.`);
    }

    for (const analysis of result) {
      analysisById.set(analysis.id, analysis);
    }

    const orderedAnalyses = uniqueReviews
      .map((review) => analysisById.get(review.id))
      .filter((analysis): analysis is BatchAnalysisItem => Boolean(analysis));

    writeJsonAtomically(checkpointPath, {
      provider: LLM_PROVIDER,
      model: LLM_MODEL,
      datasetFingerprint,
      updatedAt: new Date().toISOString(),
      totalExpectedUniqueReviews: uniqueReviews.length,
      analyses: orderedAnalyses,
    } satisfies AnalysisCheckpoint);

    console.log(
      `Batch ${index + 1} complete. Checkpoint: ${analysisById.size}/${uniqueReviews.length}.`,
    );

    if (index < batches.length - 1) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  if (analysisById.size !== uniqueReviews.length) {
    console.log("");
    console.log(
      `Run complete. ${uniqueReviews.length - analysisById.size} reviews remain.`,
    );
    console.log(`Checkpoint saved to: ${checkpointPath}`);
    return;
  }

  const processedReviews = uniqueReviews.map((review) => {
    const analysis = analysisById.get(review.id);

    if (!analysis) {
      throw new Error(`Missing analysis for ${review.id}.`);
    }

    return {
      ...review,
      sentiment: analysis.sentiment,
      issues: analysis.issues,
      isSpam: analysis.isSpam,
      duplicateOf: null,
    };
  });

  writeJsonAtomically(outputPath, {
    generatedAt: new Date().toISOString(),
    provider: LLM_PROVIDER,
    model: LLM_MODEL,
    stats: {
      raw: reviews.length,
      validAfterCleaning: validReviews.length,
      uniqueAfterDeduplication: uniqueReviews.length,
      analyzed: processedReviews.length,
      batches: Math.ceil(uniqueReviews.length / BATCH_SIZE),
    },
    reviews: processedReviews,
  });

  console.log("");
  console.log("Analysis complete.");
  console.log(`Saved to: ${outputPath}`);
}

main().catch((error) => {
  console.error("");
  console.error("Analysis failed.");
  console.error(error);
  process.exit(1);
});
