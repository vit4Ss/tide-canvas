export interface ShowcaseReference {
  id: string;
  title: string;
  category: string;
  alt: string;
  src: string;
  width: number;
  prompt: string;
}

// Photographic references with authored starting prompts, not generated outputs.
export const SHOWCASE_ROWS: ShowcaseReference[][] = [
  [
    { id: "fragrance", title: "Make the ordinary iconic.", category: "Product", alt: "Glass perfume bottle in pale blue studio light", src: "/art/showcase/fragrance.webp", width: 320, prompt: "An unbranded glass perfume bottle on a pale blue background, warm amber liquid, soft studio light, crisp reflections, elegant minimal product photography." },
    { id: "sneakers", title: "A bolder kind of everyday.", category: "Product", alt: "Red running shoe photographed against a red background", src: "/art/showcase/sneakers.webp", width: 240, prompt: "A sculptural red running shoe without logos, suspended above a red studio surface, dramatic directional lighting, tactile knit fabric, bold editorial product photography." },
    { id: "forest", title: "Take the quiet way.", category: "Nature", alt: "Morning mist drifting between tall forest trees", src: "/art/showcase/forest.webp", width: 200, prompt: "A quiet evergreen forest at dawn, mist drifting between tall trees, soft shafts of morning light, rich moss and fern textures, atmospheric nature photography." },
    { id: "ramen", title: "Something worth savoring.", category: "Food", alt: "Overhead view of a ramen bowl with eggs and vegetables", src: "/art/showcase/ramen.webp", width: 280, prompt: "An overhead editorial photograph of a steaming bowl of ramen, golden broth, soft-boiled eggs and fresh greens, warm wooden table, natural window light, finely detailed food textures." },
    { id: "city", title: "Let the city tell a story.", category: "City", alt: "Manhattan street between skyscrapers in evening light", src: "/art/showcase/city.webp", width: 320, prompt: "A cinematic city street at dusk, tall buildings framing the horizon, warm reflections across the pavement, traffic lights and tiny figures, rich atmospheric depth, editorial travel photography." },
    { id: "flowers", title: "A little more color.", category: "Botanical", alt: "Bright yellow flowers against a clear blue sky", src: "/art/showcase/flowers.webp", width: 240, prompt: "Golden wildflowers reaching into a clear blue sky, a low camera angle, delicate translucent petals in sunlight, joyful color contrast, shallow depth of field, botanical photography." },
  ],
  [
    { id: "lake", title: "Leave a little room to breathe.", category: "Landscape", alt: "Mountain lake with a wooden cabin and still reflections", src: "/art/showcase/lake.webp", width: 270, prompt: "A still alpine lake with a small wooden cabin, mountains reflected perfectly in the water, drifting clouds and soft early light, a peaceful cinematic landscape, natural color grading." },
    { id: "sports-car", title: "Find a different pace.", category: "Automotive", alt: "Dark sports car on a road beneath an overcast sky", src: "/art/showcase/sports-car.webp", width: 340, prompt: "A dark unbranded sports car on a quiet coastal road, low rear three-quarter camera angle, smooth bodywork and moody overcast light, cinematic automotive editorial, wide composition." },
    { id: "jellyfish", title: "A world below the surface.", category: "Nature", alt: "Translucent jellyfish suspended in deep blue water", src: "/art/showcase/jellyfish.webp", width: 210, prompt: "Translucent jellyfish drifting through deep blue water, delicate glowing edges and flowing tentacles, soft underwater light, an ethereal macro photograph with a sense of quiet motion." },
    { id: "mountain", title: "Think a little bigger.", category: "Landscape", alt: "Expansive mountain valley with forest and distant snowy peaks", src: "/art/showcase/mountain.webp", width: 300, prompt: "An expansive mountain valley, layers of evergreen forest and distant snow-capped peaks, bright clouds casting soft shadows, detailed panoramic landscape photography, a sense of scale and discovery." },
    { id: "portrait", title: "Start with a point of view.", category: "Portrait", alt: "Editorial portrait in blue and violet light", src: "/art/portrait.jpg", width: 210, prompt: "An expressive editorial portrait lit with soft blue side lighting and warm highlights, thoughtful gaze, refined cinematic contrast, natural skin texture, shallow depth of field." },
    { id: "coast", title: "Follow the horizon.", category: "Seascape", alt: "Ocean waves beneath a pale evening horizon", src: "/art/coast.jpg", width: 270, prompt: "An ocean-level view of rolling blue waves, a soft pale evening horizon, fine water textures and quiet reflections, cinematic seascape photography, an expansive composition." },
  ],
];
