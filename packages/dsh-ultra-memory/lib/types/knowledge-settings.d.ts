/** User-owned native profile policy. Models receive tools, never this configuration writer. */
import z from '@deepseek-ai/schemastery';
export declare const GlobalKnowledgeSchema: z<NoInfer<Schemastery.ObjectS<NoInfer<{
    enabled: z<boolean, boolean, "defined">;
    projects: z<({
        id?: string | null | undefined;
        root?: string | null | undefined;
        read?: boolean | null | undefined;
        publish?: boolean | null | undefined;
        shareWith?: string[] | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "plain">;
        root: z<string, string, "plain">;
        read: z<boolean, boolean, "defined">;
        publish: z<boolean, boolean, "defined">;
        shareWith: z<string[], string[], "defined">;
    }>>[], "defined">;
    maxSearchChars: z<number, number, "defined">;
    maxGetChars: z<number, number, "defined">;
}>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
    enabled: z<boolean, boolean, "defined">;
    projects: z<({
        id?: string | null | undefined;
        root?: string | null | undefined;
        read?: boolean | null | undefined;
        publish?: boolean | null | undefined;
        shareWith?: string[] | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "plain">;
        root: z<string, string, "plain">;
        read: z<boolean, boolean, "defined">;
        publish: z<boolean, boolean, "defined">;
        shareWith: z<string[], string[], "defined">;
    }>>[], "defined">;
    maxSearchChars: z<number, number, "defined">;
    maxGetChars: z<number, number, "defined">;
}>>>, "volatile-defined">;
