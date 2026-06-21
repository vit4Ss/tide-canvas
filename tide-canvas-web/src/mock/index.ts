// Barrel for the liuguang mock data.
//
// The design is 100% mock; pages import from "@/mock" now and swap to the real
// API later. Covers/avatars are raw hue triplets — derive CSS via `mesh()` /
// `coverBg()` (re-exported below), never hardcode gradient strings.

// Shared types
export type {
  MeshHues,
  Artwork,
  ArtworkType,
  ArtworkCategory,
  MarketModel,
  ModelBadge,
  Cap,
  Step,
  Creator,
  Testimonial,
  Faq,
  Plan,
  ComparisonRow,
} from "./types";

// Cover helpers
export { mesh, coverBg, fmt } from "./cover";

// Artworks feed
export { ARTWORKS } from "./artworks";

// Model marketplace
export { MODELS, BASES, MODEL_NAMES, CREATE_MODELS } from "./models";

// Home sections
export {
  CATEGORIES,
  CAPS,
  STEPS,
  CREATORS,
  TESTIMONIALS,
  FAQS,
  HERO_PROMPTS,
} from "./home";

// Pricing
export { PLANS, CMP, PRICING_FAQS } from "./pricing";
