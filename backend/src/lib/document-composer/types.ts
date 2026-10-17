export type BlockType =
  | "heading"
  | "field"
  | "table"
  | "logo";

export type Align =
  | "left"
  | "center"
  | "right";

export type Size =
  | "small"
  | "medium"
  | "large";

export interface BaseBlock {
  id: string;
  type: BlockType;

  align?: Align;

  marginTop?: number;
  marginBottom?: number;
}

export interface HeadingBlock
  extends BaseBlock {
  type: "heading";

  text: string;

  size: Size;

  bold?: boolean;
}

export interface FieldBlock
  extends BaseBlock {
  type: "field";

  fieldId: string;

  label?: string;
}

export interface TableBlock
  extends BaseBlock {
  type: "table";

  fieldId: string;
}

export interface LogoBlock
  extends BaseBlock {
  type: "logo";
}

export type DocumentBlock =
  | HeadingBlock
  | FieldBlock
  | TableBlock
  | LogoBlock;

export interface DocumentDescriptor {
  version: 1;

  blocks: DocumentBlock[];
}