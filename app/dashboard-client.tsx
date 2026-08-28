"use client";

import { useMemo, useState } from "react";

import {
  aggregateIssues,
  getIssueSeverity,
  getReviewsForIssue,
} from "@/lib/pipeline/aggregate";
import type { ReviewDataSource } from "@/lib/processed-reviews";
import type {
  AnalyzedReview,
  IssueName,
  Severity,
} from "@/types/review";

type DashboardClientProps = {
  reviews: AnalyzedReview[];
  source: ReviewDataSource;
};

const severityStyles: Record<Severity, string> = {
  low: "border-sky-400/20 bg-sky-400/10 text-sky-300",
  medium: "border-amber-400/20 bg-amber-400/10 text-amber-300",
  high: "border-rose-400/20 bg-rose-400/10 text-rose-300",
};

const sentimentStyles: Record<AnalyzedReview["sentiment"], string> = {
  positive: "bg-emerald-400/10 text-emerald-300",
  neutral: "bg-slate-400/10 text-slate-300",
  negative: "bg-rose-400/10 text-rose-300",
  mixed: "bg-violet-400/10 text-violet-300",
};

function formatLabel(value: string) {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function DashboardClient({
  reviews,
  source,
}: DashboardClientProps) {
  const [product, setProduct] = useState("all");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [selectedIssue, setSelectedIssue] = useState<IssueName | null>(null);

  const products = useMemo(
    () => [...new Set(reviews.map((review) => review.product))].sort(),
    [reviews],
  );
  const filters = useMemo(
    () => ({
      product: product === "all" ? undefined : product,
      severity: severity === "all" ? undefined : severity,
    }),
    [product, severity],
  );
  const issueSummaries = useMemo(
    () => aggregateIssues(reviews, filters),
    [reviews, filters],
  );
  const filteredReviews = useMemo(
    () =>
      product === "all"
        ? reviews
        : reviews.filter((review) => review.product === product),
    [reviews, product],
  );
  const activeIssue = issueSummaries.some(
    (summary) => summary.name === selectedIssue,
  )
    ? selectedIssue
    : null;
  const totalIssueInstances = issueSummaries.reduce(
    (total, issue) => total + issue.affectedReviewCount,
    0,
  );
  const highSeverityInstances = issueSummaries.reduce(
    (total, issue) => total + issue.severityCounts.high,
    0,
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:py-12">
        <header className="flex flex-col gap-5 border-b border-slate-800 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-400">
              Customer intelligence
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Review Analyzer
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
              Prioritized customer issues with direct access to the feedback
              behind each signal.
            </p>
          </div>

          <span
            className={`w-fit rounded-full border px-3 py-1.5 text-xs font-semibold ${
              source === "processed"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                : "border-amber-400/30 bg-amber-400/10 text-amber-300"
            }`}
          >
            {source === "processed" ? "Groq processed data" : "Demo data"}
          </span>
        </header>

        {source === "demo" && (
          <div className="mt-6 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-100">
            Showing a small deterministic demo subset derived from reviews.json.
            Run the batch analyzer to replace it with complete processed data.
          </div>
        )}

        <section
          aria-label="Summary"
          className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {[
            ["Analyzed reviews", filteredReviews.length],
            ["Issue instances", totalIssueInstances],
            ["High severity", highSeverityInstances],
            [
              "Products represented",
              new Set(filteredReviews.map((review) => review.product)).size,
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg shadow-black/10"
            >
              <p className="text-sm text-slate-400">{label}</p>
              <p className="mt-2 text-3xl font-bold text-white">{value}</p>
            </div>
          ))}
        </section>

        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-300">
              Product
              <select
                value={product}
                onChange={(event) => setProduct(event.target.value)}
                className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
              >
                <option value="all">All products</option>
                {products.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium text-slate-300">
              Severity
              <select
                value={severity}
                onChange={(event) =>
                  setSeverity(event.target.value as Severity | "all")
                }
                className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
              >
                <option value="all">All severities</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
          </div>
        </section>

        <section className="mt-10">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-white">Top issues</h2>
              <p className="mt-1 text-sm text-slate-400">
                Ranked by affected reviews, then by severity.
              </p>
            </div>
            <span className="text-sm text-slate-500">
              {issueSummaries.length} issue categories
            </span>
          </div>

          <div className="mt-5 space-y-3">
            {issueSummaries.map((issue, index) => {
              const isOpen = activeIssue === issue.name;
              const underlyingReviews = isOpen
                ? getReviewsForIssue(reviews, issue.name, filters)
                : [];
              const productBreakdown = Object.entries(
                issue.productBreakdown,
              ).sort(
                ([leftProduct, leftCount], [rightProduct, rightCount]) =>
                  rightCount - leftCount ||
                  leftProduct.localeCompare(rightProduct),
              );

              return (
                <article
                  key={issue.name}
                  className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setSelectedIssue(isOpen ? null : issue.name)
                    }
                    className="w-full cursor-pointer p-4 text-left hover:bg-slate-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400 sm:p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-4">
                        <span className="mt-1 text-sm font-semibold text-slate-500">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <h3 className="text-lg font-semibold text-white">
                            {formatLabel(issue.name)}
                          </h3>
                          <p className="mt-1 text-sm text-slate-400">
                            <span className="text-xl font-bold text-white">
                              {issue.affectedReviewCount}
                            </span>{" "}
                            affected{" "}
                            {issue.affectedReviewCount === 1
                              ? "review"
                              : "reviews"}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-cyan-400" aria-hidden="true">
                        {isOpen ? "Hide reviews ↑" : "View reviews ↓"}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-4 border-t border-slate-800 pt-4 lg:grid-cols-[1fr_1fr_1.4fr]">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Severity
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(["high", "medium", "low"] as const)
                            .filter((level) => issue.severityCounts[level] > 0)
                            .map(
                            (level) => (
                              <span
                                key={level}
                                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${severityStyles[level]}`}
                              >
                                {formatLabel(level)}{" "}
                                {issue.severityCounts[level]}
                              </span>
                            ),
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Products
                        </p>
                        <div className="mt-2 space-y-1 text-sm text-slate-300">
                          {productBreakdown.map(([item, count]) => (
                            <p key={item}>
                              {item}{" "}
                              <span className="text-slate-500">· {count}</span>
                            </p>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Representative feedback
                        </p>
                        <div className="mt-2 space-y-2">
                          {issue.representativeQuotes.map((quote) => (
                            <blockquote
                              key={quote.reviewId}
                              className="border-l-2 border-slate-700 pl-3 text-sm leading-5 text-slate-300"
                            >
                              “{quote.text}”
                            </blockquote>
                          ))}
                        </div>
                      </div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-800 bg-slate-950/60 p-4 sm:p-5">
                      <h4 className="font-semibold text-white">
                        Underlying reviews
                      </h4>
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        {underlyingReviews.map((review) => {
                          const issueSeverity = getIssueSeverity(
                            review,
                            issue.name,
                          );

                          return (
                            <div
                              key={review.id}
                              className="rounded-xl border border-slate-800 bg-slate-900 p-4"
                            >
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-medium text-slate-200">
                                  {review.product}
                                </span>
                                <span className="text-slate-600">·</span>
                                <span className="text-slate-400">
                                  {formatLabel(review.source)}
                                </span>
                                <span
                                  className={`rounded-full px-2 py-0.5 ${sentimentStyles[review.sentiment]}`}
                                >
                                  {formatLabel(review.sentiment)}
                                </span>
                                {issueSeverity && (
                                  <span
                                    className={`rounded-full border px-2 py-0.5 ${severityStyles[issueSeverity]}`}
                                  >
                                    {formatLabel(issueSeverity)} severity
                                  </span>
                                )}
                              </div>
                              <p className="mt-3 text-sm leading-6 text-slate-300">
                                {review.text}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}

            {issueSummaries.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center text-slate-400">
                No issues match the selected filters.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
