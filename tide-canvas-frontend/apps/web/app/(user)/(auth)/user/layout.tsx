import type { ReactNode } from "react";
import { AntdProvider } from "@/components/shared/antd-provider";

/** 用户侧布局：接入 antd 上下文，使订单/积分等列表可用 antd Table（社区页不在此范围内） */
export default function UserLayout({ children }: { children: ReactNode }) {
  return <AntdProvider>{children}</AntdProvider>;
}
