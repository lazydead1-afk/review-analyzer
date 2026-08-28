import fs from "node:fs";
import path from "node:path";

import { ISSUE_NAMES } from "../lib/pipeline/aggregate";
import type {
  IssueName,
  ReviewIssue,
  Sentiment,
  Severity,
} from "../types/review";

type EvaluationLabel = {
  id: string;
  expectedSentiment: Sentiment;
  expectedIssues: ReviewIssue[];
  note?: string;
};

type Prediction = {
  id: string;
  sentiment: Sentiment;
  issues: ReviewIssue[];
};

type PredictionSource = "processed-reviews.json" | "analysis-checkpoint.json" | "none";

const sentiments = new Set<Sentiment>([
  "positive",
  "neutral",
  "negative",
  "mixed",
]);
const severities = new Set<Severity>(["low", "medium", "high"]);
const issueNames = new Set<IssueName>(ISSUE_NAMES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseIssues(value: unknown, context: string): ReviewIssue[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} issues must be an array.`);
  }

  const seenNames = new Set<IssueName>();

  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.name !== "string" ||
      !issueNames.has(item.name as IssueName) ||
      typeof item.severity !== "string" ||
      !severities.has(item.severity as Severity)
    ) {
      throw new Error(`${context} contains an invalid issue.`);
    }

    const name = item.name as IssueName;

    if (seenNames.has(name)) {
      throw new Error(`${context} contains duplicate issue ${name}.`);
    }

    seenNames.add(name);

    return {
      name,
      severity: item.severity as Severity,
    };
  });
}

function loadLabels(filePath: string, reviewIds: Set<string>): EvaluationLabel[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (!isRecord(parsed) || !Array.isArray(parsed.labels)) {
    throw new Error("Evaluation labels file must contain a labels array.");
  }

  const seenIds = new Set<string>();

  return parsed.labels.map((value, index) => {
    const context = `Label ${index + 1}`;

    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.expectedSentiment !== "string" ||
      !sentiments.has(value.expectedSentiment as Sentiment) ||
      (value.note !== undefined && typeof value.note !== "string")
    ) {
      throw new Error(`${context} is invalid.`);
    }

    if (!reviewIds.has(value.id)) {
      throw new Error(`${context} references unknown review ID ${value.id}.`);
    }

    if (seenIds.has(value.id)) {
      throw new Error(`Duplicate evaluation review ID ${value.id}.`);
    }

    seenIds.add(value.id);

    return {
      id: value.id,
      expectedSentiment: value.expectedSentiment as Sentiment,
      expectedIssues: parseIssues(value.expectedIssues, context),
      note: value.note as string | undefined,
    };
  });
}

function parsePredictions(value: unknown, source: string): Prediction[] {
  if (!Array.isArray(value)) {
    throw new Error(`${source} must contain an array of predictions.`);
  }

  const seenIds = new Set<string>();

  return value.map((item, index) => {
    const context = `${source} prediction ${index + 1}`;

    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.sentiment !== "string" ||
      !sentiments.has(item.sentiment as Sentiment)
    ) {
      throw new Error(`${context} is invalid.`);
    }

    if (seenIds.has(item.id)) {
      throw new Error(`${source} contains duplicate review ID ${item.id}.`);
    }

    seenIds.add(item.id);

    return {
      id: item.id,
      sentiment: item.sentiment as Sentiment,
      issues: parseIssues(item.issues, context),
    };
  });
}

function loadPredictions(dataDirectory: string): {
  predictions: Prediction[];
  source: PredictionSource;
} {
  const processedPath = path.join(dataDirectory, "processed-reviews.json");

  if (fs.existsSync(processedPath)) {
    const parsed: unknown = JSON.parse(fs.readFileSync(processedPath, "utf8"));

    if (!isRecord(parsed)) {
      throw new Error("processed-reviews.json must be a JSON object.");
    }

    return {
      predictions: parsePredictions(parsed.reviews, "processed-reviews.json"),
      source: "processed-reviews.json",
    };
  }

  const checkpointPath = path.join(dataDirectory, "analysis-checkpoint.json");

  if (fs.existsSync(checkpointPath)) {
    const parsed: unknown = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));

    if (!isRecord(parsed)) {
      throw new Error("analysis-checkpoint.json must be a JSON object.");
    }

    return {
      predictions: parsePredictions(
        parsed.analyses,
        "analysis-checkpoint.json",
      ),
      source: "analysis-checkpoint.json",
    };
  }

  return { predictions: [], source: "none" };
}

function issueMap(issues: ReviewIssue[]) {
  return new Map(issues.map((issue) => [issue.name, issue.severity]));
}

function formatIssues(issues: ReviewIssue[]) {
  if (issues.length === 0) {
    return "none";
  }

  return issues.map((issue) => `${issue.name}:${issue.severity}`).join(", ");
}

function formatRatio(numerator: number, denominator: number) {
  if (denominator === 0) {
    return "N/A";
  }

  return `${((numerator / denominator) * 100).toFixed(1)}% (${numerator}/${denominator})`;
}

function formatF1(truePositives: number, falsePositives: number, falseNegatives: number) {
  const denominator = 2 * truePositives + falsePositives + falseNegatives;

  if (denominator === 0) {
    return "N/A";
  }

  return `${((2 * truePositives * 100) / denominator).toFixed(1)}%`;
}

function main() {
  const projectDirectory = process.cwd();
  const dataDirectory = path.join(projectDirectory, "data");
  const rawReviews: unknown = JSON.parse(
    fs.readFileSync(path.join(dataDirectory, "reviews.json"), "utf8"),
  );

  if (!Array.isArray(rawReviews)) {
    throw new Error("reviews.json must contain an array.");
  }

  const reviewIds = new Set(
    rawReviews
      .filter((review) => isRecord(review) && typeof review.id === "string")
      .map((review) => (review as Record<string, unknown>).id as string),
  );
  const labels = loadLabels(
    path.join(projectDirectory, "evaluation", "labels.json"),
    reviewIds,
  );
  const { predictions, source } = loadPredictions(dataDirectory);
  const predictionsById = new Map(
    predictions.map((prediction) => [prediction.id, prediction]),
  );

  let predictedCases = 0;
  let sentimentCorrect = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let matchedIssueNames = 0;
  let severityCorrect = 0;
  const missingIds: string[] = [];
  const disagreements = {
    sentimentMismatch: [] as string[],
    missedIssue: [] as string[],
    extraIssue: [] as string[],
    severityMismatch: [] as string[],
  };

  console.log("");
  console.log("Review Analyzer Evaluation");
  console.log("========================================");
  console.log(`Prediction source: ${source}`);
  console.log("");
  console.log("Per-review results");
  console.log("----------------------------------------");

  for (const label of labels) {
    const prediction = predictionsById.get(label.id);

    if (!prediction) {
      missingIds.push(label.id);
      console.log(`[MISSING] ${label.id}`);
      console.log(`  Expected sentiment: ${label.expectedSentiment}`);
      console.log(`  Expected issues: ${formatIssues(label.expectedIssues)}`);
      continue;
    }

    predictedCases += 1;
    const expectedIssues = issueMap(label.expectedIssues);
    const predictedIssues = issueMap(prediction.issues);
    const sentimentPass = prediction.sentiment === label.expectedSentiment;
    const expectedNames = new Set(expectedIssues.keys());
    const predictedNames = new Set(predictedIssues.keys());
    const missedNames = [...expectedNames].filter(
      (name) => !predictedNames.has(name),
    );
    const extraNames = [...predictedNames].filter(
      (name) => !expectedNames.has(name),
    );
    const matchedNames = [...expectedNames].filter((name) =>
      predictedNames.has(name),
    );
    const severityMismatches = matchedNames.filter(
      (name) => expectedIssues.get(name) !== predictedIssues.get(name),
    );
    const issueNamesPass = missedNames.length === 0 && extraNames.length === 0;
    const severityPass = severityMismatches.length === 0;
    const overallPass = sentimentPass && issueNamesPass && severityPass;

    if (sentimentPass) {
      sentimentCorrect += 1;
    } else {
      disagreements.sentimentMismatch.push(label.id);
    }

    truePositives += matchedNames.length;
    falsePositives += extraNames.length;
    falseNegatives += missedNames.length;
    matchedIssueNames += matchedNames.length;
    severityCorrect += matchedNames.length - severityMismatches.length;

    if (missedNames.length > 0) {
      disagreements.missedIssue.push(
        `${label.id}: ${missedNames.join(", ")}`,
      );
    }

    if (extraNames.length > 0) {
      disagreements.extraIssue.push(
        `${label.id}: ${extraNames.join(", ")}`,
      );
    }

    if (severityMismatches.length > 0) {
      disagreements.severityMismatch.push(
        ...severityMismatches.map(
          (name) =>
            `${label.id}: ${name} expected ${expectedIssues.get(name)}, predicted ${predictedIssues.get(name)}`,
        ),
      );
    }

    console.log(`[${overallPass ? "PASS" : "FAIL"}] ${label.id}`);
    console.log(
      `  Sentiment: ${label.expectedSentiment} -> ${prediction.sentiment} [${sentimentPass ? "PASS" : "FAIL"}]`,
    );
    console.log(`  Expected issues: ${formatIssues(label.expectedIssues)}`);
    console.log(`  Predicted issues: ${formatIssues(prediction.issues)}`);
    console.log(
      `  Issue names: ${issueNamesPass ? "PASS" : "FAIL"}; severity: ${severityPass ? "PASS" : "FAIL"}`,
    );
  }

  console.log("");
  console.log("Metrics");
  console.log("----------------------------------------");
  console.log(`Evaluation cases total: ${labels.length}`);
  console.log(`Cases with predictions: ${predictedCases}`);
  console.log(`Missing predictions: ${missingIds.length}`);
  console.log(
    `Sentiment accuracy: ${formatRatio(sentimentCorrect, predictedCases)}`,
  );
  console.log(
    `Issue precision: ${formatRatio(truePositives, truePositives + falsePositives)}`,
  );
  console.log(
    `Issue recall: ${formatRatio(truePositives, truePositives + falseNegatives)}`,
  );
  console.log(
    `Issue F1: ${formatF1(truePositives, falsePositives, falseNegatives)}`,
  );
  console.log(
    `Severity accuracy: ${formatRatio(severityCorrect, matchedIssueNames)}`,
  );

  console.log("");
  console.log("Failure analysis");
  console.log("----------------------------------------");

  if (missingIds.length > 0) {
    console.log(`Missing prediction (${missingIds.length}): ${missingIds.join(", ")}`);
  }

  const observedDisagreements = Object.entries(disagreements).filter(
    ([, values]) => values.length > 0,
  );

  if (observedDisagreements.length === 0) {
    console.log("No disagreement types observed in predicted cases.");
  } else {
    const labelsByType: Record<keyof typeof disagreements, string> = {
      sentimentMismatch: "Sentiment mismatch",
      missedIssue: "Missed issue",
      extraIssue: "Extra issue",
      severityMismatch: "Severity mismatch",
    };

    for (const [type, values] of observedDisagreements) {
      const label = labelsByType[type as keyof typeof disagreements];
      console.log(`${label} (${values.length}):`);

      for (const value of values) {
        console.log(`  - ${value}`);
      }
    }
  }

  console.log("");
  console.log("Metric definitions");
  console.log("----------------------------------------");
  console.log("Sentiment accuracy uses exact sentiment equality on predicted cases.");
  console.log("Issues match by exact normalized issue name using micro-averaged counts.");
  console.log("Severity is scored only for issue names present in both expected and predicted sets.");
  console.log("Missing predictions are reported and excluded from agreement denominators.");
}

try {
  main();
} catch (error) {
  console.error("");
  console.error("Evaluation failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
