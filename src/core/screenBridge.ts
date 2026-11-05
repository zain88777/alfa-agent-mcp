export interface ScreenObserveResult {
  imageBase64: string;
  width: number;
  height: number;
  scaleFactor: number;
  displayId: string;
  cursor?: { x: number; y: number } | null;
  activeWindowTitle?: string | null;
}

export interface ScreenBridge {
  requestLocalApproval(timeoutMs: number): Promise<{ approved: boolean; reason?: string }>;
  showControlOverlay(): Promise<void>;
  hideControlOverlay(): Promise<void>;
  getStatus(): Promise<{ approved: boolean; emergencyStopped: boolean }>;
  observe(options: { maxDimension: number; jpegQuality: number }): Promise<ScreenObserveResult>;
  move(input: { x: number; y: number }): Promise<void>;
  click(input: { x: number; y: number; button: "left" | "right" | "middle" }): Promise<void>;
  doubleClick(input: { x: number; y: number; button: "left" | "right" | "middle" }): Promise<void>;
  type(input: { text: string }): Promise<void>;
  key(input: { key: string; modifiers?: string[] }): Promise<void>;
  scroll(input: { deltaX?: number; deltaY: number }): Promise<void>;
  getActiveWindowTitle?(): Promise<string | null>;
}

let bridge: ScreenBridge | null = null;

export function setScreenBridge(next: ScreenBridge | null): void {
  bridge = next;
}

export function getScreenBridge(): ScreenBridge | null {
  return bridge;
}
