import crypto from 'crypto'
import { sanitizeFilename } from './sanitize.js'
let keytar
try {
  const _kt = await import('keytar')
  // Normalize ESM/CJS interop: prefer the real API object from default or module.exports.
  keytar = _kt && (_kt.default || _kt['module.exports'] || _kt)
} catch (e) {
  // often in headless linux environments like CI, docker, WSL, keytar won't be available
  keytar = null
  console.warn(
    '[ft-to-inv] ⚠️ Keytar module not found, keychain functionality will be disabled. Falling back to environment variables FT_INV_KEY / FT_INV_KEY_FILE. The error was:',
    e.message || e
  )
}
import readline from 'readline'
import { log } from './logs.js'
import fs from 'fs'
import path from 'path'

const SERVICE = 'ft-to-inv'
const ACCOUNT = 'tokenKey'
const ALGO = 'aes-256-gcm'

const CURRENT_VERSION = 'v1'
const MIN_PASSPHRASE_LENGTH = 8

/**
 * Derive a key from the passphrase.
 */
// Secure key derivation using PBKDF2
function getKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error('Invalid passphrase, change it with the --change-pass flag.')
  }
  // 600,000 iterations, 32-byte key length, SHA-256 digest
  return crypto.pbkdf2Sync(passphrase, salt, 600000, 32, 'sha256')
}

/**
 * Encrypt a token with the given passphrase.
 */
