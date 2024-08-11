import * as core from '@actions/core'
import { Octokit } from '@octokit/rest'
import { throttling } from '@octokit/plugin-throttling'
import { retry } from '@octokit/plugin-retry'
import { requestLog } from '@octokit/plugin-request-log'
import type { EndpointDefaults } from '@octokit/types'

// @ts-expect-error: esm errror
const MyOctokit = Octokit.plugin(requestLog, throttling, retry)

enum LogLevel {
  ERROR = 1,
  WARN,
  INFO,
  DEBUG
}

export class Config {
  isPrivateRepo = false
  owner = ''
  repository = ''
  package = ''
  tags?: string
  excludeTags?: string
  deleteUntagged?: boolean
  keepNuntagged?: number
  keepNtagged?: number
  deleteGhostImages?: boolean
  deletePartialImages?: boolean
  dryRun?: boolean
  validate?: boolean
  logLevel: LogLevel
  token: string
  octokit: any

  constructor(token: string) {
    this.token = token
    this.logLevel = LogLevel.WARN

    this.octokit = new MyOctokit({
      auth: token,
      throttle: {
        onRateLimit: (
          retryAfter: number,
          options: EndpointDefaults,
          octokit: Octokit,
          retryCount: number
        ) => {
          octokit.log.warn(
            `Request quota exhausted for request ${options.method} ${options.url}`
          )

          if (retryCount < 1) {
            // only retries once
            octokit.log.info(`Retrying after ${retryAfter} seconds!`)
            return true
          }
        },
        onSecondaryRateLimit: (
          retryAfter: number,
          options: EndpointDefaults,
          octokit: Octokit
        ) => {
          // does not retry, only logs a warning
          octokit.log.warn(
            `SecondaryRateLimit detected for request ${options.method} ${options.url}`
          )
        }
      },
      log: {
        debug: (message: string) => {
          if (this.logLevel >= LogLevel.DEBUG) {
            console.log(`[DEBUG] ${message}`)
          }
        },
        info: (message: string) => {
          if (this.logLevel >= LogLevel.INFO) {
            console.log(`[INFO] ${message}`)
          }
        },
        warn: (message: string) => {
          if (this.logLevel >= LogLevel.WARN) {
            console.log(`[WARN] ${message}`)
          }
        },
        error: (message: string) => {
          if (this.logLevel >= LogLevel.INFO) {
            console.log(`[INFO] ${message}`)
          }
        }
      }
    })
  }

  async getOwnerType(): Promise<string> {
    const result = await this.octokit.request(
      `GET /repos/${this.owner}/${this.repository}`
    )
    this.isPrivateRepo = result.data.private
    return result.data.owner.type
  }
}

export function getConfig(): Config {
  const token: string = core.getInput('token', { required: true })
  const config = new Config(token)
  config.repository = core.getInput('repository')
  config.package = core.getInput('package')

  // auto populate
  const GITHUB_REPOSITORY = process.env['GITHUB_REPOSITORY']
  if (GITHUB_REPOSITORY) {
    const parts = GITHUB_REPOSITORY.split('/')
    if (parts.length === 2) {
      if (!config.owner) {
        config.owner = parts[0]
      }
      if (!config.package) {
        config.package = parts[1]
      }
      if (!config.repository) {
        config.repository = parts[1]
      }
    } else {
      throw Error(`Error parsing GITHUB_REPOSITORY: ${GITHUB_REPOSITORY}`)
    }
  } else {
    throw Error('GITHUB_REPOSITORY is not set')
  }

  if (core.getInput('tags') && core.getInput('delete-tags')) {
    throw Error(
      'tags and delete-tags cant be used at the same time, use either one'
    )
  }
  if (core.getInput('tags')) {
    config.tags = core.getInput('tags')
  } else if (core.getInput('delete-tags')) {
    config.tags = core.getInput('delete-tags')
  }

  config.excludeTags = core.getInput('not-delete-tags')

  if (core.getInput('keep-n-untagged')) {
    if (isNaN(parseInt(core.getInput('keep-n-untagged')))) {
      throw new Error('keep-n-untagged is not number')
    } else {
      config.keepNuntagged = parseInt(core.getInput('keep-n-untagged'))
    }
  }
  if (core.getInput('keep-n-tagged')) {
    if (isNaN(parseInt(core.getInput('keep-n-tagged')))) {
      throw new Error('keep-n-tagged is not number')
    } else {
      config.keepNtagged = parseInt(core.getInput('keep-n-tagged'))
    }
  }

  if (core.getInput('delete-untagged')) {
    config.deleteUntagged = core.getBooleanInput('delete-untagged')
  } else {
    // default is deleteUntagged if no options are set
    if (
      !core.getInput('tags') &&
      !core.getInput('keep-n-untagged') &&
      !core.getInput('keep-n-tagged')
    ) {
      config.deleteUntagged = true
    } else {
      config.deleteUntagged = false
    }
  }

  if (core.getInput('delete-ghost-images')) {
    config.deleteGhostImages = core.getBooleanInput('delete-ghost-images')
  }
  if (core.getInput('delete-partial-images')) {
    config.deletePartialImages = core.getBooleanInput('delete-partial-images')
  }

  if (core.getInput('dry-run')) {
    config.dryRun = core.getBooleanInput('dry-run')
    if (config.dryRun) {
      core.info('in dry run mode - no packages will be deleted')
    }
  } else {
    config.dryRun = false
  }

  if (core.getInput('validate')) {
    config.validate = core.getBooleanInput('validate')
  } else {
    config.validate = false
  }

  if (core.getInput('log-level')) {
    const level = core.getInput('log-level').toLowerCase()
    if (level === 'error') {
      config.logLevel = LogLevel.ERROR
    } else if (level === 'warn') {
      config.logLevel = LogLevel.WARN
    } else if (level === 'info') {
      config.logLevel = LogLevel.INFO
    } else if (level === 'debug') {
      config.logLevel = LogLevel.DEBUG
    }
  }

  if (!config.owner) {
    throw new Error('owner is not set')
  }
  if (!config.package) {
    throw new Error('package is not set')
  }
  if (!config.repository) {
    throw new Error('repository is not set')
  }

  return config
}
