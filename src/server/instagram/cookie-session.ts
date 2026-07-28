export interface CookieObject {
  domain: string
  name: string
  value: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expirationDate?: number
  session?: boolean
  sameSite?: string
  hostOnly?: boolean
  storeId?: string
}

export interface SessionFromCookies {
  csrftoken: string
  sessionid: string
  ds_user_id: string
  mid: string
  ig_did?: string
  rur?: string
  datr?: string
}

export function parseCookies(cookies: CookieObject[]): SessionFromCookies {
  const map = new Map(cookies.map((c) => [c.name, c.value]))
  return {
    csrftoken: map.get("csrftoken") || "",
    sessionid: map.get("sessionid") || "",
    ds_user_id: map.get("ds_user_id") || "",
    mid: map.get("mid") || "",
    ig_did: map.get("ig_did"),
    rur: map.get("rur"),
    datr: map.get("datr"),
  }
}

export function buildFullCookieHeader(cookies: CookieObject[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ")
}

export function buildInstagramHeaders(
  session: SessionFromCookies,
  allCookies?: CookieObject[],
): Record<string, string> {
  const cookieValue = allCookies
    ? buildFullCookieHeader(allCookies)
    : [
        `csrftoken=${session.csrftoken}`,
        `sessionid=${session.sessionid}`,
        `ds_user_id=${session.ds_user_id}`,
        `mid=${session.mid}`,
        ...(session.ig_did ? [`ig_did=${session.ig_did}`] : []),
        ...(session.rur ? [`rur=${session.rur}`] : []),
        ...(session.datr ? [`datr=${session.datr}`] : []),
      ].join("; ")

  return {
    "x-ig-app-id": "936619743392459",
    "x-requested-with": "XMLHttpRequest",
    "x-csrftoken": session.csrftoken,
    "cookie": cookieValue,
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "referer": "https://www.instagram.com/",
    "origin": "https://www.instagram.com",
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "sec-ch-ua": '"Not/A)Brand";v="99", "Google Chrome";v="126", "Chromium";v="126"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Linux"',
  }
}
