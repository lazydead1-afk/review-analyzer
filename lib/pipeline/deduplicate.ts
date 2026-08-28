import type { Review } from "@/types/review";
import { normalizeText } from "@/lib/pipeline/clean";

// --------------------------------------------------
// РЕЗУЛЬТАТ DEDUPLICATION
// --------------------------------------------------
//
// Для каждого review мы сохраняем:
//
// unique
//   → считаем самостоятельным отзывом
//
// duplicate
//   → считаем копией другого review
//
// duplicateOf:
// id оригинального review
//
export type DeduplicationResult = {
  review: Review;

  status: "unique" | "duplicate";

  duplicateOf: string | null;

  similarity: number;

  method: "none" | "exact" | "near";
};

// --------------------------------------------------
// НОРМАЛИЗАЦИЯ ДЛЯ СРАВНЕНИЯ
// --------------------------------------------------
//
// normalizeText из clean.ts уже делает:
//
// trim()
// lowercase
// удаление лишних пробелов
//
// Здесь дополнительно убираем пунктуацию.
//
// Поэтому:
//
// "App crashes every day!"
//
// и:
//
// "app crashes every day."
//
// станут почти одинаковыми.
//
function normalizeForDeduplication(text: string): string {
  return normalizeText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --------------------------------------------------
// РАЗБИВАЕМ СТРОКУ НА СЛОВА
// --------------------------------------------------
//
// "battery dies after one hour"
//
// превращается:
//
// [
//   "battery",
//   "dies",
//   "after",
//   "one",
//   "hour"
// ]
//
function tokenize(text: string): string[] {
  return normalizeForDeduplication(text).split(" ").filter(Boolean);
}

// --------------------------------------------------
// JACCARD SIMILARITY
// --------------------------------------------------
//
// Это простой алгоритм сравнения наборов слов.
//
// Пример:
//
// A:
// battery dies after one hour
//
// B:
// battery dies after an hour
//
// Большинство слов совпадают.
//
// Получаем similarity примерно от:
//
// 0 → вообще не похожи
//
// до:
//
// 1 → одинаковы
//
function calculateJaccardSimilarity(textA: string, textB: string): number {
  const wordsA = new Set(tokenize(textA));
  const wordsB = new Set(tokenize(textB));

  // Если по какой-то причине набор пустой —
  // не считаем тексты похожими.
  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0;
  }

  // intersection =
  // слова, которые есть в ОБОИХ текстах.
  const intersection = new Set([...wordsA].filter((word) => wordsB.has(word)));

  // union =
  // все уникальные слова из обоих текстов.
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

// --------------------------------------------------
// EXACT DUPLICATE
// --------------------------------------------------
//
// После нормализации сравниваем две строки.
//
// Например:
//
// "App crashes."
//
// и
//
// "  app crashes.  "
//
// будут одинаковыми.
//
function isExactDuplicate(reviewA: Review, reviewB: Review): boolean {
  return (
    normalizeForDeduplication(reviewA.text) ===
    normalizeForDeduplication(reviewB.text)
  );
}

// --------------------------------------------------
// NEAR DUPLICATE
// --------------------------------------------------
//
// Здесь начинаем работать осторожно.
//
// Мы НЕ хотим принять два обычных похожих отзыва
// за cross-post.
//
// Поэтому есть несколько ограничений.
//
function calculateNearSimilarity(reviewA: Review, reviewB: Review): number {
  // ------------------------------------------------
  // RULE 1
  //
  // Сравниваем только отзывы одного продукта.
  //
  // Если продукты разные — это не duplicate.
  // ------------------------------------------------

  if (reviewA.product !== reviewB.product) {
    return 0;
  }

  // ------------------------------------------------
  // RULE 2
  //
  // Cross-post обычно приходит из разных каналов.
  //
  // Например:
  //
  // trustpilot
  // google_play
  //
  // Если источник один и тот же,
  // мы пока не считаем это cross-post.
  // ------------------------------------------------

  if (reviewA.source === reviewB.source) {
    return 0;
  }

  const normalizedA = normalizeForDeduplication(reviewA.text);

  const normalizedB = normalizeForDeduplication(reviewB.text);

  // ------------------------------------------------
  // RULE 3
  //
  // Очень короткие тексты опасно fuzzy-match'ить.
  //
  // "Great app"
  // "Great app"
  //
  // могут быть написаны разными людьми.
  //
  // Поэтому near-dedup применяем только
  // к достаточно содержательным отзывам.
  // ------------------------------------------------

  if (normalizedA.length < 25 || normalizedB.length < 25) {
    return 0;
  }

  return calculateJaccardSimilarity(normalizedA, normalizedB);
}

// --------------------------------------------------
// ОСНОВНОЙ АЛГОРИТМ
// --------------------------------------------------
export function deduplicateReviews(reviews: Review[]): DeduplicationResult[] {
  const results: DeduplicationResult[] = [];

  // Здесь храним только те reviews,
  // которые уже признаны уникальными.
  //
  // Все следующие отзывы сравниваем с ними.
  const uniqueReviews: Review[] = [];

  for (const review of reviews) {
    let duplicateOf: string | null = null;

    let similarity = 0;

    let method: "none" | "exact" | "near" = "none";

    // ----------------------------------------------
    // Сравниваем текущий review
    // со всеми предыдущими уникальными.
    // ----------------------------------------------

    for (const candidate of uniqueReviews) {
      // --------------------------------------------
      // НИКОГДА не объединяем разные продукты.
      // --------------------------------------------

      if (review.product !== candidate.product) {
        continue;
      }

      // --------------------------------------------
      // Ищем cross-post между разными источниками.
      // --------------------------------------------

      if (review.source === candidate.source) {
        continue;
      }

      // ============================================
      // LEVEL 1 — EXACT DUPLICATE
      // ============================================

      if (isExactDuplicate(review, candidate)) {
        duplicateOf = candidate.id;

        similarity = 1;

        method = "exact";

        break;
      }

      // ============================================
      // LEVEL 2 — NEAR DUPLICATE
      // ============================================

      const candidateSimilarity = calculateNearSimilarity(review, candidate);

      // Очень высокий threshold специально.
      //
      // Лучше пропустить несколько дублей,
      // чем ошибочно объединить два разных отзыва.
      //
      // Это precision-first подход.
      if (candidateSimilarity >= 0.85) {
        duplicateOf = candidate.id;

        similarity = candidateSimilarity;

        method = "near";

        break;
      }
    }

    // ----------------------------------------------
    // Если нашли duplicate.
    // ----------------------------------------------

    if (duplicateOf) {
      results.push({
        review,
        status: "duplicate",
        duplicateOf,
        similarity,
        method,
      });

      continue;
    }

    // ----------------------------------------------
    // Если duplicate не нашли —
    // отзыв становится новым оригиналом.
    // ----------------------------------------------

    uniqueReviews.push(review);

    results.push({
      review,
      status: "unique",
      duplicateOf: null,
      similarity: 0,
      method: "none",
    });
  }

  return results;
}
