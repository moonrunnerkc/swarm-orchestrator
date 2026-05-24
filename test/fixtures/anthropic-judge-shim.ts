// Minimal Anthropic SDK shim for judge tests. The AnthropicJudge
// `client` constructor option lets tests inject this in place of a
// real SDK instance; the only call site the judge uses is
// `messages.create`.

import type Anthropic from '@anthropic-ai/sdk';
import type { JudgeAnswer } from '../../src/audit/cheat-detector/llm-judge/types';

export interface StubCallRecord {
  model: string;
  system: string;
  userText: string;
}

export interface StubBuildOptions {
  reply: string;
  throwError?: Error;
}

export function buildJudgeClientStub(options: StubBuildOptions): {
  client: Anthropic;
  calls: StubCallRecord[];
} {
  const calls: StubCallRecord[] = [];
  const create = async (req: {
    model: string;
    system: string;
    messages: Array<{ role: string; content: string }>;
  }): Promise<unknown> => {
    if (options.throwError !== undefined) throw options.throwError;
    calls.push({
      model: req.model,
      system: req.system,
      userText: req.messages[0]?.content ?? '',
    });
    return {
      content: [{ type: 'text', text: options.reply }],
    };
  };
  return {
    client: { messages: { create } } as unknown as Anthropic,
    calls,
  };
}

export function judgeReply(answer: JudgeAnswer | 'malformed', reason?: string): string {
  if (answer === 'malformed') return 'this is not a valid judge response';
  if (answer === 'unavailable') return '';
  const tag = answer.toUpperCase();
  return reason !== undefined ? `${tag} ${reason}` : tag;
}
