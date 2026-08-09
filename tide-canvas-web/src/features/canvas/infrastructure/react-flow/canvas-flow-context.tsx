"use client";

import { createContext, useContext, type ReactNode } from "react";

const CanvasFlowNodeContext = createContext(false);

export function CanvasFlowNodeProvider({ children }: { children: ReactNode }) {
  return <CanvasFlowNodeContext.Provider value>{children}</CanvasFlowNodeContext.Provider>;
}

/** 节点基础组件借此选择 React Flow Handle 或遗留端口实现。 */
export function useIsReactFlowNode(): boolean {
  return useContext(CanvasFlowNodeContext);
}
