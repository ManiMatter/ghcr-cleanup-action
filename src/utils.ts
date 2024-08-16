import * as core from '@actions/core'
import { createHash } from 'crypto'

export function calcDigest(manifest: string): string {
  return `sha256:${createHash('sha256').update(manifest).digest('hex').toLowerCase()}`
}

export function parseChallenge(challenge: string): Map<string, string> {
  const attributes = new Map<string, string>()
  if (challenge.startsWith('Bearer ')) {
    challenge = challenge.replace('Bearer ', '')
    const parts = challenge.split(',')
    for (const part of parts) {
      const values = part.split('=')
      let value = values[1]
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1)
      }
      attributes.set(values[0], value)
    }
  }
  return attributes
}

export function isValidChallenge(attributes: Map<string, string>): boolean {
  let valid = false
  if (
    attributes.has('realm') &&
    attributes.has('service') &&
    attributes.has('scope')
  ) {
    valid = true
  }
  return valid
}

export class MapPrinter {
  entries: Map<string, string> = new Map<string, string>()
  maxLength = 1

  add(entry: string, defaultValue: string): void {
    if (entry.length > this.maxLength) {
      this.maxLength = entry.length
    }
    this.entries.set(entry, defaultValue)
  }

  print(): void {
    const column = this.maxLength + 10
    for (const [key, value] of this.entries) {
      const spacer = ''.padEnd(column - key.length, ' ')
      core.info(`${key}${spacer}${value}`)
    }
  }
}
