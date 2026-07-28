import type { WebDriver } from "selenium-webdriver"
import { proxyFetch, parseProxyUrl } from "./proxy-helper"

const QUERY_HASH = "37479f2b8209594dde7facb0d904896a"
const X_IG_APP_ID = "936619743392459"
const PAGE_SIZE = 50
const REQUEST_DELAY_MS = 1000
const MAX_REQUESTS_PER_SESSION = Infinity

const PROXY_URL = process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ""

export interface SessionCookies {
  csrftoken: string
  sessionid: string
  ds_user_id: string
  mid: string
  ig_did?: string
  rur?: string
}

export function extractSessionCookies(
  driver: WebDriver,
): Promise<SessionCookies> {
  return driver.executeScript(`
    const c = document.cookie.split(';').reduce((acc, s) => {
      const [k, ...v] = s.trim().split('=');
      acc[k.trim()] = v.join('=');
      return acc;
    }, {});
    return {
      csrftoken: c.csrftoken || '',
      sessionid: c.sessionid || '',
      ds_user_id: c.ds_user_id || '',
      mid: c.mid || '',
      ig_did: c.ig_did || '',
      rur: c.rur || '',
    };
  `)
}

async function browserSleep(driver: WebDriver, ms: number): Promise<void> {
  await driver.executeAsyncScript(`
    const ms = arguments[0];
    const done = arguments[1];
    setTimeout(done, ms);
  `, ms)
}

function buildInstagramHeaders(cookies: SessionCookies): Record<string, string> {
  const cookieStr = [
    `csrftoken=${cookies.csrftoken}`,
    `sessionid=${cookies.sessionid}`,
    `ds_user_id=${cookies.ds_user_id}`,
    `mid=${cookies.mid}`,
  ]
  if (cookies.ig_did) cookieStr.push(`ig_did=${cookies.ig_did}`)
  if (cookies.rur) cookieStr.push(`rur=${cookies.rur}`)

  return {
    "x-ig-app-id": X_IG_APP_ID,
    "x-requested-with": "XMLHttpRequest",
    "x-csrftoken": cookies.csrftoken,
    "cookie": cookieStr.join("; "),
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "referer": "https://www.instagram.com/",
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
  }
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
    )

    if (result._error) throw new Error(result._error)
    if (result.status === 429) {
      const wait = Math.min(60000 * 2 ** attempt, 300000)
      await browserSleep(driver, wait)
      continue
    }
    if (!result.ok) {
      throw new Error(`Instagram API error (${result.status}): ${String(result.body).slice(0, 200)}`)
    }
    return result.body as T
  }
  throw new Error("Max retries exceeded for Instagram request")
}

