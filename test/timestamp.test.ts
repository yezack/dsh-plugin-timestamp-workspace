import { strict as assert } from 'node:assert'
import { formatTimestamp } from '../src/client.js'

assert.equal(formatTimestamp(new Date(2026, 2, 8, 5, 6, 7)), '20260308050607')
assert.equal(formatTimestamp(new Date(2026, 10, 18, 15, 40, 59)), '20261118154059')
console.log('timestamp tests passed')
