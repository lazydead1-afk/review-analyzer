import type {
  IssueName,
  Review,
  ReviewIssue,
  Sentiment,
  Severity,
} from "@/types/review";

import { groq } from "@/lib/groq";

export const LLM_PROVIDER = "groq";
export const LLM_MODEL = "openai/gpt-oss-20b";

export class BatchValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BatchValidationError";
  }
}

export const ISSUE_TAXONOMY: IssueName[] = [
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

export type BatchAnalysisItem = {
  id: string;
  sentiment: Sentiment;
  issues: ReviewIssue[];
  isSpam: boolean;
};

type BatchAnalysisResult = Omit<BatchAnalysisItem, "id">;

const batchResponseSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sentiment: {
            type: "string",
            enum: ["positive", "neutral", "negative", "mixed"],
          },
          issues: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  enum: ISSUE_TAXONOMY,
                },
                severity: {
                  type: "string",
                  enum: ["low", "medium", "high"],
                },
              },
              required: ["name", "severity"],
              additionalProperties: false,
            },
          },
          isSpam: {
            type: "boolean",
          },
        },
        required: ["sentiment", "issues", "isSpam"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `
You are a customer-feedback classification system.

Analyze every review in the provided JSON array.

Classify reviews in the exact order provided.

Return a JSON object with a "results" array containing
exactly one result per input review, in the same order.

Do not include review IDs in the results.
Do not skip any review.
Do not add extra results.

Reviews may contain:
- typos
- sarcasm
- multiple languages
- mixed positive and negative feedback

Use the review text as the primary signal.

Classify multilingual reviews directly in their original
language. Do not translate them beforehand.

Sentiment must be exactly one of:
positive, neutral, negative, mixed.

Issue names must come only from this taxonomy:
${ISSUE_TAXONOMY.join(", ")}

A review may have zero, one, or multiple issues.

Severity:

low:
Minor inconvenience, preference, cosmetic issue,
or missing non-essential functionality.

medium:
Meaningful degradation of the customer experience,
repeated frustration, or an important feature
not working correctly.

high:
The customer cannot use the product,
account access is blocked,
major product failure,
lost work,
serious billing or refund impact,
spoiled or unusable delivery,
or similarly severe consequences.

Use "other" only when a meaningful issue does not
fit another category.

Set isSpam to true only for promotional,
meaningless, test, or unrelated junk.

Do not treat non-English reviews as spam.

If meaningful praise and meaningful criticism
are both present, use mixed sentiment.

Do not invent issues unsupported by the text.
`.trim();

function isSentiment(value: unknown): value is Sentiment {
  return (
    value === "positive" ||
    value === "neutral" ||
    value === "negative" ||
    value === "mixed"
  );
}

function isSeverity(value: unknown): value is Severity {
  return value === "low" || value === "medium" || value === "high";
}

function isIssueName(value: unknown): value is IssueName {
  return (
    typeof value === "string" && ISSUE_TAXONOMY.includes(value as IssueName)
  );
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function validateBatchResult(value: unknown): BatchAnalysisResult[] {
  if (!Array.isArray(value)) {
    throw new BatchValidationError("Groq batch response is not an array.");
  }

  return value.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new BatchValidationError("Groq returned an invalid batch item.");
    }

    const candidate = item as Record<string, unknown>;
    const itemLabel = `result ${index + 1}`;

    if (!hasExactKeys(candidate, ["sentiment", "issues", "isSpam"])) {
      throw new BatchValidationError(
        `Groq returned an invalid structure for ${itemLabel}.`,
      );
    }

    if (!isSentiment(candidate.sentiment)) {
      throw new BatchValidationError(`Invalid sentiment for ${itemLabel}.`);
    }

    if (typeof candidate.isSpam !== "boolean") {
      throw new BatchValidationError(`Invalid isSpam for ${itemLabel}.`);
    }

    if (!Array.isArray(candidate.issues)) {
      throw new BatchValidationError(`Invalid issues for ${itemLabel}.`);
    }

    const issues: ReviewIssue[] = candidate.issues.map((issue) => {
      if (typeof issue !== "object" || issue === null) {
        throw new BatchValidationError(`Invalid issue for ${itemLabel}.`);
      }

      const issueValue = issue as Record<string, unknown>;

      if (!hasExactKeys(issueValue, ["name", "severity"])) {
        throw new BatchValidationError(
          `Invalid issue structure for ${itemLabel}.`,
        );
      }

      if (!isIssueName(issueValue.name)) {
        throw new BatchValidationError(
          `Invalid issue name for ${itemLabel}: ${String(issueValue.name)}`,
        );
      }

      if (!isSeverity(issueValue.severity)) {
        throw new BatchValidationError(
          `Invalid severity for ${itemLabel}: ${String(
            issueValue.severity,
          )}`,
        );
      }

      return {
        name: issueValue.name,
        severity: issueValue.severity,
      };
    });

    return {
      sentiment: candidate.sentiment,
      issues,
      isSpam: candidate.isSpam,
    };
  });
}

export async function analyzeReviewBatch(
  reviews: Review[],
): Promise<BatchAnalysisItem[]> {
  const input = reviews.map((review) => ({
    product: review.product,
    source: review.source,
    language: review.language,
    text: review.text,
  }));

  const response = await groq.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `Reviews:\n${JSON.stringify(input)}`,
      },
    ],
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "review_analysis_batch",
        strict: true,
        schema: batchResponseSchema,
      },
    },
  });

  const content = response.choices[0]?.message.content;

  if (!content) {
    throw new BatchValidationError("Groq returned an empty response.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new BatchValidationError("Groq returned invalid JSON.", {
      cause: error,
    });
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !hasExactKeys(parsed as Record<string, unknown>, ["results"])
  ) {
    throw new BatchValidationError(
      "Groq response does not contain a results array.",
    );
  }

  const result = validateBatchResult(
    (parsed as Record<string, unknown>).results,
  );

  if (result.length !== reviews.length) {
    throw new BatchValidationError(
      `Groq returned ${result.length} results for ${reviews.length} reviews.`,
    );
  }

  return result.map((item, index) => ({
    id: reviews[index].id,
    ...item,
  }));
}
