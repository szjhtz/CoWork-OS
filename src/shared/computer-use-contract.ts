export const COMPUTER_USE_TOOL_NAMES = [
  "screenshot",
  "click",
  "double_click",
  "move_mouse",
  "drag",
  "scroll",
  "type_text",
  "keypress",
  "wait",
] as const;

export type ComputerUseToolName = (typeof COMPUTER_USE_TOOL_NAMES)[number];

const COMPUTER_USE_TOOL_NAME_SET = new Set<string>(COMPUTER_USE_TOOL_NAMES);

export function isComputerUseToolName(toolName: string): toolName is ComputerUseToolName {
  return COMPUTER_USE_TOOL_NAME_SET.has(String(toolName || "").trim());
}
