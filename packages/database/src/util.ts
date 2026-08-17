import { randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}
