import type { DecorationsData } from "./types.ts";
/**
 * Build text decorations (emoji,mention)
 */
export declare const buildTextDecorations: (decorationText: DecorationsData[]) => [string, {
    REPLACE?: string;
    STICON_OWNERSHIP?: string;
    MENTION?: string;
}];
