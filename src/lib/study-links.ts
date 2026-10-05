// Participant vote URL; S-02 serves this path. See docs/reference/contract-surfaces.md#vote-url.
// The token is the participant's credential: always build the path through `votePath`.

/** Cookie set on `votePath(token)` after a vote is accepted or the link is found used. A UI hint only. */
export const VOTED_COOKIE = "voted";

export function votePath(token: string): string {
  return `/v/${encodeURIComponent(token)}`;
}

export function voteUrl(origin: string, token: string): string {
  return `${origin}${votePath(token)}`;
}
