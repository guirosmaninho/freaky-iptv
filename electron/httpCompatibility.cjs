const net = require('node:net');
const tls = require('node:tls');
const { Duplex } = require('node:stream');

const MAX_HEADER_BYTES = 16 * 1024;
const trimOws = value => value.replace(/^[ \t]+|[ \t]+$/g, '');

// RFC 9110 §8.6 permits collapsing identical decimal Content-Length values.
// Leave all other syntax to Node's strict parser; ambiguous framing is rejected.
function normalizeResponseHeaders(buffer) {
  const lines = buffer.toString('latin1').split('\r\n');
  const lengths = lines.filter(line => /^content-length:/i.test(line));
  if (!lengths.length) return buffer;
  const values = lengths.flatMap(line => line.slice(line.indexOf(':') + 1).split(',').map(trimOws));
  if (values.some(value => !/^\d+$/.test(value))) throw new Error('Invalid Content-Length header.');
  const length = BigInt(values[0]);
  if (values.some(value => BigInt(value) !== length)) throw new Error('Conflicting Content-Length headers.');
  if (lines.some(line => /^transfer-encoding:/i.test(line))) throw new Error('Ambiguous HTTP response framing.');
  if (values.length === 1) return buffer;
  let replaced = false;
  return Buffer.from(lines.filter(line => {
    if (!/^content-length:/i.test(line)) return true;
    if (replaced) return false;
    replaced = true;
    return true;
  }).map(line => /^content-length:/i.test(line) ? `Content-Length: ${length}` : line).join('\r\n'), 'latin1');
}

// Adapt just the response header block before Node's HTTP parser sees it.
// Node still handles body lengths, chunk decoding, truncation and backpressure.
class HeaderCompatibleSocket extends Duplex {
  constructor(socket, encrypted) {
    super();
    this.connection = socket;
    this.encrypted = encrypted;
    this.pendingHeaders = Buffer.alloc(0);
    this.headersComplete = false;
    this.informationalCount = 0;
    socket.on('data', chunk => {
      try { this.acceptData(chunk); }
      catch (error) { this.destroy(error); }
    });
    socket.once('end', () => this.push(null));
    socket.once('error', error => this.destroy(error));
    socket.once('close', () => { if (!socket.readableEnded) this.destroy(); });
    socket.on('timeout', () => this.emit('timeout'));
  }

  acceptData(chunk) {
    if (this.headersComplete) {
      if (!this.push(chunk)) this.connection.pause();
      return;
    }
    this.pendingHeaders = Buffer.concat([this.pendingHeaders, chunk]);
    let pause = false;
    while (!this.headersComplete && !this.destroyed) {
      const end = this.pendingHeaders.indexOf('\r\n\r\n');
      if (end < 0) {
        if (this.pendingHeaders.length > MAX_HEADER_BYTES) throw new Error('Response headers are too large.');
        break;
      }
      if (end + 4 > MAX_HEADER_BYTES) throw new Error('Response headers are too large.');
      const original = this.pendingHeaders.subarray(0, end);
      const remaining = this.pendingHeaders.subarray(end + 4);
      const status = /^HTTP\/\d\.\d (\d{3})/.exec(original.toString('latin1'));
      const informational = status && Number(status[1]) < 200 && Number(status[1]) !== 101;
      const headers = normalizeResponseHeaders(original);
      this.pendingHeaders = remaining;
      if (informational) {
        if (++this.informationalCount > 16) throw new Error('Too many informational HTTP responses.');
        if (!this.push(Buffer.concat([headers, Buffer.from('\r\n\r\n')]))) pause = true;
      } else {
        this.headersComplete = true;
        this.pendingHeaders = Buffer.alloc(0);
        if (!this.push(Buffer.concat([headers, Buffer.from('\r\n\r\n'), remaining]))) pause = true;
      }
    }
    if (pause) this.connection.pause();
  }

  _read() { this.connection.resume(); }
  _write(chunk, encoding, callback) { this.connection.write(chunk, encoding, callback); }
  _final(callback) { this.connection.end(callback); }
  _destroy(error, callback) { this.connection.destroy(); callback(error); }
  setTimeout(milliseconds, callback) {
    this.connection.setTimeout(milliseconds);
    if (callback) this.once('timeout', callback);
    return this;
  }
  setNoDelay(value) { this.connection.setNoDelay(value); return this; }
  setKeepAlive(value, delay) { this.connection.setKeepAlive(value, delay); return this; }
  ref() { this.connection.ref(); return this; }
  unref() { this.connection.unref(); return this; }
}

function createCompatibleConnection(parsedUrl, target, timeoutMs) {
  return (_options, callback) => {
    const encrypted = parsedUrl.protocol === 'https:';
    const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '');
    const options = { host: target.address, port: Number(parsedUrl.port || (encrypted ? 443 : 80)) };
    // The address is already validated/pinned, while SNI and certificate
    // validation continue to use the requested hostname.
    const socket = encrypted
      ? tls.connect({ ...options, servername: net.isIP(hostname) ? undefined : hostname })
      : net.createConnection(options);
    const fail = error => callback(error);
    socket.once('error', fail);
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('Timed out opening stream.')));
    socket.once(encrypted ? 'secureConnect' : 'connect', () => {
      socket.removeListener('error', fail);
      callback(null, new HeaderCompatibleSocket(socket, encrypted));
    });
  };
}

module.exports = { createCompatibleConnection };
