import {
  getExistingFollowerUsernames,
  isProfileAlreadyScraped,
  markProfileInvalid,
  markProfilePrivate,
  updateTargetProfileScraped,
  upsertFollower,
} from "@/lib/db/utils/instagram"

import { createChallenge } from "./challenges"
import { createDriver, extractCookies } from "./driver"
import { extractFollowersFromCookies, extractFollowersGraphQLViaDriver, extractSessionCookies } from "./graphql-extractor"
import { loginToInstagram } from "./login"
import { ScrapingEngine } from "./scraping-engine"
import { verifyProxyIP } from "./proxy-helper"
import { parseCookies, buildInstagramHeaders } from "./cookie-session"
import type { CookieObject } from "./cookie-session"
import type { VariableContext } from "./types"
import path from "node:path"

const ACTIONS_DIR = path.resolve(process.cwd(), "src/server/instagram/actions")
const REELS_YAML = path.join(ACTIONS_DIR, "reels.yaml")

const REEL_SCROLL_INTERVAL = 5
const MIN_DELAY_MS = 2000
const MAX_DELAY_MS = 5000

function randomDelay(): Promise<void> {
  const ms = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)
  return new Promise((r) => setTimeout(r, ms))
}

export interface ProgressEvent {
  type: "status" | "follower" | "invalid" | "duplicate" | "skipped" | "private" | "done" | "error" | "2fa_required"
  profileUsername?: string
  message?: string
  followerUsername?: string
  count?: number
  totalFollowers?: number
  invalidCount?: number
  privateCount?: number
  duplicateCount?: number
  processedCount?: number
  totalCount?: number
  error?: string
  credentialId?: string
  page?: number
  totalPages?: number
  estimatedTotal?: number
  totalEstimatedFollowers?: number
}

export type ProgressCallback = (event: ProgressEvent) => void | Promise<void>

export interface StreamOptions {
  credentials: {
    username: string
    password: string
    verificationCode?: string
  }
  credentialId?: string
  existingCookies?: Array<{
    name: string
    value: string
    domain: string
    path: string
    httpOnly?: boolean
    secure?: boolean
    expiry?: number
  }>
  usernames: string[]
}

