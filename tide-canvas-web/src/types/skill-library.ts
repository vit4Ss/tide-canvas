export interface LibrarySkill {
  id: string;
  title: string;
  description: string;
  usageScenario: string;
  howTo: string;
  outputDescription: string;
  coverUrl: string;
  category: string;
  authorName: string;
  kind: string;
  outputTypes: string[];
  useCount: number;
  version: number;
  updateTime: string;
  mcpEnabled: boolean;
  installable: boolean;
  unavailableReason?: string;
  mcpAvailable?: boolean;
  mcpUnavailableReason?: string;
  mcpEndpoint?: string;
  installPath?: string;
  downloadPath?: string;
  skillName: string;
  nativePath?: string;
  inputSchema?: Record<string, unknown>;
}

export interface LibraryPage {
  records: LibrarySkill[];
  categories: string[];
  total: number;
  pageNum: number;
  pageSize: number;
  pages: number;
}
