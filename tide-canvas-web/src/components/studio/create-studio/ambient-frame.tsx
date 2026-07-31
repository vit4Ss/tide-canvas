/* 灯箱片外框：把主色写进 --amb，泛光颜色由 studio.css 消费。
   从 create-studio.tsx 抽出（纯移动，无逻辑改动）。 */

import type { CSSProperties, ReactNode } from "react";
import { useAmbient } from "./use-ambient";

export function AmbientFrame({
  url,
  className,
  onClick,
  children,
}: {
  url?: string;
  className: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const amb = useAmbient(url);
  return (
    <div
      className={className}
      style={amb ? ({ "--amb": amb } as CSSProperties) : undefined}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