export async function extractFollowersStream(options: StreamOptions, onProgress: ProgressCallback): Promise<void> {
  const driver = await createDriver()

  let totalFollowers = 0
  let totalEstimatedFollowers = 0
  let invalidCount = 0
  let privateCount = 0
  let duplicateCount = 0
  let processedCount = 0
  const totalCount = options.usernames.length

  try {
    await onProgress({
      type: "status",
      message: "Logging into Instagram...",
      processedCount,
      totalCount,
    })

    const loginResult = await loginToInstagram(driver, {
      username: options.credentials.username,
      password: options.credentials.password,
      verificationCode: options.credentials.verificationCode,
      credentialId: options.credentialId,
      existingCookies: options.existingCookies,
    })

    if (loginResult.needs2FA) {
      await onProgress({
        type: "2fa_required",
        credentialId: options.credentialId,
        message: "Verification code required. Check your email or authenticator app.",
      })

      if (!options.credentialId) {
        await onProgress({ type: "error", error: "No credential ID for 2FA challenge" })
        return
      }

      try {
        const code = await createChallenge(options.credentialId)

        await onProgress({ type: "status", message: "Submitting verification code..." })

        const nativeSet = `const el = arguments[0]; const val = arguments[1];
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
          if (setter) { setter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true })); }`

        const focused = await driver.executeScript("return document.activeElement")
        if (focused) {
          await driver.executeScript(nativeSet, focused, code)
          await new Promise((r) => setTimeout(r, 1000))

          await driver.executeScript(`
            const spans = document.querySelectorAll('span');
            for (const s of spans) {
              const txt = s.textContent.trim().toLowerCase();
              if (txt === 'log in' || txt === 'continue' || txt === 'confirm' || txt === 'verify' || txt === 'next') {
                let el = s;
                while (el.parentElement && el.parentElement.tagName !== 'BODY') {
                  if (el.parentElement.querySelector('[data-visualcompletion="ignore"]')) {
                    el.parentElement.click();
                    return;
                  }
                  el = el.parentElement;
                }
              }
            }
          `)

          await driver.wait(() => driver.executeScript("return !!document.querySelector('section main')"), 20000)

          if (options.credentialId) {
            const { saveSession } = await import("@/lib/db/utils/instagram")
            const cookies = await extractCookies(driver)
            await saveSession(options.credentialId, {
              cookies,
              userAgent: "Chrome",
              savedAt: new Date(),
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            })
          }
        } else {
          await onProgress({ type: "error", error: "No focused element for 2FA code" })
          return
        }
      } catch {
        await onProgress({ type: "error", error: "2FA challenge timed out" })
        return
      }
    } else if (!loginResult.success) {
      await onProgress({ type: "error", error: `Login failed: ${loginResult.error}` })
      return
    }

    await onProgress({
      type: "status",
      message: "Login successful — starting extraction",
      processedCount,
      totalCount,
    })

    const proxyCheck = await verifyProxyIP()
    if (!proxyCheck.ok) {
      await onProgress({
        type: "status",
        message: `WARNING: Proxy verification failed — ${proxyCheck.error} — continuing with direct connection`,
        processedCount,
        totalCount,
      })
    } else {
      await onProgress({
        type: "status",
        message: `Proxy verified — IP: ${proxyCheck.ip}${proxyCheck.region ? ` (${proxyCheck.region})` : ""}`,
        processedCount,
        totalCount,
      })
    }

    let sessionCookies = await extractSessionCookies(driver)
    const hasProxy = !!process.env.PROXY_URL || !!process.env.HTTPS_PROXY || !!process.env.HTTP_PROXY
    if (hasProxy) {
      await onProgress({
        type: "status",
        message: `Using proxy-based GraphQL extraction — session cookies captured`,
        processedCount,
        totalCount,
      })
    }

    const ctx: VariableContext = {
      credentials: options.credentials,
      profile: { username: "" },
    }
    const engine = new ScrapingEngine(driver, ctx)

    for (let i = 0; i < options.usernames.length; i++) {
      const targetUsername = options.usernames[i]
      processedCount = i + 1

      const alreadyScraped = await isProfileAlreadyScraped(targetUsername)
      if (alreadyScraped) {
        await onProgress({
          type: "skipped",
          profileUsername: targetUsername,
          message: `@${targetUsername} already scraped — skipping`,
          processedCount,
          totalCount,
        })
        continue
      }

      await onProgress({
        type: "status",
        profileUsername: targetUsername,
        message: `[${processedCount}/${totalCount}] Fetching followers for @${targetUsername} via API...`,
        processedCount,
        totalCount,
      })

      let profilePicUrl = ""
      let extractedCount = 0

      try {
        const existingFollowers = await getExistingFollowerUsernames(targetUsername)

        const result = await extractFollowersGraphQLViaDriver(
          driver,
          targetUsername,
          async (gqlEvent) => {
            if (gqlEvent.page === 1 && gqlEvent.estimatedTotal > 0) {
              totalEstimatedFollowers += gqlEvent.estimatedTotal
            }

            await onProgress({
              type: "status",
              profileUsername: targetUsername,
              message: gqlEvent.message,
              page: gqlEvent.page,
              totalPages: gqlEvent.totalPages,
              estimatedTotal: gqlEvent.estimatedTotal,
              totalEstimatedFollowers,
              processedCount,
              totalCount,
            })

            if (gqlEvent.followerUsername) {
              const username = gqlEvent.followerUsername
              if (existingFollowers.has(username)) {
                duplicateCount++
              } else {
                existingFollowers.add(username)
                await upsertFollower(targetUsername, username, undefined, gqlEvent.avatarUrl)
                extractedCount++
                totalFollowers++
              }

              await onProgress({
                type: "follower",
                profileUsername: targetUsername,
                followerUsername: username,
                count: extractedCount,
                totalFollowers,
                totalEstimatedFollowers,
                duplicateCount,
                invalidCount,
                processedCount,
                totalCount,
              })
            }
          },
          hasProxy ? { cookies: sessionCookies } : undefined,
        )

        if (result.isPrivate) {
          await markProfilePrivate(targetUsername)
          privateCount++
          await onProgress({
            type: "private",
            profileUsername: targetUsername,
            message: `@${targetUsername} is private — skipping`,
            privateCount,
            processedCount,
            totalCount,
          })
          continue
        }

        profilePicUrl = result.profilePicUrl

        await onProgress({
          type: "follower",
          profileUsername: targetUsername,
          followerUsername: undefined,
          count: extractedCount,
          totalFollowers,
          duplicateCount,
          invalidCount,
          processedCount,
          totalCount,
        })
      } catch (err: any) {
        const msg = err.message || ""

        if (msg.includes("SESSION_EXPIRED")) {
          await onProgress({
            type: "status",
            message: "Session expired — re-extracting cookies from browser",
            processedCount,
            totalCount,
          })
          sessionCookies = await extractSessionCookies(driver)
          i--
          continue
        }

        if (msg.includes("PROFILE_NOT_FOUND")) {
          await markProfileInvalid(targetUsername)
          invalidCount++
          await onProgress({
            type: "invalid",
            profileUsername: targetUsername,
            message: `@${targetUsername} not found`,
            invalidCount,
            processedCount,
            totalCount,
          })
        } else {
          await onProgress({
            type: "status",
            profileUsername: targetUsername,
            message: `@${targetUsername}: API error — ${msg} — skipping`,
            processedCount,
            totalCount,
          })
        }
        continue
      }

      await updateTargetProfileScraped(targetUsername, extractedCount, profilePicUrl)

      await onProgress({
        type: "status",
        profileUsername: targetUsername,
        message: `Done — extracted ${extractedCount} followers from @${targetUsername}`,
        totalFollowers,
        duplicateCount,
        invalidCount,
        processedCount,
        totalCount,
      })

      if (i < options.usernames.length - 1) {
        await onProgress({
          type: "status",
          message: `Waiting ${Math.round((MIN_DELAY_MS + MAX_DELAY_MS) / 2000)}s before next profile to avoid detection...`,
          processedCount,
          totalCount,
        })
        await randomDelay()
      }

      if ((i + 1) % REEL_SCROLL_INTERVAL === 0 && i < options.usernames.length - 1) {
        await onProgress({
          type: "status",
          message: `Scrolling reels to avoid detection (${processedCount}/${totalCount} profiles done)...`,
          processedCount,
          totalCount,
        })

        const reelDef = await engine.loadDefinition(REELS_YAML)
        await engine.execute(reelDef)

        await onProgress({
          type: "status",
          message: `Reel scroll done — continuing extraction`,
          processedCount,
          totalCount,
        })
      }
    }

    await onProgress({
      type: "done",
      message: "Extraction complete",
      totalFollowers,
      totalEstimatedFollowers,
      invalidCount,
      privateCount,
      duplicateCount,
      processedCount,
      totalCount,
    })
  } catch (error: any) {
    await onProgress({
      type: "error",
      error: error.message || "Unknown error during extraction",
      processedCount,
      totalCount,
    })
  } finally {
    await driver.quit()
  }
}

