import z from '@deepseek-ai/schemastery';
export declare const TaskMemoryFields: {
    taskMemoryEnabled: z<boolean, boolean, "defined">;
    taskMemoryMaxBytes: z<number, number, "defined">;
    taskMemoryConditionalRecall: z<boolean, boolean, "defined">;
    taskMemoryRecallLimit: z<number, number, "defined">;
};
