export interface EmailTemplateVariableVO {
  /** 变量名,模板中以 {{name}} 引用 */
  name: string;
  description: string;
  /** 预览默认示例值 */
  sample: string;
}

export interface EmailTemplateVO {
  id: number;
  templateCode: string;
  templateName: string;
  subject: string;
  content: string;
  variables: EmailTemplateVariableVO[];
  enabled: number;
  remark?: string;
  updateTime: string;
}

export interface EmailTemplateUpdateDTO {
  templateName: string;
  subject: string;
  content: string;
  enabled: number;
  remark?: string;
}

export interface EmailTemplatePreviewDTO {
  subject: string;
  content: string;
  params: Record<string, string>;
}

export interface EmailRenderVO {
  subject: string;
  html: string;
  /** 模板中引用但未提供测试值的变量 */
  missingVariables: string[];
}

export interface EmailTemplateSendTestDTO {
  to: string;
  params: Record<string, string>;
}
