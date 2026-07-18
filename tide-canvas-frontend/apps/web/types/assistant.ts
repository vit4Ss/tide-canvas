export interface AssistantPetSpriteAction {
  id: string;
  name: string;
  row: number;
  start: number;
  count: number;
  fps?: number;
  loop?: boolean;
}

export interface AssistantPetSpriteMeta {
  kind: "spritesheet";
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  fps?: number;
  defaultAction?: string;
  actions: AssistantPetSpriteAction[];
}

export interface AssistantPetStyle {
  id: string;
  name: string;
  imageUrl: string;
  enabled: boolean;
  isDefault?: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  sprite?: AssistantPetSpriteMeta;
}
