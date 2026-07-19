export interface PermissionItem {
  code: string;
  label: string;
}

export interface PermissionGroup {
  group: string;
  items: PermissionItem[];
}

export interface RoleVO {
  id: string; // 后端雪花主键，字符串传输避免 JS number 精度丢失
  name: string;
  code: string;
  permissions: string[];
  builtin: number;
  remark?: string;
  createTime: string;
  updateTime: string;
}

export interface RoleSaveDTO {
  name: string;
  code: string;
  permissions: string[];
  remark?: string;
}
