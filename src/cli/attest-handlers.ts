import { verifyAttestation } from '../verification';

/**
 * Handle `swarm attest verify <commit>`.
 *
 * @param args - CLI argv segment beginning with `attest`.
 * @returns Process exit code.
 */
export async function handleAttestCommand(args: string[]): Promise<number> {
  const subcommand = args[1];
  if (subcommand !== 'verify') {
    console.error('Usage: swarm attest verify <commit>');
    return 1;
  }

  const commit = args[2];
  if (!commit) {
    console.error('Usage: swarm attest verify <commit>');
    return 1;
  }

  const result = await verifyAttestation(process.cwd(), commit);
  if (!result.found) {
    console.error(`No attestation found for ${commit}`);
    return 1;
  }

  const attestation = result.attestation;
  if (!attestation) {
    console.error(`No attestation found for ${commit}`);
    return 1;
  }

  const metadata = attestation.envelope.predicate.metadata;
  const agent = attestation.envelope.predicate.buildConfig;
  console.log(`Commit: ${commit}`);
  console.log(`Verified: ${result.verified ? 'yes' : 'no'}`);
  console.log(`Reason: ${result.reason}`);
  console.log(`Agent: ${agent.tool} ${agent.version} (${agent.model})`);
  console.log(`Composite score: ${metadata.compositeScore}`);
  console.log(`Timestamp: ${metadata.timestamp}`);
  for (const layer of metadata.layerResults) {
    console.log(`- ${layer.layer}: ${layer.status} (${layer.durationMs}ms) ${layer.evidenceSummary}`);
  }

  return result.verified ? 0 : 1;
}