async function igFetchViaProxy<T>(
  url: string,
  cookies: SessionCookies,
  retries = 3,
): Promise<T> {
  if (!parseProxyUrl(PROXY_URL)) {
    throw new Error("Proxy not configured — cannot use proxy-based fetch")
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await proxyFetch(url, {
      method: "GET",
      headers: buildInstagramHeaders(cookies),
      redirect: "manual",
    })

    if (response.status === 429) {
      const wait = Math.min(60000 * 2 ** attempt, 300000)
      await new Promise((r) => setTimeout(r, wait))
      continue
    }

    if (response.status === 302 || response.status === 303) {
      const loc = response.headers.get("location") || ""
      if (loc.includes("login") || loc.includes("accounts")) {
        throw new Error("SESSION_EXPIRED")
      }
    }

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Instagram API error (${response.status}): ${body.slice(0, 200)}`)
    }

    return (await response.json()) as T
  }
  throw new Error("Max retries exceeded for Instagram request")
}

export interface ProfileInfo {
  id: string
  isPrivate: boolean
  profilePicUrl: string
}

export async function resolveProfileInfoViaDriver(driver: WebDriver, username: string): Promise<ProfileInfo> {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
  const data = await igFetchViaDriver<{ data: { user: any } }>(driver, url)
  const user = data.data?.user
  if (!user) throw new Error("PROFILE_NOT_FOUND")
  return {
    id: String(user.id),
    isPrivate: !!user.is_private,
    profilePicUrl: user.profile_pic_url || "",
  }
}

export interface GraphQLPageResult {
  usernames: Array<{ username: string; fullName: string; profilePicUrl: string; isVerified: boolean; id: string }>
  endCursor: string | null
  hasNextPage: boolean
  estimatedTotal: number
}

async function parseGraphQLResponse(data: any): Promise<GraphQLPageResult> {
  const edge = data?.data?.user?.edge_followed_by
  if (!edge) {
    const snippet = JSON.stringify(data).slice(0, 500)
    throw new Error(`Unexpected GraphQL response — ${snippet}`)
  }
  return {
    usernames: (edge.edges || []).map((e: any) => ({
      username: e.node.username,
      fullName: e.node.full_name || "",
      profilePicUrl: e.node.profile_pic_url || "",
      isVerified: !!e.node.is_verified,
      id: String(e.node.id),
    })),
    endCursor: edge.page_info?.end_cursor || null,
    hasNextPage: !!edge.page_info?.has_next_page,
    estimatedTotal: edge.count ?? 0,
  }
}

export async function fetchFollowersPageViaDriver(
  driver: WebDriver,
  userId: string,
  cursor?: string,
): Promise<GraphQLPageResult> {
  const vars: Record<string, any> = { id: userId, first: PAGE_SIZE }
  if (cursor) vars.after = cursor

  const url = `https://www.instagram.com/graphql/query/?query_hash=${QUERY_HASH}&variables=${encodeURIComponent(JSON.stringify(vars))}`
  const data = await igFetchViaDriver<{
    data: { user: { edge_followed_by: any } }
  }>(driver, url)

  return parseGraphQLResponse(data)
}

export async function fetchFollowersPageViaProxy(
  userId: string,
  cookies: SessionCookies,
  cursor?: string,
): Promise<GraphQLPageResult> {
  const vars: Record<string, any> = { id: userId, first: PAGE_SIZE }
  if (cursor) vars.after = cursor

  const url = `https://www.instagram.com/graphql/query/?query_hash=${QUERY_HASH}&variables=${encodeURIComponent(JSON.stringify(vars))}`
  const data = await igFetchViaProxy<{
    data: { user: { edge_followed_by: any } }
  }>(url, cookies)

  return parseGraphQLResponse(data)
}

export interface GraphQLProgressEvent {
  profileUsername: string
  page: number
  totalPages: number
  fetchedCount: number
  estimatedTotal: number
  followerUsername?: string
  avatarUrl?: string
  message: string
}

export type GraphQLProgressCallback = (event: GraphQLProgressEvent) => void | Promise<void>

export interface GraphQLExtractionResult {
  avatarUrls: Map<string, string>
  totalFetched: number
  estimatedTotal: number
  pagesFetched: number
  isPrivate: boolean
  profilePicUrl: string
}

export interface CookieBasedOptions {
  headers: Record<string, string>
  sessionCookies: SessionCookies
  maxPages?: number
}

export interface GraphQLStreamOptions {
  cookies: SessionCookies
}

export async function resolveProfileInfoFromCookies(
  username: string,
  headers: Record<string, string>,
): Promise<ProfileInfo> {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
  const response = await proxyFetch(url, { method: "GET", headers })
  if (response.status === 404) throw new Error("PROFILE_NOT_FOUND")
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Instagram API error (${response.status}): ${body.slice(0, 200)}`)
  }
  const body = await response.text()
  let parsed: any
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error(`Profile info: non-JSON response (${response.status}): ${body.slice(0, 300)}`)
  }
  const user = parsed?.data?.user
  if (!user) {
    throw new Error(`Profile info: unexpected structure: ${body.slice(0, 300)}`)
  }
  return {
    id: String(user.id),
    isPrivate: !!user.is_private,
    profilePicUrl: user.profile_pic_url || "",
  }
}

export async function fetchFollowersPageFromCookies(
  userId: string,
  headers: Record<string, string>,
  cursor?: string,
): Promise<GraphQLPageResult> {
  const vars: Record<string, any> = { id: userId, first: PAGE_SIZE }
  if (cursor) vars.after = cursor

  const url = `https://www.instagram.com/graphql/query/?query_hash=${QUERY_HASH}&variables=${encodeURIComponent(JSON.stringify(vars))}`
  const response = await proxyFetch(url, { method: "GET", headers, redirect: "manual" })

  if (response.status === 302 || response.status === 303) {
    const loc = response.headers.get("location") || ""
    if (loc.includes("login") || loc.includes("accounts")) {
      throw new Error("SESSION_EXPIRED")
    }
  }

  if (response.status === 429) {
    throw new Error("RATE_LIMITED")
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Instagram API error (${response.status}): ${body.slice(0, 200)}`)
  }

  const text = await response.text()
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Instagram API returned non-JSON (${response.status}): ${text.slice(0, 300)}`)
  }
  return parseGraphQLResponse(parsed)
}

