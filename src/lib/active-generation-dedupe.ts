export interface ActiveGenerationIdentity {
  fingerprint: string;
  payloadFingerprint?: string;
}

/** Match both new journal rows and pre-upgrade rows whose payload hash was the
 * prefix of the click-specific fingerprint. */
export function findActiveGenerationByPayload<T extends ActiveGenerationIdentity>(
  rows: readonly T[],
  payloadFingerprint: string,
): T | undefined {
  return rows.find((row) =>
    row.payloadFingerprint === payloadFingerprint ||
    row.fingerprint === payloadFingerprint ||
    row.fingerprint.startsWith(`${payloadFingerprint}:`),
  );
}
