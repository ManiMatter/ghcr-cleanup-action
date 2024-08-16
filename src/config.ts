import * as core from '@actions/core'
import { Octokit } from '@octokit/rest'
import { throttling } from '@octokit/plugin-throttling'
import { retry } from '@octokit/plugin-retry'
import { requestLog } from '@octokit/plugin-request-log'
import { RequestError } from '@octokit/request-error'
import type { EndpointDefaults } from '@octokit/types'
import { MapPrinter } from './utils.js'
import humanInterval from 'human-interval'

// @ts-expect-error: esm errror
const MyOctokit = Octokit.plugin(requestLog, throttling, retry)

export enum LogLevel {
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
  defaultPackageUsed = false
  deleteTags?: string
  excludeTags?: string
  olderThanReadable?: string
  olderThan?: number
  deleteUntagged?: boolean
  deleteGhostImages?: boolean
  deletePartialImages?: boolean
  keepNuntagged?: number
  keepNtagged?: number
  dryRun?: boolean
  validate?: boolean
  logLevel: LogLevel
  token: string
  octokit: any

  constructor(token: string) {
    this.token = token
    this.logLevel = LogLevel.INFO

    this.octokit = new MyOctokit({
      auth: token,
      throttle: {
        onRateLimit: (
          retryAfter: number,
          options: EndpointDefaults,
          octokit: Octokit,
          retryCount: number
        ) => {
          core.info(
            `Octokit - request quota exhausted for request ${options.method} ${options.url}`
          )

          if (retryCount < 1) {
            // only retries once
            core.info(`Octokit - retrying after ${retryAfter} seconds!`)
            return true
          }
        },
        onSecondaryRateLimit: (
          retryAfter: number,
          options: EndpointDefaults,
          octokit: Octokit
        ) => {
          // does not retry, only logs a warning
          core.info(
            `Octokit - secondaryRateLimit detected for request ${options.method} ${options.url}`
          )
        }
      },
      log: {
        debug: (message: string) => {
          if (this.logLevel >= LogLevel.DEBUG) {
            core.info(`[Octokit DEBUG] ${message}`)
          }
        },
        info: (message: string) => {
          if (this.logLevel >= LogLevel.DEBUG) {
            core.info(`[Octokit DEBUG] ${message}`)
          }
        },
        warn: (message: string) => {
          if (this.logLevel >= LogLevel.WARN) {
            core.info(`[Octokit WARN] ${message}`)
          }
        },
        error: (message: string) => {
          if (this.logLevel >= LogLevel.INFO) {
            core.info(`[Octokit ERROR] ${message}`)
          }
        }
      }
    })
  }

  async getOwnerType(): Promise<string> {
    try {
      const result = await this.octokit.request(
        `GET /repos/${this.owner}/${this.repository}`
      )
      this.isPrivateRepo = result.data.private
      return result.data.owner.type
    } catch (error) {
      if (error instanceof RequestError) {
        if (error.status) {
          if (error.status === 404) {
            core.warning(
              `The repository is not found, check the owner value "${this.owner}" or the repository value "${this.repository}" are correct`
            )
          }
        }
      }
      // rethrow the error
      throw error
    }
  }
}

export function getConfig(): Config {
  const token: string = core.getInput('token', { required: true })
  const config = new Config(token)
  config.owner = core.getInput('owner')
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
        config.defaultPackageUsed = true
      } else {
        config.defaultPackageUsed = false
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
    config.deleteTags = core.getInput('tags')
  } else if (core.getInput('delete-tags')) {
    config.deleteTags = core.getInput('delete-tags')
  }

  config.excludeTags = core.getInput('exclude-tags')

  if (core.getInput('older-than')) {
    config.olderThan = humanInterval(core.getInput('older-than'))
    config.olderThanReadable = core.getInput('older-than')
  }

  if (core.getInput('keep-n-tagged')) {
    const n: number = parseInt(core.getInput('keep-n-tagged'))
    if (isNaN(n)) {
      throw new Error('keep-n-tagged is not number')
    } else if (n < 0) {
      throw new Error('keep-n-tagged is negative')
    } else {
      config.keepNtagged = n
    }
  }

  if (core.getInput('keep-n-untagged')) {
    const n: number = parseInt(core.getInput('keep-n-untagged'))
    if (isNaN(n)) {
      throw new Error('keep-n-untagged is not number')
    } else if (n < 0) {
      throw new Error('keep-n-untagged is negative')
    } else {
      config.keepNuntagged = n
    }
  }

  if (core.getInput('delete-untagged')) {
    config.deleteUntagged = core.getBooleanInput('delete-untagged')
  } else {
    // default is deleteUntagged if no options are set
    if (
      !core.getInput('tags') &&
      !core.getInput('delete-tags') &&
      !core.getInput('delete-ghost-images') &&
      !core.getInput('delete-partial-images') &&
      !core.getInput('keep-n-untagged') &&
      !core.getInput('keep-n-tagged')
    ) {
      config.deleteUntagged = true
    } else {
      config.deleteUntagged = false
    }
  }

  if (config.keepNuntagged && core.getInput('delete-untagged')) {
    throw new Error(
      'delete-untagged and keep-n-untagged can not be set at the same time'
    )
  }

  if (core.getInput('delete-ghost-images')) {
    config.deleteGhostImages = core.getBooleanInput('delete-ghost-images')
  } else {
    config.deleteGhostImages = false
  }
  if (core.getInput('delete-partial-images')) {
    config.deletePartialImages = core.getBooleanInput('delete-partial-images')
  } else {
    config.deletePartialImages = false
  }

  if (core.getInput('dry-run')) {
    config.dryRun = core.getBooleanInput('dry-run')
    if (config.dryRun) {
      core.info('***** In dry run mode - No packages will be deleted *****')
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

  const optionsMap = new MapPrinter()
  optionsMap.add('private repository', `${config.isPrivateRepo}`)
  optionsMap.add('project owner', `${config.owner}`)
  optionsMap.add('repository', `${config.repository}`)
  optionsMap.add('package', `${config.package}`)
  if (config.deleteTags) {
    optionsMap.add('delete-tags', config.deleteTags)
  }
  if (config.excludeTags) {
    optionsMap.add('exclude-tags', config.excludeTags)
  }
  if (config.olderThanReadable) {
    optionsMap.add('older-than', config.olderThanReadable)
  }
  if (config.deleteUntagged != null) {
    optionsMap.add('delete-untagged', `${config.deleteUntagged}`)
  }
  if (config.deleteGhostImages != null) {
    optionsMap.add('delete-ghost-images', `${config.deleteGhostImages}`)
  }
  if (config.deletePartialImages != null) {
    optionsMap.add('delete-partial-images', `${config.deletePartialImages}`)
  }
  if (config.keepNtagged != null) {
    optionsMap.add('keep-n-tagged', `${config.keepNtagged}`)
  }
  if (config.keepNuntagged != null) {
    optionsMap.add('keep-n-untagged', `${config.keepNuntagged}`)
  }
  if (config.dryRun != null) {
    optionsMap.add('dry-run', `${config.dryRun}`)
  }
  if (config.validate != null) {
    optionsMap.add('validate', `${config.validate}`)
  }
  optionsMap.add('log-level', LogLevel[config.logLevel])

  core.startGroup('Runtime configuration')
  optionsMap.print()
  core.endGroup()

  return config
}
