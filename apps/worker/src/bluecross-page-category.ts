/** Fixed categories only: never persist URLs, query strings or portal text. */
export function blueCrossPageCategory(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.origin !== "https://service.pac.bluecross.ca") return "other";
    const path = url.pathname.replace(/\/$/, "").toLowerCase();
    const known: Record<string, string> = {
      "/member": "member-home", "/member/login": "login",
      "/member/update-password": "password-update", "/member/challenge-questions": "security-questions",
      "/member/update-email": "email-update", "/acesweb/pages/claims/claims.aspx": "claims-history"
    };
    return known[path] ?? "other-portal-page";
  } catch { return "other"; }
}
