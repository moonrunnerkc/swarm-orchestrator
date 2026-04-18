import * as readline from 'readline';

export function confirmCostPrompt(
  estimateLow: number,
  estimateHigh: number,
  model: string,
  skipConfirm: boolean
): Promise<boolean> {
  if (skipConfirm) return Promise.resolve(true);
  if (!process.stdin.isTTY) return Promise.resolve(true);

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      `\n⚡ This will use ${estimateLow}-${estimateHigh} premium requests (${model}). Proceed? [Y/n] `,
      (answer) => {
        rl.close();
        const normalized = (answer || 'y').trim().toLowerCase();
        resolve(normalized === 'y' || normalized === 'yes' || normalized === '');
      }
    );
  });
}

