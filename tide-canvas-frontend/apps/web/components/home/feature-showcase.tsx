import {
  ImagePlus,
  Images,
  Video,
  Clapperboard,
  Sparkles,
  Globe,
  LayoutGrid,
  Box,
} from "lucide-react";

const features = [
  {
    icon: ImagePlus,
    title: "文生图",
    description: "输入文字描述，AI 自动生成高质量图片，支持多种风格和分辨率。",
    color: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400",
  },
  {
    icon: Images,
    title: "图生图",
    description: "以图片为参考，通过提示词引导生成新图片，保留风格特征。",
    color: "bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400",
  },
  {
    icon: Video,
    title: "视频生成",
    description: "从文字或图片生成视频，支持首尾帧控制和多种时长选择。",
    color: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
  },
  {
    icon: Clapperboard,
    title: "分镜系统",
    description: "AI 自动编排多镜头故事板，支持角色参考和场景描述。",
    color: "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400",
  },
  {
    icon: Sparkles,
    title: "创意描述",
    description: "AI 增强提示词，将简单描述扩展为富有创意的详细画面。",
    color: "bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400",
  },
  {
    icon: Globe,
    title: "360 全景",
    description: "生成 360 度全景图片，沉浸式预览，支持书签定位。",
    color: "bg-cyan-50 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400",
  },
  {
    icon: LayoutGrid,
    title: "九宫格变体",
    description: "一键生成 9 种图片变体，快速探索多种创意方向。",
    color: "bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-400",
  },
  {
    icon: Box,
    title: "3D 场景",
    description: "3D 人体模型和场景编辑，精确控制角度和姿态。",
    color: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400",
  },
];

export function FeatureShowcase() {
  return (
    <section className="border-t border-neutral-200 bg-neutral-50/50 py-20 dark:border-neutral-800 dark:bg-neutral-950/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            多模态 AI 创作能力
          </h2>
          <p className="mt-4 text-neutral-600 dark:text-neutral-400">
            在无限画布中自由组合各种 AI 能力，构建完整的创作工作流
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-2xl border border-neutral-200 bg-white p-6 transition-all hover:border-neutral-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
            >
              <div className={`inline-flex rounded-xl p-3 ${feature.color}`}>
                <feature.icon className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
