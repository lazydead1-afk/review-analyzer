import { connection } from "next/server";

import DashboardClient from "@/app/dashboard-client";
import { getProcessedReviewData } from "@/lib/processed-reviews";

export default async function Home() {
  await connection();

  const data = getProcessedReviewData();

  return <DashboardClient reviews={data.reviews} source={data.source} />;
}
