/* /tools — 智能工具中心。

   Server entry: owns the route <title>, renders the client <ToolsHub/>
   (上:后台「工具管理」配置的智能工具入口卡;下:当前账号用这些工具处理出的
   作品) inside the (studio) rail layout. 单个工具的上传→处理→对照流程仍在
   独立全屏页 /tools/[key](app/tools/[op],不带侧栏)。 */

import type { Metadata } from "next";
import ToolsHub from "./tools-hub";

export const metadata: Metadata = {
  title: "工具 · 流光 FlowingLight",
};

export default function ToolsPage() {
  return <ToolsHub />;
}
