import Pricing from "@/components/pricing";
import { getPublicModels, getPublicPlans, getPublicConsumer } from "@/lib/public-info.server";
import { pricingExamples } from "@/lib/public-pricing";
export default async function PricingPage() {
  const [plans, models, info] = await Promise.all([getPublicPlans(), getPublicModels(), getPublicConsumer()]);
  return <Pricing initialPlans={plans} examples={pricingExamples(models)} initialInfo={info} />;
}

export const metadata = { title: "Pricing" };
