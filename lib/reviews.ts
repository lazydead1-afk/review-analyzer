// Подключаем настоящий JSON-файл.
import reviewsData from "@/data/reviews.json";

// Подключаем созданный нами TypeScript-тип.
import type { Review } from "@/types/review";

// Эта функция является одной точкой,
// через которую остальное приложение получает отзывы.
//
// Сейчас источник — reviews.json.
//
// Позже можно заменить источник:
// database
// API
// uploaded JSON
//
// Остальной код приложения менять не придётся.
export function getReviews(): Review[] {
  return reviewsData as Review[];
}
