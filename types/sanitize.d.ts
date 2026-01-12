/* 
these have a good chance of throwing an error if you pass in anything that isn't "safe"
*/
export function sanitizeFilename(filename: string): string

export function sanitizePath(path: string): string

export function sanitizeToken(token: string): string

export function sanitizeInstance(instance: string): string

export function sanitizeCron(cron: string): string
