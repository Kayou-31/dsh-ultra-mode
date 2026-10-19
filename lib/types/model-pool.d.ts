/** Ordinary collaboration routing only. Credentials and model calls remain host owned. */
export interface ModelCandidate {
    id: string;
    name: string;
    enabled: boolean;
    provider: string;
    model: string;
    strengths: string;
    suitableFor: string;
    avoidFor: string;
    reasoningEffort?: string;
    maxTokens?: number;
    isDefault: boolean;
    maxConcurrent: number;
    allowCrossProvider: boolean;
    allowUnverifiedTools: boolean;
    costNote?: string;
    costSource?: 'user' | 'measured';
    speedNote?: string;
    speedSource?: 'user' | 'measured';
}
export interface ModelPoolConfig {
    models: ModelCandidate[];
    explicitModelId?: string;
    fallback: 'error' | 'default' | 'inherit';
    maxConcurrent: number;
    maxRequests: number;
    failureLimit: number;
}
export type ModelPoolSource = ModelPoolConfig | {
    get(): ModelPoolConfig;
} | undefined;
export interface PoolModelInfo {
    provider: string;
    id: string;
    name?: string;
    inputModalities?: readonly string[];
    reasoning?: {
        efforts: readonly {
            id: string;
        }[];
        defaultEffort?: string;
    };
}
export interface ModelPoolHost {
    listProviders(): {
        id: string;
    }[];
    listModels(provider: string): Promise<{
        provider: string;
        id: string;
        name?: string;
    }[]>;
    resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<PoolModelInfo>;
    resolveCallConfig(config: {
        provider: string;
        model: string;
        reasoningEffort?: string;
        maxTokens?: number;
    }, signal?: AbortSignal): Promise<{
        provider: string;
        model: string;
        reasoningEffort?: string;
        maxTokens?: number;
    }>;
}
export interface ModelChoice {
    modelConfigId?: string;
    reason?: string;
}
export interface ModelSelectionContext {
    parentProvider: string;
    parentModel?: string;
    requiredInputs: readonly string[];
    requiresTools: boolean;
    scopeId: string;
    signal: AbortSignal;
}
export interface ModelSelection {
    requestedConfigId?: string;
    selectedConfigId?: string;
    source: 'user' | 'agent' | 'default' | 'inherit' | 'inherited-candidate';
    reason: string;
    provider: string;
    model: string;
    reasoningEffort?: string;
    maxTokens?: number;
    compatibility: {
        input: string;
        tools: string;
        outputLimit: string;
    };
    fallbackReason?: string;
    requestStatus?: 'pending' | 'observed';
    actual?: {
        provider: string;
        model: string;
        reasoningEffort?: string;
        maxTokens?: number;
        stage: 'native-request';
    };
    toolCalls?: {
        succeeded: number;
        failed: number;
    };
    agentOptions?: {
        provider: string;
        model: string;
        reasoningEffort?: string;
        maxTokens?: number;
    };
    /** Admission policy is immutable for this instance, including later follow-ups. */
    snapshot: {
        candidate?: ModelCandidate;
        limits: Omit<ModelPoolConfig, 'models'>;
        scopeId: string;
        inputModalities: readonly string[];
    };
}
export interface ModelUsage {
    requests: number;
    knownTokens: number;
    unknownCalls: number;
    inFlightRequests: number;
    source: 'adapter-reported';
    estimatedTokens: null;
}
interface RequestTicket {
    id: string;
    settled: boolean;
}
export declare class ModelPoolError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** Used at both the native Settings boundary and each new delegation. No key storage. */
export declare function readModelPool(source?: ModelPoolSource | unknown): ModelPoolConfig;
export declare function modelPoolCatalog(config: ModelPoolSource): string;
/** Shared synchronous admission across ordinary teams; native limits still apply. */
export declare class ModelPool {
    private readonly config;
    private readonly host;
    private slots;
    private failures;
    private scopeRequests;
    constructor(config: () => ModelPoolSource, host: ModelPoolHost);
    private failureKey;
    private attempt;
    private validate;
    select(choice: ModelChoice, context: ModelSelectionContext): Promise<ModelSelection | undefined>;
    reserve(id: string, selected: ModelSelection): void;
    private capacity;
    activate(id: string): void;
    release(id: string, outcome?: 'completed' | 'failed' | 'cancelled'): void;
    forget(id: string): void;
    selection(id: string): ModelSelection | undefined;
    observeTool(id: string, success: boolean): void;
    usage(id: string): ModelUsage | undefined;
    beginRequest(id: string, request: {
        provider: string;
        model: string;
        reasoningEffort?: string;
        maxTokens?: number;
        messages?: unknown;
        tools?: readonly unknown[];
    }): RequestTicket;
    finishRequest(ticket: RequestTicket, usage: unknown, completed: boolean): void;
    closeScope(scopeId: string): void;
}
export {};
