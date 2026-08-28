// ==================================================
// RAW REVIEW
// ==================================================
//
// Это структура исходных данных из reviews.json.
//

export type Review = {
  id: string;

  product: string;

  source:
    | "app_store"
    | "google_play"
    | "trustpilot"
    | "post_purchase_email"
    | "support_chat";

  rating: number | null;

  language: string;

  text: string;
};

// ==================================================
// SENTIMENT
// ==================================================

export type Sentiment = "positive" | "neutral" | "negative" | "mixed";

// ==================================================
// SEVERITY
// ==================================================

export type Severity = "low" | "medium" | "high";

// ==================================================
// ISSUE TAXONOMY
// ==================================================
//
// Это наш нормализованный словарь проблем.
//
// Почему он нужен:
//
// без taxonomy AI может написать:
//
// battery
// battery_problem
// poor_battery
// charging_issue
//
// и aggregation развалится.
//
// Поэтому модель должна выбирать одну
// категорию из нашего списка.
//

export type IssueName =
  | "account_access"
  | "app_crash"
  | "performance"
  | "sync"
  | "battery"
  | "charging"
  | "hardware_failure"
  | "delivery"
  | "missing_items"
  | "food_quality"
  | "customer_support"
  | "billing"
  | "refund"
  | "pricing"
  | "subscription"
  | "usability"
  | "missing_feature"
  | "other";

// ==================================================
// ONE ISSUE
// ==================================================

export type ReviewIssue = {
  name: IssueName;

  severity: Severity;
};

// ==================================================
// ANALYZED REVIEW
// ==================================================
//
// Исходный Review + структурированный AI-анализ.
//

export type AnalyzedReview = Review & {
  sentiment: Sentiment;

  issues: ReviewIssue[];

  isSpam: boolean;

  duplicateOf: string | null;
};
