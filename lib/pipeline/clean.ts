import type { Review } from "@/types/review";

// Результат проверки одного отзыва.
//
// Мы НЕ удаляем отзыв бесследно.
// Мы сохраняем:
// - прошёл он проверку или нет
// - по какой причине он был отклонён
//
// Это полезно для отладки и для WRITEUP.
export type CleanResult = {
  review: Review;

  normalizedText: string;

  status: "valid" | "empty" | "junk" | "spam";

  reason: string | null;
};

// --------------------------------------------------
// НОРМАЛИЗАЦИЯ ТЕКСТА
// --------------------------------------------------
//
// Пример:
//
// "   Battery DIES!!!   "
//
// превращается примерно в:
//
// "battery dies!!!"
//
// Мы специально НЕ исправляем опечатки.
// "payign" останется "payign".
//
// Почему?
//
// Потому что clean layer должен быть максимально
// безопасным и предсказуемым.
//
// Смысл текста позже будет понимать LLM.
//
export function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// --------------------------------------------------
// ПРОВЕРКА НА ПУСТОЙ ТЕКСТ
// --------------------------------------------------
function isEmptyText(text: string): boolean {
  return text.length === 0;
}

// --------------------------------------------------
// ПРОВЕРКА НА ОЧЕВИДНЫЙ JUNK
// --------------------------------------------------
//
// Здесь мы ловим только очень очевидный мусор.
//
// ВАЖНО:
// мы не должны удалять нормальный короткий отзыв
// просто потому, что он короткий.
//
// Например:
//
// "App crashes"
//
// короткий, но полезный.
//
// Поэтому правила должны быть консервативными.
//
function isObviousJunk(text: string): boolean {
  const junkValues = ["n/a", "na", "none", "null", "test", "testing"];

  if (junkValues.includes(text)) {
    return true;
  }

  // Строки вроде:
  // "asdkjfh asdf test test ignore"
  //
  // Простая эвристика:
  // если текст содержит явный набор тестовых слов.
  if (
    text.includes("test test") ||
    text.includes("asdf") ||
    text.includes("asdk")
  ) {
    return true;
  }

  return false;
}

// --------------------------------------------------
// ПРОВЕРКА НА ОЧЕВИДНЫЙ SPAM
// --------------------------------------------------
//
// Здесь тоже не пытаемся построить идеальный
// антиспам.
//
// Мы убираем только наиболее очевидные случаи.
//
// Остальное при необходимости сможет оценить LLM.
//
function isObviousSpam(text: string): boolean {
  const spamSignals = [
    "buy followers",
    "cheap followers",
    "dm me",
    "follow me",
    "promo code",
    "click here",
  ];

  return spamSignals.some((signal) => text.includes(signal));
}

// --------------------------------------------------
// ПРОВЕРКА ОДНОГО ОТЗЫВА
// --------------------------------------------------
export function cleanReview(review: Review): CleanResult {
  const normalizedText = normalizeText(review.text);

  // 1. Пустая строка
  if (isEmptyText(normalizedText)) {
    return {
      review,
      normalizedText,
      status: "empty",
      reason: "Review text is empty",
    };
  }

  // 2. Явный мусор
  if (isObviousJunk(normalizedText)) {
    return {
      review,
      normalizedText,
      status: "junk",
      reason: "Review matches an obvious junk pattern",
    };
  }

  // 3. Явный spam
  if (isObviousSpam(normalizedText)) {
    return {
      review,
      normalizedText,
      status: "spam",
      reason: "Review matches an obvious spam pattern",
    };
  }

  // 4. Если ничего плохого не нашли —
  // отзыв проходит дальше.
  return {
    review,
    normalizedText,
    status: "valid",
    reason: null,
  };
}

// --------------------------------------------------
// ПРОВЕРКА СРАЗУ ВСЕГО МАССИВА
// --------------------------------------------------
export function cleanReviews(reviews: Review[]): CleanResult[] {
  return reviews.map(cleanReview);
}
