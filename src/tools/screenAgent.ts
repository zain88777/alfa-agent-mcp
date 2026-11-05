import { z } from "zod";
import { screenAgentController } from "../core/screenAgentController.js";

export const screenStartSchema = z.object({}).strict();
export const screenObserveSchema = z.object({}).strict();
export const screenClickSchema = z.object({
  x: z.number(),
  y: z.number(),
  button: z.enum(["left", "right", "middle"]).default("left"),
}).strict();
export const screenMoveSchema = z.object({
  x: z.number(),
  y: z.number(),
}).strict();
export const screenDoubleClickSchema = screenClickSchema;
export const screenTypeSchema = z.object({
  text: z.string().min(1),
}).strict();
export const screenKeySchema = z.object({
  key: z.string().min(1),
  modifiers: z.array(z.string()).optional(),
}).strict();
export const screenScrollSchema = z.object({
  deltaX: z.number().optional(),
  deltaY: z.number(),
}).strict();
export const screenWaitSchema = z.object({
  ms: z.number().int().min(1).max(10000),
}).strict();
export const screenStopSchema = z.object({}).strict();
export const screenStatusSchema = z.object({}).strict();

export async function screenStartToolHandler() {
  return screenAgentController.start();
}

export async function screenObserveToolHandler() {
  return screenAgentController.observe();
}

export async function screenClickToolHandler(input: { x: number; y: number; button: "left" | "right" | "middle" }) {
  return screenAgentController.click(input);
}

export async function screenMoveToolHandler(input: { x: number; y: number }) {
  return screenAgentController.move(input);
}

export async function screenDoubleClickToolHandler(input: { x: number; y: number; button: "left" | "right" | "middle" }) {
  return screenAgentController.doubleClick(input);
}

export async function screenTypeToolHandler(input: { text: string }) {
  return screenAgentController.type(input);
}

export async function screenKeyToolHandler(input: { key: string; modifiers?: string[] }) {
  return screenAgentController.key(input);
}

export async function screenScrollToolHandler(input: { deltaX?: number; deltaY: number }) {
  return screenAgentController.scroll(input);
}

export async function screenWaitToolHandler(input: { ms: number }) {
  return screenAgentController.wait(input);
}

export async function screenStopToolHandler() {
  return screenAgentController.stop();
}

export async function screenStatusToolHandler() {
  return screenAgentController.status();
}
