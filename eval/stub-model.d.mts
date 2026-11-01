export declare const stubReply: string;
export declare function startStubModel(options?: {
  port?: number;
  status?: number;
  replies?: readonly string[];
}): Promise<{
  readonly port: number;
  readonly requests: unknown[];
  close(): Promise<void>;
}>;
