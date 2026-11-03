// Which club a tab is working in. The club lives in each page's URL (?club=<id>), so every tab keeps its own club
// and a reload or shared link opens the same one. Navigation only: the Worker and database authorize the club named
// by every request, and the remembered last club is a starting-point preference, never a permission.
import {uuid} from "../domain/member.ts";

export const clubParam = "club";
/** The club a URL names: its id, null when it names none, or false when the value is not a club id. */
export function clubOf(search: string | URLSearchParams): string | null | false {
  const value = new URLSearchParams(search).get(clubParam);
  return value === null ? null : uuid.test(value) ? value.toLowerCase() : false;
}
/** `href` with this club; any club it already named is replaced. Hash fragments are not used in this app. */
export function clubHref(href: string, club: string) {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set(clubParam, club);
  return `${path}?${params}`;
}
// Platform, sign-in and MFA endpoints are account-wide; platform calls name their target club in their own parameters.
const accountWide = /^\/api\/(login|logout|auth\/|mfa|admin\/)/;
/** The API path a page in `search` should call: club requests carry the page's club, exactly as written in the URL
 * (an invalid value is sent on, so the Worker refuses it instead of the request silently using another club). */
export function clubApiPath(path: string, search: string) {
  const value = new URLSearchParams(search).get(clubParam);
  if (value === null || accountWide.test(path)) return path;
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set(clubParam, value);
  return `${base}?${params}`;
}
/** The account check that belongs to an API path: the same club, so a cached club B page is never vouched for by A. */
export function accountPathFor(path: string) {
  const value = new URLSearchParams(path.split("?")[1] ?? "").get(clubParam);
  return value === null ? "/api/account" : `/api/account?${new URLSearchParams({[clubParam]: value})}`;
}

type Account = { super_admin?: boolean; club_id?: string; permissions?: unknown[]; clubs?: { id: string }[] };
/** Where to start without a club in the URL: the last club this browser managed if the account can still enter it,
 * else the default club when it has permissions there, else its only club. Null means let the person choose. */
export function preferredClub(account: Account, last: string | null) {
  const clubs = account.clubs ?? [];
  const here = (account.permissions?.length ?? 0) > 0 ? account.club_id : undefined;
  if (last && (clubs.some(c => c.id === last) || last === here)) return last;
  return here ?? (clubs.length === 1 ? clubs[0].id : null);
}

const lastKey = "club:last-club";
/** Remembered only after this browser successfully entered the club; storage failures just lose the preference. */
export function rememberClub(club: string) { try { localStorage.setItem(lastKey, club); } catch {} }
export function lastClub() {
  try { const value = localStorage.getItem(lastKey); return value && uuid.test(value) ? value : null; } catch { return null; }
}