export async function encryptToken(token, passphrase) {
  const iv = crypto.randomBytes(16)
  const salt = crypto.randomBytes(16)
  const key = getKey(passphrase, salt)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  let encrypted = cipher.update(token, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag().toString('hex')
  // Add version prefix
  return `${CURRENT_VERSION}:${iv.toString('hex')}:${salt.toString('hex')}:${tag}:${encrypted}`
}

/**
 * Decrypt a token with the given passphrase.
 */
export async function decryptToken(enc, passphrase) {
  try {
    const parts = enc.split(':')
    // Handle versioned and legacy formats
    const [version, ...rest] = parts
    const [ivHex, saltHex, tagHex, data] = version === CURRENT_VERSION ? rest : parts

    const iv = Buffer.from(ivHex, 'hex')
    const salt = Buffer.from(saltHex, 'hex')
    const key = getKey(passphrase, salt)
    const decipher = crypto.createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    let decrypted = decipher.update(data, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch (err) {
    log(`Decryption failed: ${err.message}`, { err: 'error' })
    return null
  }
}

/**
 * Try to get the passphrase from keytar, fallback to prompt or env var.
 */
export async function getPassphrase({ persist = true } = {}) {
  let passphrase
  // Prefer environment variables first (explicit is better than OS keychain)
  if (process.env.FT_INV_KEY) {
    passphrase = process.env.FT_INV_KEY
  } else if (process.env.FT_INV_KEY_FILE) {
    try {
      passphrase = fs.readFileSync(path.resolve(process.env.FT_INV_KEY_FILE), 'utf8').trim()
    } catch (err) {
      log(`Failed to read key file: ${err.message || err}`, { err: 'warning' })
    }
  }

  if (passphrase) {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      throw new Error('Passphrase from environment is too short')
    }
    // If keytar is available, store it there for user convenience
    if (persist && keytar && keytar.setPassword) {
      try {
        await keytar.setPassword(SERVICE, ACCOUNT, passphrase)
      } catch (err) {
        log(`Failed to store passphrase in keychain: ${err.message || err}`, { err: 'warning' })
      }
    }
    return passphrase
  }

  // Next, try system keychain if present
  if (keytar && keytar.getPassword) {
    try {
      passphrase = await keytar.getPassword(SERVICE, ACCOUNT)
      if (passphrase) return passphrase
    } catch (e) {
      log(`Keychain access failed, falling back to prompt, ${e.message || e}`, { err: 'warning' })
    }
  }

  if (process.env.FT_INV_KEY) {
    return process.env.FT_INV_KEY
  }

  // Last resort: prompt user if not headless
  if (!process.env.CI && process.stdout.isTTY) {
    passphrase = await prompt('Enter a passphrase to secure your token: ')
    let betterPass
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      betterPass = await prompt(
        `Passphrase too short (min ${MIN_PASSPHRASE_LENGTH} chars). Please enter a longer one: `
      )
      if (betterPass.length >= MIN_PASSPHRASE_LENGTH) {
        passphrase = betterPass
      } else {
        throw new Error('its still too short buddy pal')
      }
    }
    if (!passphrase) {
      passphrase = 'ilikewaffles' + crypto.randomBytes(8).toString('hex')
      log('⚠️  No passphrase entered, generated one automatically. You should change this later.', {
        err: 'warning',
      })
    }
    // Try to persist it: prefer writing to FT_INV_KEY_FILE if provided, otherwise use keytar when available
    // note: i feel like this would be better to write to .env
    if (persist && process.env.FT_INV_KEY_FILE) {
      try {
        const safePath = sanitizeFilename(process.env.FT_INV_KEY_FILE)
        fs.writeFileSync(path.resolve(safePath), passphrase, { mode: 0o600 })
        log(`✅ Passphrase saved to file ${safePath}`, { err: 'info' })
      } catch (err) {
        log(`Failed to write passphrase to file: ${err.message || err}`, { err: 'warning' })
      }
    } else if (persist && keytar && keytar.setPassword) {
      try {
        await keytar.setPassword(SERVICE, ACCOUNT, passphrase)
      } catch (err) {
        log(`Failed to store passphrase in keychain: ${err.message || err}`, { err: 'warning' })
      }
    } else {
      log('No keytar available; please set FT_INV_KEY or FT_INV_KEY_FILE to persist passphrase.', {
        err: 'warning',
      })
    }

    return passphrase
  }

  throw new Error(
    'Could not get passphrase in headless environment. Set FT_INV_KEY or FT_INV_KEY_FILE'
  )
}

export async function changePassphraseInKeychain() {
  try {
    // If keytar is available, keep previous behavior
    if (keytar && keytar.deletePassword && keytar.setPassword) {
      await keytar.deletePassword(SERVICE, ACCOUNT)
      const newPass = await prompt('Enter new passphrase: ')
      if (newPass.length < MIN_PASSPHRASE_LENGTH) {
        throw new Error(`New passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long`)
      }
      await keytar.setPassword(SERVICE, ACCOUNT, newPass)
      log('✅ Passphrase changed successfully in keychain.', { err: 'info' })
      return
    }

    // Fallback when keytar isn't available: prompt and persist to FT_INV_KEY_FILE if configured
    const newPass = await prompt('Enter new passphrase: ')
    if (newPass.length < MIN_PASSPHRASE_LENGTH) {
      throw new Error(`New passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long`)
    }
    if (process.env.FT_INV_KEY_FILE) {
      try {
        const safePath = sanitizeFilename(process.env.FT_INV_KEY_FILE)
        fs.writeFileSync(path.resolve(safePath), newPass, { mode: 0o600 })
        log(`✅ Passphrase saved to file ${safePath}`, { err: 'info' })
        return
      } catch (err) {
        log(`Failed to write passphrase to file: ${err.message || err}`, { err: 'error' })
        throw err
      }
    }

    log('No keychain available. Set FT_INV_KEY or FT_INV_KEY_FILE to persist the passphrase.', {
      err: 'warning',
    })
  } catch (err) {
    log(`Failed to change passphrase: ${err.message || err}`, { err: 'error' })
    // this is dumb and i dont reccomend it, but im too lazy to refactor right now
    throw err
  }
}
/**
 * Encrypt and rewrite plaintext tokens in config.
 */
export async function migrateToken(token) {
  if (typeof token !== 'string' || token.includes(':')) {
    return token // already encrypted or invalid
  }

  log('Migrating plaintext token to encrypted storage...', { err: 'info' })
  const passphrase = await getPassphrase()
  const encrypted = encryptToken(token, passphrase)
  return encrypted
}

/**
 * Decrypt a token from config.
 */
export async function loadToken(token) {
  const raw = token
  if (typeof raw !== 'string') throw new Error('No token found in config')

  // Encrypted token
  if (raw.includes(':')) {
    // When decrypting, avoid persisting the passphrase until decryption succeeds
    const passphrase = await getPassphrase({ persist: false })
    const decrypted = await decryptToken(raw, passphrase)
    if (!decrypted) {
      // give user one more chance interactively if available
      if (!process.env.CI && process.stdout.isTTY) {
        const tryAgain = await prompt('Decryption failed. Re-enter passphrase: ')
        if (tryAgain && tryAgain.length >= MIN_PASSPHRASE_LENGTH) {
          const reDecrypted = await decryptToken(raw, tryAgain)
          if (reDecrypted) {
            // persist the successful passphrase when possible
            if (process.env.FT_INV_KEY_FILE) {
              try {
                const safePath = sanitizeFilename(process.env.FT_INV_KEY_FILE)
                fs.writeFileSync(path.resolve(safePath), tryAgain, {
                  mode: 0o600,
                })
                log(`✅ Passphrase saved to file ${safePath}`, { err: 'info' })
              } catch (err) {
                log(`Failed to write passphrase to file: ${err.message || err}`, { err: 'warning' })
              }
            } else if (keytar && keytar.setPassword) {
              try {
                await keytar.setPassword(SERVICE, ACCOUNT, tryAgain)
              } catch (err) {
                log(`Failed to store passphrase in keychain: ${err.message || err}`, {
                  err: 'warning',
                })
              }
            }
            return reDecrypted
          }
        }
      }
      throw new Error('Failed to decrypt token. Wrong key?')
    }
    return decrypted
  }

  // Plaintext token (legacy)
  log('⚠️ Using plaintext token. Run `ft-to-inv encrypt-token` to secure it.', { err: 'warning' })
  return raw
}

/**
 * Simple readline prompt helper.
 */
function prompt(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve =>
    rl.question(query, ans => {
      rl.close()
      resolve(ans.trim())
    })
  )
}
