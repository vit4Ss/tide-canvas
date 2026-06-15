export interface PermissionItem {
  code: string;
  label: string;
}

export interface PermissionGroup {
  group: string;
  items: PermissionItem[];
}

export interface RoleVO {
  id: number;
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
