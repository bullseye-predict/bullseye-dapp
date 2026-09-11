import browserProcess from 'process/browser'
import { Buffer } from 'buffer'
// The pinned Manifest SDK references Buffer during module initialization.
// Keep the compatibility shim at this adapter boundary, before importing it.
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer as typeof globalThis.Buffer

if (typeof globalThis.process === 'undefined') globalThis.process = browserProcess as typeof globalThis.process
