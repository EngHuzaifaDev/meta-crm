import type { WebDriver } from "selenium-webdriver";

const QUERY_HASH = "37479f2b8209594dde7facb0d904896a";
const X_IG_APP_ID = "936619743392459";
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 1000;
const MAX_REQUESTS_PER_SESSION = Infinity;

async function browserSleep(driver: WebDriver, ms: number): Promise<void> {
  await driver.executeAsyncScript(`
    const ms = arguments[0];
    const done = arguments[1];
    setTimeout(done, ms);
  `, ms);
}

async function igFetchViaDriver<T>(driver: WebDriver, url: string, retries = 3): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const result: any = await driver.executeAsyncScript(
      `
      const url = arguments[0];
      const done = arguments[1];
      fetch(url, {
        credentials: 'include',
        headers: { 'x-ig-app-id': '${X_IG_APP_ID}', 'x-requested-with': 'XMLHttpRequest' }
      })
        .then(async r => ({ ok: r.ok, status: r.status, body: r.ok ? await r.json() : await r.text() }))
        .then(done)
        .catch(err => done({ _error: err.message }));
    `,
      url,
    );

    if (result._error) throw new Error(result._error);
    if (result.status === 429) {
      const wait = Math.min(60000 * 2 ** attempt, 300000);
      await browserSleep(driver, wait);
      continue;
    }
    if (!result.ok) {
      throw new Error(`Instagram API error (${result.status}): ${String(result.body).slice(0, 200)}`);
    }
    return result.body as T;
  }
  throw new Error("Max retries exceeded for Instagram request");
}

export interface ProfileInfo {
  id: string;
  isPrivate: boolean;
  profilePicUrl: string;
}

export async function resolveProfileInfoViaDriver(driver: WebDriver, username: string): Promise<ProfileInfo> {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const data = await igFetchViaDriver<{ data: { user: any } }>(driver, url);
  const user = data.data?.user;
  if (!user) throw new Error("PROFILE_NOT_FOUND");
  return {
    id: String(user.id),
    isPrivate: !!user.is_private,
    profilePicUrl: user.profile_pic_url || "",
  };
}

export interface GraphQLPageResult {
  usernames: Array<{ username: string; fullName: string; profilePicUrl: string; isVerified: boolean; id: string }>;
  endCursor: string | null;
  hasNextPage: boolean;
  estimatedTotal: number;
}

export async function fetchFollowersPageViaDriver(
  driver: WebDriver,
  userId: string,
  cursor?: string,
): Promise<GraphQLPageResult> {
  const vars: Record<string, any> = { id: userId, first: PAGE_SIZE };
  if (cursor) vars.after = cursor;

  const url = `https://www.instagram.com/graphql/query/?query_hash=${QUERY_HASH}&variables=${encodeURIComponent(JSON.stringify(vars))}`;
  const data = await igFetchViaDriver<{
    data: { user: { edge_followed_by: any } };
  }>(driver, url);

  const edge = data.data?.user?.edge_followed_by;
  if (!edge) throw new Error("Unexpected GraphQL response structure — missing edge_followed_by");

  return {
    usernames: edge.edges.map((e: any) => ({
      username: e.node.username,
      fullName: e.node.full_name || "",
      profilePicUrl: e.node.profile_pic_url || "",
      isVerified: !!e.node.is_verified,
      id: String(e.node.id),
    })),
    endCursor: edge.page_info.end_cursor || null,
    hasNextPage: !!edge.page_info.has_next_page,
    estimatedTotal: edge.count ?? 0,
  };
}

export interface GraphQLProgressEvent {
  profileUsername: string;
  page: number;
  totalPages: number;
  fetchedCount: number;
  estimatedTotal: number;
  followerUsername?: string;
  avatarUrl?: string;
  message: string;
}

export type GraphQLProgressCallback = (event: GraphQLProgressEvent) => void | Promise<void>;

export interface GraphQLExtractionResult {
  avatarUrls: Map<string, string>;
  totalFetched: number;
  estimatedTotal: number;
  pagesFetched: number;
  isPrivate: boolean;
  profilePicUrl: string;
}

export async function extractFollowersGraphQLViaDriver(
  driver: WebDriver,
  targetUsername: string,
  onProgress: GraphQLProgressCallback,
): Promise<GraphQLExtractionResult> {
  const profile = await resolveProfileInfoViaDriver(driver, targetUsername);

  if (profile.isPrivate) {
    return {
      profilePicUrl: profile.profilePicUrl,
      isPrivate: true,
      avatarUrls: new Map(),
      totalFetched: 0,
      estimatedTotal: 0,
      pagesFetched: 0,
    };
  }

  const userId = profile.id;

  let cursor: string | undefined;
  let page = 0;
  let totalFetched = 0;
  let estimatedTotal = 0;
  let requestCount = 0;
  const avatarUrls = new Map<string, string>();

  while (requestCount < MAX_REQUESTS_PER_SESSION) {
    const result = await fetchFollowersPageViaDriver(driver, userId, cursor);
    requestCount++;

    if (page === 0) {
      estimatedTotal = result.estimatedTotal;
    }

    const totalPages = Math.ceil(estimatedTotal / PAGE_SIZE);

    for (const entry of result.usernames) {
      totalFetched++;
      if (entry.profilePicUrl) {
        avatarUrls.set(entry.username, entry.profilePicUrl);
      }
      await onProgress({
        profileUsername: targetUsername,
        page: page + 1,
        totalPages,
        fetchedCount: totalFetched,
        estimatedTotal,
        followerUsername: entry.username,
        avatarUrl: entry.profilePicUrl || undefined,
        message: `Page ${page + 1}/${totalPages} — ${totalFetched} followers fetched`,
      });
    }

    if (!result.hasNextPage) break;

    cursor = result.endCursor ?? undefined;
    page++;
    estimatedTotal = result.estimatedTotal;
    await browserSleep(driver, REQUEST_DELAY_MS);
  }

  return {
    profilePicUrl: profile.profilePicUrl,
    isPrivate: false,
    avatarUrls,
    totalFetched,
    estimatedTotal,
    pagesFetched: page + 1,
  };
}
