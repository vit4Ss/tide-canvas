import { HeroSection } from "@/components/home/hero-section";
import { RecentProjects } from "@/components/home/recent-projects";
import { FeaturedWorks } from "@/components/home/featured-works";

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <RecentProjects />
      <FeaturedWorks />
    </>
  );
}
