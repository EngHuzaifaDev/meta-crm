type ResolveFunction = (code: string) => void;

const pendingChallenges = new Map<string, { resolve: ResolveFunction; createdAt: number }>();

const CHALLENGE_TIMEOUT = 5 * 60 * 1000;

export function createChallenge(credentialId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    pendingChallenges.set(credentialId, {
      resolve,
      createdAt: Date.now(),
    });

    setTimeout(() => {
      if (pendingChallenges.has(credentialId)) {
        pendingChallenges.delete(credentialId);
        reject(new Error('2FA challenge timed out'));
      }
    }, CHALLENGE_TIMEOUT);
  });
}

export function resolveChallenge(credentialId: string, code: string): boolean {
  const challenge = pendingChallenges.get(credentialId);
  if (!challenge) return false;
  pendingChallenges.delete(credentialId);
  challenge.resolve(code);
  return true;
}
