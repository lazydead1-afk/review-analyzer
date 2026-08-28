import "server-only";

import fs from "node:fs";
import path from "node:path";

import { getDemoAnalyzedReviews } from "@/lib/demo-analysis";
import { ISSUE_NAMES } from "@/lib/pipeline/aggregate";
import type {
  AnalyzedReview,
  Review,
  ReviewIssue,
  Sentiment,
} from "@/types/review";

export type ReviewDataSource = "processed" | "demo";

export type ProcessedReviewData = {
  reviews: AnalyzedReview[];
  source: ReviewDataSource;
};

const reviewSources = new Set<Review["source"]>([
  "app_store",
  "google_play",
  "trustpilot",
  "post_purchase_email",
  "support_chat",
]);
const sentiments = new Set<Sentiment>([
  "positive",
  "neutral",
  "negative",
  "mixed",
]);
const issueNames = new Set<string>(ISSUE_NAMES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAnalyzedReview(value: unknown): AnalyzedReview | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.product !== "string" ||
    typeof value.source !== "string" ||
    !reviewSources.has(value.source as Review["source"]) ||
    (value.rating !== null && typeof value.rating !== "number") ||
    typeof value.language !== "string" ||
    typeof value.text !== "string" ||
    typeof value.sentiment !== "string" ||
    !sentiments.has(value.sentiment as Sentiment) ||
    typeof value.isSpam !== "boolean" ||
    (value.duplicateOf !== null && typeof value.duplicateOf !== "string") ||
    !Array.isArray(value.issues)
  ) {
    return null;
  }

  const issues: ReviewIssue[] = [];

  for (const issue of value.issues) {
    if (
      !isRecord(issue) ||
      typeof issue.name !== "string" ||
      !issueNames.has(issue.name) ||
      (issue.severity !== "low" &&
        issue.severity !== "medium" &&
        issue.severity !== "high")
    ) {
      return null;
    }

    issues.push({
      name: issue.name as ReviewIssue["name"],
      severity: issue.severity,
    });
  }

  return {
    id: value.id,
    product: value.product,
    source: value.source as Review["source"],
    rating: value.rating as number | null,
    language: value.language,
    text: value.text,
    sentiment: value.sentiment as Sentiment,
    issues,
    isSpam: value.isSpam,
    duplicateOf: value.duplicateOf as string | null,
  };
}

function loadProcessedReviews(filePath: string): AnalyzedReview[] | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));

    if (!isRecord(parsed) || !Array.isArray(parsed.reviews)) {
      return null;
    }

    const reviews = parsed.reviews.map(parseAnalyzedReview);

    if (reviews.length === 0 || reviews.some((review) => review === null)) {
      return null;
    }

    const validReviews = reviews as AnalyzedReview[];
    const ids = new Set(validReviews.map((review) => review.id));
    return ids.size === validReviews.length ? validReviews : null;
  } catch {
    return null;
  }
}

export function getProcessedReviewData(): ProcessedReviewData {
  const processedPath = path.join(
    process.cwd(),
    "data",
    "processed-reviews.json",
  );
  const processedReviews = loadProcessedReviews(processedPath);

  if (processedReviews) {
    return { reviews: processedReviews, source: "processed" };
  }

  return { reviews: getDemoAnalyzedReviews(), source: "demo" };
}
