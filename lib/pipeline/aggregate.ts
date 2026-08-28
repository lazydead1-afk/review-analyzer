import type {
  AnalyzedReview,
  IssueName,
  Severity,
} from "@/types/review";

export const ISSUE_NAMES: IssueName[] = [
  "account_access",
  "app_crash",
  "performance",
  "sync",
  "battery",
  "charging",
  "hardware_failure",
  "delivery",
  "missing_items",
  "food_quality",
  "customer_support",
  "billing",
  "refund",
  "pricing",
  "subscription",
  "usability",
  "missing_feature",
  "other",
];

export type SeverityCounts = Record<Severity, number>;

export type RepresentativeQuote = {
  reviewId: string;
  text: string;
};

export type IssueSummary = {
  name: IssueName;
  affectedReviewCount: number;
  severityCounts: SeverityCounts;
  productBreakdown: Record<string, number>;
  representativeReviewIds: string[];
  representativeQuotes: RepresentativeQuote[];
};

export type AggregationFilters = {
  product?: string;
  severity?: Severity;
};

const severityRank: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function uniqueIssuesByName(review: AnalyzedReview) {
  const issues = new Map<IssueName, Severity>();

  for (const issue of review.issues) {
    const currentSeverity = issues.get(issue.name);

    if (
      !currentSeverity ||
      severityRank[issue.severity] > severityRank[currentSeverity]
    ) {
      issues.set(issue.name, issue.severity);
    }
  }

  return issues;
}

export function aggregateIssues(
  reviews: AnalyzedReview[],
  filters: AggregationFilters = {},
): IssueSummary[] {
  const summaries = new Map<IssueName, IssueSummary>();

  for (const review of reviews) {
    if (filters.product && review.product !== filters.product) {
      continue;
    }

    for (const [name, severity] of uniqueIssuesByName(review)) {
      if (filters.severity && severity !== filters.severity) {
        continue;
      }

      const summary = summaries.get(name) ?? {
        name,
        affectedReviewCount: 0,
        severityCounts: { low: 0, medium: 0, high: 0 },
        productBreakdown: {},
        representativeReviewIds: [],
        representativeQuotes: [],
      };

      summary.affectedReviewCount += 1;
      summary.severityCounts[severity] += 1;
      summary.productBreakdown[review.product] =
        (summary.productBreakdown[review.product] ?? 0) + 1;

      if (summary.representativeReviewIds.length < 2) {
        summary.representativeReviewIds.push(review.id);
        summary.representativeQuotes.push({
          reviewId: review.id,
          text: review.text,
        });
      }

      summaries.set(name, summary);
    }
  }

  return [...summaries.values()].sort(
    (left, right) =>
      right.affectedReviewCount - left.affectedReviewCount ||
      right.severityCounts.high - left.severityCounts.high ||
      right.severityCounts.medium - left.severityCounts.medium ||
      left.name.localeCompare(right.name),
  );
}

export function getReviewsForIssue(
  reviews: AnalyzedReview[],
  issueName: IssueName,
  filters: AggregationFilters = {},
): AnalyzedReview[] {
  return reviews.filter((review) => {
    if (filters.product && review.product !== filters.product) {
      return false;
    }

    const severity = uniqueIssuesByName(review).get(issueName);
    return Boolean(severity && (!filters.severity || severity === filters.severity));
  });
}

export function getIssueSeverity(
  review: AnalyzedReview,
  issueName: IssueName,
): Severity | null {
  return uniqueIssuesByName(review).get(issueName) ?? null;
}
