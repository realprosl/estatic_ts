import { Priority } from "./model.ts";

export function validTitle(title: string): boolean {
  return title.length >= 3 && title.length <= 80;
}

export function validId(id: number): boolean {
  return id > 0;
}

export function priorityLabel(priority: Priority): string {
  if (priority == Priority.High) { return "high"; }
  if (priority == Priority.Medium) { return "medium"; }
  return "low";
}
