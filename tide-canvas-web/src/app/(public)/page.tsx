import { CreativeHero } from "@/components/home/creative-hero";
import { RecentProjects } from "@/components/home/recent-projects";
import { FeaturedWorks } from "@/components/home/featured-works";

export default function HomePage() {
  return (
    <>
      <CreativeHero />
      <RecentProjects />
      <FeaturedWorks />
    </>
  );
}
