// src/encryption.js
import crypto from 'crypto'
import keytar from 'keytar'
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
export async function getPassphrase() {
  let passphrase

  // Try system keychain first
  try {
    passphrase = await keytar.getPassword(SERVICE, ACCOUNT)
    if (passphrase) return passphrase
  } catch (e) {
    log(`Keychain access failed, falling back to alternatives, ${e.message || e}`, {
      err: 'warning',
    })
  }

  // Try environment variables
  if (process.env.FT_INV_KEY) {
    passphrase = process.env.FT_INV_KEY
  } else if (process.env.FT_INV_KEY_FILE) {
    try {
      passphrase = fs.readFileSync(path.resolve(process.env.FT_INV_KEY_FILE), 'utf8').trim()
    } catch (err) {
      log(`Failed to read key file: ${err.message || err}`, { err: 'error' })
    }
  }

  // If we got a passphrase from env/file, validate and store it
  if (passphrase) {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      throw new Error('Passphrase from environment is too short')
    }
    try {
      await keytar.setPassword(SERVICE, ACCOUNT, passphrase)
    } catch (err) {
      log(`Failed to store passphrase in keychain: ${err.message || err}`, { err: 'warning' })
    }
    return passphrase
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
    try {
      await keytar.setPassword(SERVICE, ACCOUNT, passphrase)
    } catch (err) {
      log(`Failed to store passphrase in keychain: ${err.message || err}`, { err: 'warning' })
    }
    return passphrase
  }

  throw new Error(
    'Could not get passphrase in headless environment. Set FT_INV_KEY or FT_INV_KEY_FILE'
  )
}

export async function changePassphraseInKeychain() {
  try {
    await keytar.deletePassword(SERVICE, ACCOUNT)
    const newPass = await prompt('Enter new passphrase: ', { type: 'password' })
    if (newPass.length < MIN_PASSPHRASE_LENGTH) {
      throw new Error(`New passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long`)
    }
    await keytar.setPassword(SERVICE, ACCOUNT, newPass)
    log('✅ Passphrase changed successfully in keychain.', { err: 'info' })
  } catch (err) {
    log(`Failed to change passphrase: ${err.message || err}`, { err: 'error' })
    // this is dumb and i dont reccomend it, but im too lazy to refactor right now
    throw err
  }
}
/**
 * Encrypt and rewrite plaintext tokens in config.
 */
export async function migrateToken(configPath, config) {
  if (typeof config.token !== 'string' || config.token.includes(':')) {
    return config // already encrypted or invalid
  }

  log('⚠️  Found plaintext token in config. Migrating...', { err: 'warning' })
  const passphrase = await getPassphrase()
  const encrypted = encryptToken(config.token, passphrase)
  config.token = encrypted

  // Save back to file
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  log('✅ Token encrypted and config updated.', { err: 'info' })

  return config
}

/**
 * Decrypt a token from config.
 */
export async function loadToken(token) {
  const raw = token
  if (typeof raw !== 'string') throw new Error('No token found in config')

  // Encrypted token
  if (raw.includes(':')) {
    const passphrase = await getPassphrase()
    const decrypted = decryptToken(raw, passphrase)
    if (!decrypted) throw new Error('Failed to decrypt token. Wrong key?')
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