export async function extractFollowersFromCookies(
  options: CookieBasedOptions,
  targetUsername: string,
  onProgress: GraphQLProgressCallback,
): Promise<GraphQLExtractionResult> {
  const { headers, maxPages } = options

  const profile = await resolveProfileInfoFromCookies(targetUsername, headers)

  if (profile.isPrivate) {
    return {
      profilePicUrl: profile.profilePicUrl,
      isPrivate: true,
      avatarUrls: new Map(),
      totalFetched: 0,
      estimatedTotal: 0,
      pagesFetched: 0,
    }
  }

  const userId = profile.id

  let cursor: string | undefined
  let page = 0
  let totalFetched = 0
  let estimatedTotal = 0
  let requestCount = 0
  const avatarUrls = new Map<string, string>()

  while (requestCount < MAX_REQUESTS_PER_SESSION) {
    let result: GraphQLPageResult

    try {
      result = await fetchFollowersPageFromCookies(userId, headers, cursor)
    } catch (err: any) {
      if (err.message === "RATE_LIMITED") {
        const wait = Math.min(60000 * 2 ** requestCount, 300000)
        await new Promise((r) => setTimeout(r, wait))
        requestCount++
        continue
      }
      throw err
    }

    requestCount++

    if (page === 0) {
      estimatedTotal = result.estimatedTotal
    }

    const totalPages = Math.ceil(estimatedTotal / PAGE_SIZE)

    for (const entry of result.usernames) {
      totalFetched++
      if (entry.profilePicUrl) {
        avatarUrls.set(entry.username, entry.profilePicUrl)
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
      })
    }

    if (maxPages && requestCount >= maxPages) break
    if (!result.hasNextPage) break

    cursor = result.endCursor ?? undefined
    page++
    estimatedTotal = result.estimatedTotal
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS))
  }

  return {
    profilePicUrl: profile.profilePicUrl,
    isPrivate: false,
    avatarUrls,
    totalFetched,
    estimatedTotal,
    pagesFetched: page + 1,
  }
}

export async function extractFollowersGraphQLViaDriver(
  driver: WebDriver,
  targetUsername: string,
  onProgress: GraphQLProgressCallback,
  streamOptions?: GraphQLStreamOptions,
): Promise<GraphQLExtractionResult> {
  const profile = await resolveProfileInfoViaDriver(driver, targetUsername)

  if (profile.isPrivate) {
    return {
      profilePicUrl: profile.profilePicUrl,
      isPrivate: true,
      avatarUrls: new Map(),
      totalFetched: 0,
      estimatedTotal: 0,
      pagesFetched: 0,
    }
  }

  const userId = profile.id

  const sessionCookies = streamOptions?.cookies
  const useProxy = !!(sessionCookies && parseProxyUrl(PROXY_URL))

  const fetchPage = useProxy
    ? (cursor?: string) => fetchFollowersPageViaProxy(userId, sessionCookies, cursor)
    : (cursor?: string) => fetchFollowersPageViaDriver(driver, userId, cursor)

  let cursor: string | undefined
  let page = 0
  let totalFetched = 0
  let estimatedTotal = 0
  let requestCount = 0
  const avatarUrls = new Map<string, string>()

  while (requestCount < MAX_REQUESTS_PER_SESSION) {
    const result = await fetchPage(cursor)
    requestCount++

    if (page === 0) {
      estimatedTotal = result.estimatedTotal
    }

    const totalPages = Math.ceil(estimatedTotal / PAGE_SIZE)

    for (const entry of result.usernames) {
      totalFetched++
      if (entry.profilePicUrl) {
        avatarUrls.set(entry.username, entry.profilePicUrl)
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
      })
    }

    if (!result.hasNextPage) break

    cursor = result.endCursor ?? undefined
    page++
    estimatedTotal = result.estimatedTotal
    if (useProxy) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS))
    } else {
      await browserSleep(driver, REQUEST_DELAY_MS)
    }
  }

  return {
    profilePicUrl: profile.profilePicUrl,
    isPrivate: false,
    avatarUrls,
    totalFetched,
    estimatedTotal,
    pagesFetched: page + 1,
  }
}
