// app/types.ts

export type Primitive = string | number | boolean | null | undefined;
export type Row = Record<string, Primitive>;

export interface HistoryItem {
  id: string;
  description: string;
  timestamp: string;
  data: Row[];
}