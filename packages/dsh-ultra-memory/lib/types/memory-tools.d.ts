/** The shared host exclusively owns these bounded read tools. */
import type { Context } from '@deepseek-ai/cordis';
import type { UltraMemoryHost } from './memory-host.js';
export declare const MEMORY_READ_TOOLS: readonly ["ultra_memory_search", "ultra_memory_get", "ultra_memory_status"];
export declare function installMemoryTools(ctx: Context, memory: UltraMemoryHost): () => void;