export interface CookieStreamOptions {
  cookies: CookieObject[]
  usernames: string[]
  maxPages?: number
}

export async function extractFollowersStreamFromCookies(
  options: CookieStreamOptions,
  onProgress: ProgressCallback,
): Promise<void> {
  let totalFollowers = 0
  let totalEstimatedFollowers = 0
  let invalidCount = 0
  let privateCount = 0
  let duplicateCount = 0
  let processedCount = 0
  const totalCount = options.usernames.length

  try {
    const session = parseCookies(options.cookies)
    if (!session.csrftoken || !session.sessionid || !session.ds_user_id) {
      await onProgress({
        type: "error",
        error: "Missing required cookies: csrftoken, sessionid, ds_user_id",
      })
      return
    }

    await onProgress({
      type: "status",
      message: "Parsed session cookies successfully",
      processedCount,
      totalCount,
    })

    const proxyCheck = await verifyProxyIP()
    if (!proxyCheck.ok) {
      await onProgress({
        type: "status",
        message: `WARNING: Proxy verification failed — ${proxyCheck.error} — continuing anyway`,
        processedCount,
        totalCount,
      })
    } else {
      await onProgress({
        type: "status",
        message: `Proxy verified — IP: ${proxyCheck.ip}${proxyCheck.region ? ` (${proxyCheck.region})` : ""}`,
        processedCount,
        totalCount,
      })
    }

    const headers = buildInstagramHeaders(session, options.cookies)

    await onProgress({
      type: "status",
      message: `Starting extraction for ${totalCount} profiles`,
      processedCount,
      totalCount,
    })

    for (let i = 0; i < options.usernames.length; i++) {
      const targetUsername = options.usernames[i]
      processedCount = i + 1

      const alreadyScraped = await isProfileAlreadyScraped(targetUsername)
      if (alreadyScraped) {
        await onProgress({
          type: "skipped",
          profileUsername: targetUsername,
          message: `@${targetUsername} already scraped — skipping`,
          processedCount,
          totalCount,
        })
        continue
      }

      await onProgress({
        type: "status",
        profileUsername: targetUsername,
        message: `[${processedCount}/${totalCount}] Fetching followers for @${targetUsername}...`,
        processedCount,
        totalCount,
      })

      let profilePicUrl = ""
      let extractedCount = 0

      try {
        const existingFollowers = await getExistingFollowerUsernames(targetUsername)

        const result = await extractFollowersFromCookies(
          { headers, sessionCookies: session, maxPages: options.maxPages },
          targetUsername,
          async (gqlEvent) => {
            if (gqlEvent.page === 1 && gqlEvent.estimatedTotal > 0) {
              totalEstimatedFollowers += gqlEvent.estimatedTotal
            }

            await onProgress({
              type: "status",
              profileUsername: targetUsername,
              message: gqlEvent.message,
              page: gqlEvent.page,
              totalPages: gqlEvent.totalPages,
              estimatedTotal: gqlEvent.estimatedTotal,
              totalEstimatedFollowers,
              processedCount,
              totalCount,
            })

            if (gqlEvent.followerUsername) {
              const username = gqlEvent.followerUsername
              if (existingFollowers.has(username)) {
                duplicateCount++
              } else {
                existingFollowers.add(username)
                await upsertFollower(targetUsername, username, undefined, gqlEvent.avatarUrl)
                extractedCount++
                totalFollowers++
              }

              await onProgress({
                type: "follower",
                profileUsername: targetUsername,
                followerUsername: username,
                count: extractedCount,
                totalFollowers,
                totalEstimatedFollowers,
                duplicateCount,
                invalidCount,
                processedCount,
                totalCount,
              })
            }
          },
        )

        if (result.isPrivate) {
          await markProfilePrivate(targetUsername)
          privateCount++
          await onProgress({
            type: "private",
            profileUsername: targetUsername,
            message: `@${targetUsername} is private — skipping`,
            privateCount,
            processedCount,
            totalCount,
          })
          continue
        }

        profilePicUrl = result.profilePicUrl

        await onProgress({
          type: "follower",
          profileUsername: targetUsername,
          followerUsername: undefined,
          count: extractedCount,
          totalFollowers,
          duplicateCount,
          invalidCount,
          processedCount,
          totalCount,
        })
      } catch (err: any) {
        const msg = err.message || ""

        if (msg.includes("SESSION_EXPIRED")) {
          await onProgress({
            type: "error",
            error: "Session expired — provide fresh cookies",
            processedCount,
            totalCount,
          })
          return
        }

        if (msg.includes("PROFILE_NOT_FOUND")) {
          await markProfileInvalid(targetUsername)
          invalidCount++
          await onProgress({
            type: "invalid",
            profileUsername: targetUsername,
            message: `@${targetUsername} not found`,
            invalidCount,
            processedCount,
            totalCount,
          })
        } else {
          await onProgress({
            type: "status",
            profileUsername: targetUsername,
            message: `@${targetUsername}: API error — ${msg} — skipping`,
            processedCount,
            totalCount,
          })
        }
        continue
      }

      await updateTargetProfileScraped(targetUsername, extractedCount, profilePicUrl)

      await onProgress({
        type: "status",
        profileUsername: targetUsername,
        message: `Done — extracted ${extractedCount} followers from @${targetUsername}`,
        totalFollowers,
        duplicateCount,
        invalidCount,
        processedCount,
        totalCount,
      })

      if (i < options.usernames.length - 1) {
        await onProgress({
          type: "status",
          message: `Waiting 3-5s before next profile to avoid detection...`,
          processedCount,
          totalCount,
        })
        await randomDelay()
      }
    }

    await onProgress({
      type: "done",
      message: "Extraction complete",
      totalFollowers,
      totalEstimatedFollowers,
      invalidCount,
      privateCount,
      duplicateCount,
      processedCount,
      totalCount,
    })
  } catch (error: any) {
    await onProgress({
      type: "error",
      error: error.message || "Unknown error during extraction",
      processedCount,
      totalCount,
    })
  }
}
