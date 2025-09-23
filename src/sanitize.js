// script to sanitize user input
// handles any string that is passed by the user, with an object to track what is being sanitized so it can choose a method
// too many helpers help pls
// thats 6
import { log, logConsoleOutput } from './logs.js'
import path from 'path'
import cron from 'node-cron'
/**
 * 
 * @param {object} input - an object of vars you want sanitized
 *                       - example object: { token: 'abc123', instance: 'https://example.com' }
 * @param {object} options - an object containing options for sanitization, just tracks what is being sanitized
 */
export async function sanitize(input, {
    token= false,
    instance= false,
    export_dir= false,
    freetube_dir= false,
    cron_schedule= false
}
) {
    if (token) {
        // sanitize token
        if (typeof input.token !== 'string') {
            log('Invalid token', { err: 'error' });
            process.exit(1);
        }
        if (input.token.length < 42) {
            log('Token too short', { err: 'error' });
            process.exit(1);
        }
        if (!input.token.includes('=')) {
            log('Invalid token format', { err: 'error' });
            process.exit(1);
        }
        if (input.token.includes(' ')) {
            log('Invalid token format', { err: 'error' });
            process.exit(1);
        }
    }
    if (instance) {
        // sanitize instance URL
        if (typeof input.instance !== 'string') {
            log('Invalid instance URL', { err: 'error' });
            process.exit(1);
        }
        if (input.instance.includes(' ')) {
            log('Invalid instance URL: contains spaces', { err: 'error' });
            process.exit(1);
        }
        const regex = /^https?:\/\/[^/]+/;
        if (!regex.test(input.instance)) {
            log('Invalid instance URL format. It must start with http:// or https://', { err: 'error' });
            process.exit(1);
        }
    }
    if (export_dir) {
        // sanitize export directory
        if (typeof input.export_dir !== 'string') {
            log('Invalid export directory', { err: 'error' });
            process.exit(1);
        }
        input.export_dir = path.resolve(input.export_dir);
    }
    if (freetube_dir) {
        // sanitize freetube directory
        if (typeof input.freetube_dir !== 'string') {
            log('Invalid freetube directory', { err: 'error' });
            process.exit(1);
        }
        input.freetube_dir = path.resolve(input.freetube_dir);
    }
    if (cron_schedule) {
        // sanitize cron schedule
        if (typeof input.cron_schedule !== 'string') {
            log('Invalid cron schedule', { err: 'error' });
            process.exit(1);
        }
        try {
            cron.validate(input.cron_schedule);
        } catch (err) {
            log('Invalid cron schedule format. The error was: ' + err.message || err, { err: 'error' });
            process.exit(1);
        }
    }
  return log('Input good!', { color: 'green'})
}
logConsoleOutput(); // write logs to file