import * as yaml from "js-yaml";
import { By, until, type WebDriver } from "selenium-webdriver";

import type { ActionDefinition, ScrapeAction, VariableContext } from "./types";
import * as fs from "node:fs";
import * as path from "node:path";

function toBy(selector: string): By {
  if (selector.startsWith("//") || selector.startsWith("./") || selector.startsWith("(")) {
    return By.xpath(selector);
  }
  return By.css(selector);
}

function interpolate(value: string, ctx: VariableContext): string {
  return value.replace(/\{([^}]+)\}/g, (_match, p: string) => {
    const parts = p.split(".");
    let obj: unknown = ctx as Record<string, unknown>;
    for (const part of parts) {
      if (obj && typeof obj === "object" && part in (obj as Record<string, unknown>)) {
        obj = (obj as Record<string, unknown>)[part];
      } else {
        return _match;
      }
    }
    return obj == null ? '' : String(obj);
  });
}

function humanDelay(min = 300, max = 1200): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((r) => setTimeout(r, ms));
}

export class ScrapingEngine {
  private driver: WebDriver;
  private ctx: VariableContext;

  constructor(driver: WebDriver, ctx: VariableContext) {
    this.driver = driver;
    this.ctx = ctx;
  }

  async loadDefinition(filePath: string): Promise<ActionDefinition> {
    const raw = fs.readFileSync(path.resolve(filePath), "utf-8");
    return yaml.load(raw) as ActionDefinition;
  }

  async execute(definition: ActionDefinition): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    for (const action of definition.actions) {
      const result = await this.runAction(action);
      if (result !== undefined) {
        results[action.id] = result;
      }
    }

    return results;
  }

  private async runAction(action: ScrapeAction): Promise<unknown> {
    if (action.waitBefore) {
      await new Promise((r) => setTimeout(r, action.waitBefore));
    }

    const result = await this.dispatch(action);

    if (action.waitAfter) {
      await humanDelay(action.waitAfter, action.waitAfter + 300);
    }

    return result;
  }

  private async dispatch(action: ScrapeAction): Promise<unknown> {
    switch (action.action) {
      case "navigate": {
        await this.driver.get(action.url!);
        break;
      }

      case "wait": {
        if (action.selector) {
          await this.driver.wait(until.elementLocated(toBy(action.selector)), action.timeout || 10000);
          await this.driver.wait(until.elementIsVisible(await this.driver.findElement(toBy(action.selector))), 5000);
        }
        break;
      }

      case "waitFor": {
        await new Promise((r) => setTimeout(r, action.timeout || 1000));
        break;
      }

      case "type": {
        const value = interpolate(action.value || "", this.ctx);
        if (!value) break;
        let el: any;
        try {
          el = await this.waitForEl(action.selector!, action.timeout);
        } catch {
          el = await this.driver.executeScript("return document.activeElement");
        }
        if (!el) break;
        if (typeof el.click === "function") await el.click();
        await humanDelay(200, 400);
        await this.driver.executeScript(
          `const el = arguments[0];
           const val = arguments[1];
           const shouldClear = arguments[2];
           const setter = Object.getOwnPropertyDescriptor(
             HTMLInputElement.prototype, 'value'
           )?.set;
           if (shouldClear && setter) {
             setter.call(el, '');
             el.dispatchEvent(new Event('input', { bubbles: true }));
           }
           if (setter) {
             setter.call(el, val);
             el.dispatchEvent(new Event('input', { bubbles: true }));
             el.dispatchEvent(new Event('change', { bubbles: true }));
             el.dispatchEvent(new Event('blur', { bubbles: true }));
           }`,
          el, value, action.clear,
        );
        await humanDelay(400, 800);
        break;
      }

      case "click": {
        const el = await this.waitForEl(action.selector!, action.timeout);
        await this.driver.wait(until.elementIsVisible(el), 5000);
        await this.driver.wait(until.elementIsEnabled(el), 5000);
        await humanDelay(200, 500);
        await el.click();
        break;
      }

      case "clickIfExists": {
        const els = await this.driver.findElements(toBy(action.selector!));
        if (els.length > 0) {
          await humanDelay(200, 500);
          await els[0].click();
        }
        break;
      }

      case "extract": {
        const el = await this.waitForEl(action.selector!, action.timeout);
        const text = await el.getText();
        return text;
      }

      case "extractList": {
        await this.waitForEl(action.selector!, action.timeout);
        const els = await this.driver.findElements(toBy(action.selector!));
        const items: string[] = [];
        for (const el of els) {
          const t = await el.getText();
          if (t.trim()) items.push(t.trim());
        }
        return items;
      }

      case "scrollToBottom": {
        if (action.selector) {
          const el = await this.waitForEl(action.selector, action.timeout);
          await this.driver.executeScript("arguments[0].scrollTop = arguments[0].scrollHeight", el);
        } else {
          await this.driver.executeScript("window.scrollTo(0, document.body.scrollHeight)");
        }
        break;
      }

      case "javascript": {
        const script = interpolate(action.script || "", this.ctx);
        const val = action.value ? interpolate(action.value, this.ctx) : undefined;
        const result = await this.driver.executeScript(script, val);
        return result;
      }

      case "ifExists": {
        const els = await this.driver.findElements(toBy(action.selector!));
        if (els.length > 0) {
          if (action.then?.length) {
            for (const sub of action.then) {
              await this.runAction(sub);
            }
          }
        } else {
          if (action.else?.length) {
            for (const sub of action.else) {
              await this.runAction(sub);
            }
          }
        }
        break;
      }

      case "repeat": {
        for (let i = 0; i < (action.maxIterations || 10); i++) {
          if (action.actions) {
            for (const sub of action.actions) {
              await this.runAction(sub);
            }
          }
          await humanDelay(500, 1500);
        }
        break;
      }
    }

    return undefined;
  }

  private async waitForEl(selector: string, timeout?: number) {
    const el = await this.driver.wait(until.elementLocated(toBy(selector)), timeout || 10000);
    await this.driver.wait(until.elementIsVisible(el), 5000);
    return el;
  }
}
