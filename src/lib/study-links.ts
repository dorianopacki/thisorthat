// Participant vote URL; S-02 serves this path. See docs/reference/contract-surfaces.md#vote-url.
export function voteUrl(origin: string, token: string): string {
  return `${origin}/v/${token}`;
}
