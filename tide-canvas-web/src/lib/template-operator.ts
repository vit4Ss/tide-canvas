import type { StudioTemplate, StudioTemplateSave } from "./studio-template-api";

export function copyTemplateDraft(row: StudioTemplate): StudioTemplateSave {
  return {
    kind: row.kind,
    mediaType: row.mediaType,
    title: `${Array.from(row.title).slice(0, 123).join("")}（副本）`,
    description: row.description,
    category: row.category,
    prompt: row.prompt,
    coverUrl: row.coverUrl,
    previewUrl: row.previewUrl,
    authorName: row.authorName,
    inputHint: row.inputHint,
    inputLabels: structuredClone(row.inputLabels || {}),
    mode: row.mode,
    modelKey: row.modelKey,
    requirements: { ...row.requirements },
    options: { ...row.options },
    status: 0,
    sortOrder: row.sortOrder,
  };
}

export function templateCountRange(
  mode: StudioTemplate["mode"],
  kind: "images" | "videos" | "audio",
) {
  if (kind !== "images") return { min: 0, max: mode === "ref" ? 3 : 0 };
  switch (mode) {
    case "t2i":
    case "t2v":
      return { min: 0, max: 0 };
    case "i2v":
      return { min: 1, max: 1 };
    case "flf":
      return { min: 2, max: 2 };
    case "i2i":
      return { min: 1, max: 4 };
    default:
      return { min: 0, max: 4 };
  }
}

// Preserve an existing unsupported setting so switching models cannot silently
// change an operator's recipe. Only an explicit selection replaces that value.
export function templateSpecChoices(
  value: string | undefined,
  configured: unknown,
): {
  constrained: boolean;
  invalid: boolean;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
} {
  const values = Array.isArray(configured)
    ? configured
        .filter(
          (item): item is string => typeof item === "string" && !!item.trim(),
        )
        .map((item) => item.trim())
    : [];
  const unique = values.filter(
    (item, index) =>
      values.findIndex(
        (other) => other.toLowerCase() === item.toLowerCase(),
      ) === index,
  );
  const current = value?.trim() || "";
  const match = unique.find(
    (item) => item.toLowerCase() === current.toLowerCase(),
  );
  const invalid = !!current && unique.length > 0 && !match;
  return {
    constrained: unique.length > 0,
    invalid,
    value: match || current,
    options: [
      {
        value: "",
        label: unique.length
          ? `使用模型默认值（${unique[0]}）`
          : "使用模型默认值",
      },
      ...unique.map((item) => ({ value: item, label: item })),
      ...(invalid
        ? [
            {
              value: current,
              label: `${current}（不在模型配置中）`,
              disabled: true,
            },
          ]
        : []),
    ],
  };
}
