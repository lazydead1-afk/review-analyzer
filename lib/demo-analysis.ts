import { getReviews } from "@/lib/reviews";
import type {
  AnalyzedReview,
  ReviewIssue,
  Sentiment,
} from "@/types/review";

type DemoLabel = {
  sentiment: Sentiment;
  issues: ReviewIssue[];
};

const demoLabels: Record<string, DemoLabel> = {
  r_110470cdab: {
    sentiment: "negative",
    issues: [{ name: "battery", severity: "high" }],
  },
  r_2756ae4dd7: {
    sentiment: "mixed",
    issues: [{ name: "battery", severity: "medium" }],
  },
  r_b93deaf343: {
    sentiment: "mixed",
    issues: [{ name: "pricing", severity: "medium" }],
  },
  r_a47ed874be: {
    sentiment: "negative",
    issues: [
      { name: "app_crash", severity: "high" },
      { name: "customer_support", severity: "medium" },
    ],
  },
  r_582a747605: {
    sentiment: "negative",
    issues: [
      { name: "delivery", severity: "high" },
      { name: "usability", severity: "low" },
    ],
  },
  r_0bac3018ff: {
    sentiment: "mixed",
    issues: [{ name: "missing_items", severity: "high" }],
  },
  r_c6377e8163: {
    sentiment: "negative",
    issues: [{ name: "refund", severity: "high" }],
  },
  r_aa642f3159: {
    sentiment: "mixed",
    issues: [{ name: "missing_feature", severity: "low" }],
  },
  r_7720d1096f: {
    sentiment: "positive",
    issues: [],
  },
};

export function getDemoAnalyzedReviews(): AnalyzedReview[] {
  const reviewsById = new Map(getReviews().map((review) => [review.id, review]));

  return Object.entries(demoLabels).map(([id, analysis]) => {
    const review = reviewsById.get(id);

    if (!review) {
      throw new Error(`Demo review ${id} was not found in reviews.json.`);
    }

    return {
      ...review,
      ...analysis,
      isSpam: false,
      duplicateOf: null,
    };
  });
}
