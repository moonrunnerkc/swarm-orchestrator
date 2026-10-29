export declare const stubReply: string;
export declare function startStubModel(options?: { port?: number; status?: number }): Promise<{
  readonly port: number;
  readonly requests: unknown[];
  close(): Promise<void>;
}>;
