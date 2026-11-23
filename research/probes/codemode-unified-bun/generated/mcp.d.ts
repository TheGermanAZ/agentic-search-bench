/**
 * Auto-generated TypeScript declarations for MCP tools
 * Generated: 2026-11-22T19:47:33.434Z
 *
 * This file provides type-safe access to all MCP server tools
 * available in the codemode-unified execution environment.
 *
 * @packageDocumentation
 */

/** Result type for MCP tool calls */
interface MCPToolResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/** Generated from probe.lookup schema */

export interface ProbeLookupArgs {
  id: number;
  [k: string]: unknown;
}

declare global {
  const mcp: {
    probe: {
      /**
       * Look up a value by id. Waits 200 ms and returns { id, value: id 2 }.
       */
      lookup(args: ProbeLookupArgs): Promise<MCPToolResult>;
    };
  };
}

export {};
