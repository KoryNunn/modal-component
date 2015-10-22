(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (global){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Safari 5-7 lacks support for changing the `Object.prototype.constructor` property
 *     on objects.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = global.TYPED_ARRAY_SUPPORT !== undefined
  ? global.TYPED_ARRAY_SUPPORT
  : typedArraySupport()

function typedArraySupport () {
  function Bar () {}
  try {
    var arr = new Uint8Array(1)
    arr.foo = function () { return 42 }
    arr.constructor = Bar
    return arr.foo() === 42 && // typed array instances can be augmented
        arr.constructor === Bar && // constructor can be set
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
}

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  this.length = 0
  this.parent = undefined

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined') {
    if (object.buffer instanceof ArrayBuffer) {
      return fromTypedArray(that, object)
    }
    if (object instanceof ArrayBuffer) {
      return fromArrayBuffer(that, object)
    }
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    array.byteLength
    that = Buffer._augment(new Uint8Array(array))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromTypedArray(that, new Uint8Array(array))
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

if (Buffer.TYPED_ARRAY_SUPPORT) {
  Buffer.prototype.__proto__ = Uint8Array.prototype
  Buffer.__proto__ = Uint8Array
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = '' + string

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'binary':
      // Deprecated
      case 'raw':
      case 'raws':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

function slowToString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` is deprecated
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` is deprecated
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = (value & 0xff)
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; i--) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"base64-js":2,"ieee754":3,"is-array":4}],2:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],3:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],4:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],5:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],6:[function(require,module,exports){
var createModal = require('../'),
    crel = require('crel');

window.onload = function(){

    // Create a modal.
    var modal = createModal({

        content: function(scope){
            // What to render when the modal is shown.
            // Return a string, a DOM node, or a fastn component here.

            return crel('div',
                crel('h1', 'Hello World'),
                'My cool modal'
            );
        }

    });

    document.body.appendChild(modal.element);

    var button = crel('button', 'Show modal');
    button.addEventListener('click', function(){
        modal.show(true);
    });

    document.body.appendChild(button);

};
},{"../":7,"crel":9}],7:[function(require,module,exports){
var fastn = require('fastn')({
    _generic: require('fastn/genericComponent'),
    list: require('fastn/listComponent'),
    templater: require('fastn/templaterComponent'),
    text: require('fastn/textComponent'),
    modal: require('./modalComponent')
});

module.exports = function(settings){
    return fastn('modal', settings).attach().render();
};
},{"./modalComponent":8,"fastn":23,"fastn/genericComponent":22,"fastn/listComponent":25,"fastn/templaterComponent":43,"fastn/textComponent":44}],8:[function(require,module,exports){
var crel = require('crel'),
    doc = require('doc-js'),
    defaultCss = require('defaultcss');

defaultCss('modal-component', '.modal-component{position:fixed;top:0;bottom:0;left:0;right:0;}.modal-component .content{background:white}');

module.exports = function(fastn, component, type, settings, children){
    var lastShowTime;

    component.extend('_generic', settings, children);

    component._type = 'modal';
    component._attachChildren = false;
    component.render = function(){
        component.element = document.createTextNode('');

        component.modalElement = crel('div', {'class':'modal-component'},
            component.containerElement = component.contentElement = crel('div', {'class':'content'})
        );

        component.emit('render');

        var handler = function(event){
            if(component.show() && !doc(event.target).closest(component.contentElement)){
                component.show(false);
            }
        };

        document.addEventListener('click', handler, true);

        component.on('destroy', function(){
            document.removeEventListener('click', handler, true);
            updateShow(false);
        });

        return component;
    };
    component._insert = function(element, index){
        if(!component.contentElement){
            return;
        }

        if(component.contentElement.childNodes[index] === element){
            return;
        }

        component.contentElement.insertBefore(element, component.contentElement.childNodes[index]);
    };

    var timeout;
    function waitForAnimation(callback){
        if(timeout){
            clearTimeout(timeout);
        }

        // Allow hide timeout for animations
        timeout = setTimeout(callback, settings.animationTime || 0);
    }

    var state = 'hidden';
    function setModalState(newState){
        doc(component.modalElement).removeClass(state).addClass(newState);
        state = newState;
        component.emit('state', state);
    }

    var contentChild;

    function clearContentChild(){
        if(contentChild){
            component.remove(contentChild);
            contentChild.destroy();
            contentChild = null;
        }
    }

    function updateShow(show){
        if(!component.element){
            return;
        }

        if(show){
            lastShowTime = Date.now();

            clearContentChild();

            if(component._settings.content){
                contentChild = fastn.toComponent(component._settings.content(component.scope()));
                component.insert(contentChild);
            }

            if(!component.modalElement.parentNode){
                crel(document.body, component.modalElement);
            }

            setModalState('showing');

            waitForAnimation(function(){
                setModalState('shown');
            });
        }else{
            setModalState('hiding');

            waitForAnimation(function(){
                setModalState('hidden');

                if(component.modalElement.parentNode){
                    component.modalElement.parentNode.removeChild(component.modalElement);
                }

                clearContentChild();
            });
        }
    }

    component.setProperty('show');
    component.show.updater(updateShow);

    return component;
};

module.exports.expectedComponents = ['text', '_generic', 'list', 'templater'];
},{"crel":9,"defaultcss":10,"doc-js":12}],9:[function(require,module,exports){
//Copyright (C) 2012 Kory Nunn

//Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

//The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

//THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

/*

    This code is not formatted for readability, but rather run-speed and to assist compilers.

    However, the code's intention should be transparent.

    *** IE SUPPORT ***

    If you require this library to work in IE7, add the following after declaring crel.

    var testDiv = document.createElement('div'),
        testLabel = document.createElement('label');

    testDiv.setAttribute('class', 'a');
    testDiv['className'] !== 'a' ? crel.attrMap['class'] = 'className':undefined;
    testDiv.setAttribute('name','a');
    testDiv['name'] !== 'a' ? crel.attrMap['name'] = function(element, value){
        element.id = value;
    }:undefined;


    testLabel.setAttribute('for', 'a');
    testLabel['htmlFor'] !== 'a' ? crel.attrMap['for'] = 'htmlFor':undefined;



*/

(function (root, factory) {
    if (typeof exports === 'object') {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define(factory);
    } else {
        root.crel = factory();
    }
}(this, function () {
    var fn = 'function',
        obj = 'object',
        nodeType = 'nodeType',
        textContent = 'textContent',
        setAttribute = 'setAttribute',
        attrMapString = 'attrMap',
        isNodeString = 'isNode',
        isElementString = 'isElement',
        d = typeof document === obj ? document : {},
        isType = function(a, type){
            return typeof a === type;
        },
        isNode = typeof Node === fn ? function (object) {
            return object instanceof Node;
        } :
        // in IE <= 8 Node is an object, obviously..
        function(object){
            return object &&
                isType(object, obj) &&
                (nodeType in object) &&
                isType(object.ownerDocument,obj);
        },
        isElement = function (object) {
            return crel[isNodeString](object) && object[nodeType] === 1;
        },
        isArray = function(a){
            return a instanceof Array;
        },
        appendChild = function(element, child) {
          if(!crel[isNodeString](child)){
              child = d.createTextNode(child);
          }
          element.appendChild(child);
        };


    function crel(){
        var args = arguments, //Note: assigned to a variable to assist compilers. Saves about 40 bytes in closure compiler. Has negligable effect on performance.
            element = args[0],
            child,
            settings = args[1],
            childIndex = 2,
            argumentsLength = args.length,
            attributeMap = crel[attrMapString];

        element = crel[isElementString](element) ? element : d.createElement(element);
        // shortcut
        if(argumentsLength === 1){
            return element;
        }

        if(!isType(settings,obj) || crel[isNodeString](settings) || isArray(settings)) {
            --childIndex;
            settings = null;
        }

        // shortcut if there is only one child that is a string
        if((argumentsLength - childIndex) === 1 && isType(args[childIndex], 'string') && element[textContent] !== undefined){
            element[textContent] = args[childIndex];
        }else{
            for(; childIndex < argumentsLength; ++childIndex){
                child = args[childIndex];

                if(child == null){
                    continue;
                }

                if (isArray(child)) {
                  for (var i=0; i < child.length; ++i) {
                    appendChild(element, child[i]);
                  }
                } else {
                  appendChild(element, child);
                }
            }
        }

        for(var key in settings){
            if(!attributeMap[key]){
                element[setAttribute](key, settings[key]);
            }else{
                var attr = attributeMap[key];
                if(typeof attr === fn){
                    attr(element, settings[key]);
                }else{
                    element[setAttribute](attr, settings[key]);
                }
            }
        }

        return element;
    }

    // Used for mapping one kind of attribute to the supported version of that in bad browsers.
    crel[attrMapString] = {};

    crel[isElementString] = isElement;

    crel[isNodeString] = isNode;

    return crel;
}));

},{}],10:[function(require,module,exports){
/* jshint node: true */
'use strict';

/**
  # defaultcss

  A very simple module for creating a little bit of defaultcss.  This is
  really useful if you are creating a small JS widget that you want to be
  completely stylable by the application implementer but would also like it
  to look "kind of ok" if someone want to have a quick play.

  ## How it Works

  The provided css text is injected into the HTML document within the document
  `<head>` prior to any other `<link>` or `<style>` tags.  This ensures that
  any definitions that are made within your provided CSS have ample
  opportunity to be overridden by user defined CSS.

  ## Example Usage

  <<< examples/widget.js

  ## Reference

  ### defaultcss

  ```
  defaultcss(label, csstext)
  ```

  Create a new default `style` element and use the provided `label` to
  generate an id for the element "%label%_defaultstyle".  If an existing
  element with that id is found, then do nothing.

  If not, then create the new element and use the provided `csstext` as
  `innerText` for th element.
**/
module.exports = function(label, text) {
  var styleId = label + '_defaultstyle';

  // look for a DOM element with the style id
  var styleEl = document.getElementById(styleId);

  // find the first <link> or <style> tag within the document head
  var firstStyleDef = document.querySelector('link[rel="stylesheet"],style');

  // if we can find a DOM element with that id, then do nothing as a default
  // style has already been applied
  if (styleEl) {
    return styleEl;
  }

  // otherwise, create a style element
  styleEl = document.createElement('style');
  styleEl.innerHTML = text;

  // insert the style element, in order or preference
  // 1. before the first style related element in the page
  if (firstStyleDef) {
    firstStyleDef.parentNode.insertBefore(styleEl, firstStyleDef);
  }
  // 2. to the end of the HEAD
  else if (document.head) {
    document.head.appendChild(styleEl);
  }
  // 3. as the first element in the body
  else if (document.body && document.body.childNodes.length > 0) {
    document.body.insertBefore(styleEl, document.body.childNodes[0]);
  }
  // 4. in the body
  else if (document.body) {
    document.body.appendChild(styleEl);
  }

  return styleEl;
};

},{}],11:[function(require,module,exports){
var doc = {
    document: typeof document !== 'undefined' ? document : null,
    setDocument: function(d){
        this.document = d;
    }
};

var arrayProto = [],
    isList = require('./isList'),
    getTargets = require('./getTargets')(doc.document),
    getTarget = require('./getTarget')(doc.document),
    space = ' ';


///[README.md]

function isIn(array, item){
    for(var i = 0; i < array.length; i++) {
        if(item === array[i]){
            return true;
        }
    }
}

/**

    ## .find

    finds elements that match the query within the scope of target

        //fluent
        doc(target).find(query);

        //legacy
        doc.find(target, query);
*/

function find(target, query){
    target = getTargets(target);
    if(query == null){
        return target;
    }

    if(isList(target)){
        var results = [];
        for (var i = 0; i < target.length; i++) {
            var subResults = doc.find(target[i], query);
            for(var j = 0; j < subResults.length; j++) {
                if(!isIn(results, subResults[j])){
                    results.push(subResults[j]);
                }
            }
        }
        return results;
    }

    return target ? target.querySelectorAll(query) : [];
}

/**

    ## .findOne

    finds the first element that matches the query within the scope of target

        //fluent
        doc(target).findOne(query);

        //legacy
        doc.findOne(target, query);
*/

function findOne(target, query){
    target = getTarget(target);
    if(query == null){
        return target;
    }

    if(isList(target)){
        var result;
        for (var i = 0; i < target.length; i++) {
            result = findOne(target[i], query);
            if(result){
                break;
            }
        }
        return result;
    }

    return target ? target.querySelector(query) : null;
}

/**

    ## .closest

    recurses up the DOM from the target node, checking if the current element matches the query

        //fluent
        doc(target).closest(query);

        //legacy
        doc.closest(target, query);
*/

function closest(target, query){
    target = getTarget(target);

    if(isList(target)){
        target = target[0];
    }

    while(
        target &&
        target.ownerDocument &&
        !is(target, query)
    ){
        target = target.parentNode;
    }

    return target === doc.document && target !== query ? null : target;
}

/**

    ## .is

    returns true if the target element matches the query

        //fluent
        doc(target).is(query);

        //legacy
        doc.is(target, query);
*/

function is(target, query){
    target = getTarget(target);

    if(isList(target)){
        target = target[0];
    }

    if(!target.ownerDocument || typeof query !== 'string'){
        return target === query;
    }

    if(target === query){
        return true;
    }

    var parentless = !target.parentNode;

    if(parentless){
        // Give the element a parent so that .querySelectorAll can be used
        document.createDocumentFragment().appendChild(target);
    }

    var result = arrayProto.indexOf.call(find(target.parentNode, query), target) >= 0;

    if(parentless){
        target.parentNode.removeChild(target);
    }

    return result;
}

/**

    ## .addClass

    adds classes to the target (space separated string or array)

        //fluent
        doc(target).addClass(query);

        //legacy
        doc.addClass(target, query);
*/

function addClass(target, classes){
    target = getTargets(target);

    if(isList(target)){
        for (var i = 0; i < target.length; i++) {
            addClass(target[i], classes);
        }
        return this;
    }
    if(!classes){
        return this;
    }

    var classes = Array.isArray(classes) ? classes : classes.split(space),
        currentClasses = target.classList ? null : target.className.split(space);

    for(var i = 0; i < classes.length; i++){
        var classToAdd = classes[i];
        if(!classToAdd || classToAdd === space){
            continue;
        }
        if(target.classList){
            target.classList.add(classToAdd);
        } else if(!currentClasses.indexOf(classToAdd)>=0){
            currentClasses.push(classToAdd);
        }
    }
    if(!target.classList){
        target.className = currentClasses.join(space);
    }
    return this;
}

/**

    ## .removeClass

    removes classes from the target (space separated string or array)

        //fluent
        doc(target).removeClass(query);

        //legacy
        doc.removeClass(target, query);
*/

function removeClass(target, classes){
    target = getTargets(target);

    if(isList(target)){
        for (var i = 0; i < target.length; i++) {
            removeClass(target[i], classes);
        }
        return this;
    }

    if(!classes){
        return this;
    }

    var classes = Array.isArray(classes) ? classes : classes.split(space),
        currentClasses = target.classList ? null : target.className.split(space);

    for(var i = 0; i < classes.length; i++){
        var classToRemove = classes[i];
        if(!classToRemove || classToRemove === space){
            continue;
        }
        if(target.classList){
            target.classList.remove(classToRemove);
            continue;
        }
        var removeIndex = currentClasses.indexOf(classToRemove);
        if(removeIndex >= 0){
            currentClasses.splice(removeIndex, 1);
        }
    }
    if(!target.classList){
        target.className = currentClasses.join(space);
    }
    return this;
}

function addEvent(settings){
    var target = getTarget(settings.target);
    if(target){
        target.addEventListener(settings.event, settings.callback, false);
    }else{
        console.warn('No elements matched the selector, so no events were bound.');
    }
}

/**

    ## .on

    binds a callback to a target when a DOM event is raised.

        //fluent
        doc(target/proxy).on(events, target[optional], callback);

    note: if a target is passed to the .on function, doc's target will be used as the proxy.

        //legacy
        doc.on(events, target, query, proxy[optional]);
*/

function on(events, target, callback, proxy){

    proxy = getTargets(proxy);

    if(!proxy){
        target = getTargets(target);
        // handles multiple targets
        if(isList(target)){
            var multiRemoveCallbacks = [];
            for (var i = 0; i < target.length; i++) {
                multiRemoveCallbacks.push(on(events, target[i], callback, proxy));
            }
            return function(){
                while(multiRemoveCallbacks.length){
                    multiRemoveCallbacks.pop();
                }
            };
        }
    }

    // handles multiple proxies
    // Already handles multiple proxies and targets,
    // because the target loop calls this loop.
    if(isList(proxy)){
        var multiRemoveCallbacks = [];
        for (var i = 0; i < proxy.length; i++) {
            multiRemoveCallbacks.push(on(events, target, callback, proxy[i]));
        }
        return function(){
            while(multiRemoveCallbacks.length){
                multiRemoveCallbacks.pop();
            }
        };
    }

    var removeCallbacks = [];

    if(typeof events === 'string'){
        events = events.split(space);
    }

    for(var i = 0; i < events.length; i++){
        var eventSettings = {};
        if(proxy){
            if(proxy === true){
                proxy = doc.document;
            }
            eventSettings.target = proxy;
            eventSettings.callback = function(event){
                var closestTarget = closest(event.target, target);
                if(closestTarget){
                    callback(event, closestTarget);
                }
            };
        }else{
            eventSettings.target = target;
            eventSettings.callback = callback;
        }

        eventSettings.event = events[i];

        addEvent(eventSettings);

        removeCallbacks.push(eventSettings);
    }

    return function(){
        while(removeCallbacks.length){
            var removeCallback = removeCallbacks.pop();
            getTarget(removeCallback.target).removeEventListener(removeCallback.event, removeCallback.callback);
        }
    }
}

/**

    ## .off

    removes events assigned to a target.

        //fluent
        doc(target/proxy).off(events, target[optional], callback);

    note: if a target is passed to the .on function, doc's target will be used as the proxy.

        //legacy
        doc.off(events, target, callback, proxy);
*/

function off(events, target, callback, proxy){
    if(isList(target)){
        for (var i = 0; i < target.length; i++) {
            off(events, target[i], callback, proxy);
        }
        return this;
    }
    if(proxy instanceof Array){
        for (var i = 0; i < proxy.length; i++) {
            off(events, target, callback, proxy[i]);
        }
        return this;
    }

    if(typeof events === 'string'){
        events = events.split(space);
    }

    if(typeof callback !== 'function'){
        proxy = callback;
        callback = null;
    }

    proxy = proxy ? getTarget(proxy) : doc.document;

    var targets = typeof target === 'string' ? find(target, proxy) : [target];

    for(var targetIndex = 0; targetIndex < targets.length; targetIndex++){
        var currentTarget = targets[targetIndex];

        for(var i = 0; i < events.length; i++){
            currentTarget.removeEventListener(events[i], callback);
        }
    }
    return this;
}

/**

    ## .append

    adds elements to a target

        //fluent
        doc(target).append(children);

        //legacy
        doc.append(target, children);
*/

function append(target, children){
    var target = getTarget(target),
        children = getTarget(children);

    if(isList(target)){
        target = target[0];
    }

    if(isList(children)){
        for (var i = 0; i < children.length; i++) {
            append(target, children[i]);
        }
        return;
    }

    target.appendChild(children);
}

/**

    ## .prepend

    adds elements to the front of a target

        //fluent
        doc(target).prepend(children);

        //legacy
        doc.prepend(target, children);
*/

function prepend(target, children){
    var target = getTarget(target),
        children = getTarget(children);

    if(isList(target)){
        target = target[0];
    }

    if(isList(children)){
        //reversed because otherwise the would get put in in the wrong order.
        for (var i = children.length -1; i; i--) {
            prepend(target, children[i]);
        }
        return;
    }

    target.insertBefore(children, target.firstChild);
}

/**

    ## .isVisible

    checks if an element or any of its parents display properties are set to 'none'

        //fluent
        doc(target).isVisible();

        //legacy
        doc.isVisible(target);
*/

function isVisible(target){
    var target = getTarget(target);
    if(!target){
        return;
    }
    if(isList(target)){
        var i = -1;

        while (target[i++] && isVisible(target[i])) {}
        return target.length >= i;
    }
    while(target.parentNode && target.style.display !== 'none'){
        target = target.parentNode;
    }

    return target === doc.document;
}

/**

    ## .indexOfElement

    returns the index of the element within it's parent element.

        //fluent
        doc(target).indexOfElement();

        //legacy
        doc.indexOfElement(target);

*/

function indexOfElement(target) {
    target = getTargets(target);
    if(!target){
        return;
    }

    if(isList(target)){
        target = target[0];
    }

    var i = -1;

    var parent = target.parentElement;

    if(!parent){
        return i;
    }

    while(parent.children[++i] !== target){}

    return i;
}


/**

    ## .ready

    call a callback when the document is ready.

    returns -1 if there is no parentElement on the target.

        //fluent
        doc().ready(callback);

        //legacy
        doc.ready(callback);
*/

function ready(callback){
    if(doc.document && (doc.document.readyState === 'complete' || doc.document.readyState === 'interactive')){
        callback();
    }else if(window.attachEvent){
        document.attachEvent("onreadystatechange", callback);
        window.attachEvent("onLoad",callback);
    }else if(document.addEventListener){
        document.addEventListener("DOMContentLoaded",callback,false);
    }
}

doc.find = find;
doc.findOne = findOne;
doc.closest = closest;
doc.is = is;
doc.addClass = addClass;
doc.removeClass = removeClass;
doc.off = off;
doc.on = on;
doc.append = append;
doc.prepend = prepend;
doc.isVisible = isVisible;
doc.ready = ready;
doc.indexOfElement = indexOfElement;

module.exports = doc;
},{"./getTarget":13,"./getTargets":14,"./isList":15}],12:[function(require,module,exports){
var doc = require('./doc'),
    isList = require('./isList'),
    getTargets = require('./getTargets')(doc.document),
    flocProto = [];

function Floc(items){
    this.push.apply(this, items);
}
Floc.prototype = flocProto;
flocProto.constructor = Floc;

function floc(target){
    var instance = getTargets(target);

    if(!isList(instance)){
        if(instance){
            instance = [instance];
        }else{
            instance = [];
        }
    }
    return new Floc(instance);
}

var returnsSelf = 'addClass removeClass append prepend'.split(' ');

for(var key in doc){
    if(typeof doc[key] === 'function'){
        floc[key] = doc[key];
        flocProto[key] = (function(key){
            var instance = this;
            // This is also extremely dodgy and fast
            return function(a,b,c,d,e,f){
                var result = doc[key](this, a,b,c,d,e,f);

                if(result !== doc && isList(result)){
                    return floc(result);
                }
                if(returnsSelf.indexOf(key) >=0){
                    return instance;
                }
                return result;
            };
        }(key));
    }
}
flocProto.on = function(events, target, callback){
    var proxy = this;
    if(typeof target === 'function'){
        callback = target;
        target = this;
        proxy = null;
    }
    doc.on(events, target, callback, proxy);
    return this;
};

flocProto.off = function(events, target, callback){
    var reference = this;
    if(typeof target === 'function'){
        callback = target;
        target = this;
        reference = null;
    }
    doc.off(events, target, callback, reference);
    return this;
};

flocProto.ready = function(callback){
    doc.ready(callback);
    return this;
};

flocProto.addClass = function(className){
    doc.addClass(this, className);
    return this;
};

flocProto.removeClass = function(className){
    doc.removeClass(this, className);
    return this;
};

module.exports = floc;
},{"./doc":11,"./getTargets":14,"./isList":15}],13:[function(require,module,exports){
var singleId = /^#\w+$/;

module.exports = function(document){
    return function getTarget(target){
        if(typeof target === 'string'){
            if(singleId.exec(target)){
                return document.getElementById(target.slice(1));
            }
            return document.querySelector(target);
        }

        return target;
    };
};
},{}],14:[function(require,module,exports){

var singleClass = /^\.\w+$/,
    singleId = /^#\w+$/,
    singleTag = /^\w+$/;

module.exports = function(document){
    return function getTargets(target){
        if(typeof target === 'string'){
            if(singleId.exec(target)){
                // If you have more than 1 of the same id in your page,
                // thats your own stupid fault.
                return [document.getElementById(target.slice(1))];
            }
            if(singleTag.exec(target)){
                return document.getElementsByTagName(target);
            }
            if(singleClass.exec(target)){
                return document.getElementsByClassName(target.slice(1));
            }
            return document.querySelectorAll(target);
        }

        return target;
    };
};
},{}],15:[function(require,module,exports){
module.exports = function isList(object){
    return object != null && typeof object === 'object' && 'length' in object && !('nodeType' in object) && object.self != object; // in IE8, window.self is window, but it is not === window, but it is == window......... WTF!?
}
},{}],16:[function(require,module,exports){
var is = require('./is'),
    GENERIC = '_generic',
    EventEmitter = require('events').EventEmitter,
    slice = Array.prototype.slice;

function flatten(item){
    return Array.isArray(item) ? item.reduce(function(result, element){
        if(element == null){
            return result;
        }
        return result.concat(flatten(element));
    },[]) : item;
}

function attachProperties(object, firm){
    for(var key in this._properties){
        this._properties[key].attach(object, firm);
    }
}

function onRender(){

    // Ensure all bindings are somewhat attached just before rendering
    this.attach(undefined, 0);

    for(var key in this._properties){
        this._properties[key].update();
    }
}

function detachProperties(firm){
    for(var key in this._properties){
        this._properties[key].detach(firm);
    }
}

function destroyProperties(){
    for(var key in this._properties){
        this._properties[key].destroy();
    }
}

function clone(){
    return this.fastn(this.component._type, this.component._settings, this.component._children.filter(function(child){
            return !child._templated;
        }).map(function(child){
            return child.clone();
        })
    );
}

function getSetBinding(newBinding){
    if(!arguments.length){
        return this.binding;
    }

    if(!is.binding(newBinding)){
        newBinding = this.fastn.binding(newBinding);
    }

    if(this.binding && this.binding !== newBinding){
        this.binding.removeListener('change', this.emitAttach);
        newBinding.attach(this.binding._model, this.binding._firm);
    }

    this.binding = newBinding;

    this.binding.on('change', this.emitAttach);
    this.binding.on('detach', this.emitDetach);

    this.emitAttach();

    return this.component;
};

function emitAttach(){
    var newBound = this.binding();
    if(newBound !== this.lastBound){
        this.lastBound = newBound;
        this.scope.attach(this.lastBound);
        this.component.emit('attach', this.scope, 1);
    }
}

function emitDetach(){
    this.component.emit('detach', 1);
}

function getScope(){
    return this.scope;
}

function destroy(){
    if(this.destroyed){
        return;
    }
    this.destroyed = true;

    this.component
        .removeAllListeners('render')
        .removeAllListeners('attach');

    this.component.emit('destroy');
    this.component.element = null;
    this.scope.destroy();
    this.binding.destroy();

    return this.component;
}

function attachComponent(object, firm){
    this.binding.attach(object, firm);
    return this.component;
}

function detachComponent(firm){
    this.binding.detach(firm);
    return this.component;
}

function isDestroyed(){
    return this.destroyed;
}

function setProperty(key, property){

    // Add a default property or use the one already there
    if(!property){
        property = this.component[key] || this.fastn.property();
    }

    this.component[key] = property;
    this.component._properties[key] = property;

    return this.component;
}

function extendComponent(type, settings, children){

    if(type in this.types){
        return this.component;
    }

    if(!(type in this.fastn.components)){

        if(!(GENERIC in this.fastn.components)){
            throw new Error('No component of type "' + type + '" is loaded');
        }

        this.fastn.components._generic(this.fastn, this.component, type, settings, children);

        this.types._generic = true;
    }else{

        this.fastn.components[type](this.fastn, this.component, type, settings, children);
    }

    this.types[type] = true;

    return this.component;
};

function isType(type){
    return type in this.types;
}

function FastnComponent(fastn, type, settings, children){
    var component = this;

    var componentScope = {
        types: {},
        fastn: fastn,
        component: component,
        binding: fastn.binding('.'),
        destroyed: false,
        scope: new fastn.Model(false),
        lastBound: null
    };

    componentScope.emitAttach = emitAttach.bind(componentScope);
    componentScope.emitDetach = emitDetach.bind(componentScope);
    componentScope.binding._default_binding = true;

    component._type = type;
    component._properties = {};
    component._settings = settings || {};
    component._children = children ? flatten(children) : [];

    component.attach = attachComponent.bind(componentScope);
    component.detach = detachComponent.bind(componentScope);
    component.scope = getScope.bind(componentScope);
    component.destroy = destroy.bind(componentScope);
    component.destroyed = isDestroyed.bind(componentScope);
    component.binding = getSetBinding.bind(componentScope);
    component.setProperty = setProperty.bind(componentScope);
    component.clone = clone.bind(componentScope);
    component.children = slice.bind(component._children);
    component.extend = extendComponent.bind(componentScope);
    component.is = isType.bind(componentScope);

    component.binding(componentScope.binding);

    component.on('attach', attachProperties.bind(this));
    component.on('render', onRender.bind(this));
    component.on('detach', detachProperties.bind(this));
    component.on('destroy', destroyProperties.bind(this));

    if(fastn.debug){
        component.on('render', function(){
            if(component.element && typeof component.element === 'object'){
                component.element._component = component;
            }
        });
    }
}
FastnComponent.prototype = Object.create(EventEmitter.prototype);
FastnComponent.prototype.constructor = FastnComponent;
FastnComponent.prototype._fastn_component = true;

module.exports = FastnComponent;
},{"./is":24,"events":5}],17:[function(require,module,exports){
var Enti = require('enti'),
    is = require('./is'),
    firmer = require('./firmer'),
    functionEmitter = require('./functionEmitter'),
    setPrototypeOf = require('setprototypeof'),
    same = require('same-value');

function fuseBinding(){
    var args = Array.prototype.slice.call(arguments);

    var bindings = args.slice(),
        transform = bindings.pop(),
        updateTransform,
        resultBinding = createBinding('result'),
        selfChanging;

    resultBinding._arguments = args;

    if(typeof bindings[bindings.length-1] === 'function' && !is.binding(bindings[bindings.length-1])){
        updateTransform = transform;
        transform = bindings.pop();
    }

    resultBinding._model.removeAllListeners();
    resultBinding._set = function(value){
        if(updateTransform){
            selfChanging = true;
            var newValue = updateTransform(value);
            if(!same(newValue, bindings[0]())){
                bindings[0](newValue);
                resultBinding._change(newValue);
            }
            selfChanging = false;
        }else{
            resultBinding._change(value);
        }
    };

    function change(){
        if(selfChanging){
            return;
        }
        resultBinding(transform.apply(null, bindings.map(function(binding){
            return binding();
        })));
    }

    bindings.forEach(function(binding, index){
        if(!is.binding(binding)){
            binding = createBinding(binding);
            bindings.splice(index,1,binding);
        }
        binding.on('change', change);
        resultBinding.on('detach', binding.detach);
    });

    var lastAttached;
    resultBinding.on('attach', function(object){
        selfChanging = true;
        bindings.forEach(function(binding){
            binding.attach(object, 1);
        });
        selfChanging = false;
        if(lastAttached !== object){
            change();
        }
        lastAttached = object;
    });

    return resultBinding;
}

function createValueBinding(){
    var valueBinding = createBinding('value');
    valueBinding.attach = function(){return valueBinding;};
    valueBinding.detach = function(){return valueBinding;};
    return valueBinding;
}

function bindingTemplate(newValue){
    if(!arguments.length){
        return this.value;
    }

    if(this.binding._fastn_binding === '.'){
        return;
    }

    this.binding._set(newValue);
    return this.binding;
}

function createBinding(path, more){

    if(more){ // used instead of arguments.length for performance
        return fuseBinding.apply(null, arguments);
    }

    if(path == null){
        return createValueBinding();
    }

    var bindingScope = {},
        binding = bindingScope.binding = bindingTemplate.bind(bindingScope),
        destroyed;

    setPrototypeOf(binding, functionEmitter);
    binding.setMaxListeners(10000);
    binding._arguments = [path];
    binding._model = new Enti(false);
    binding._fastn_binding = path;
    binding._firm = -Infinity;

    function modelAttachHandler(data){
        binding._model.attach(data);
        binding._change(binding._model.get(path));
        binding.emit('attach', data, 1);
    }

    function modelDetachHandler(){
        binding._model.detach();
    }

    binding.attach = function(object, firm){

        // If the binding is being asked to attach loosly to an object,
        // but it has already been defined as being firmly attached, do not attach.
        if(firmer(binding, firm)){
            return binding;
        }

        binding._firm = firm;

        var isEnti = Enti.isEnti(object);

        if(isEnti && bindingScope.attachedModel === object){
            return binding;
        }

        if(bindingScope.attachedModel){
            bindingScope.attachedModel.removeListener('attach', modelAttachHandler);
            bindingScope.attachedModel.removeListener('detach', modelDetachHandler);
            bindingScope.attachedModel = null;
        }

        if(isEnti){
            bindingScope.attachedModel = object;
            bindingScope.attachedModel.on('attach', modelAttachHandler);
            bindingScope.attachedModel.on('detach', modelDetachHandler);
            object = object._model;
        }

        if(!(object instanceof Object)){
            object = {};
        }

        if(binding._model._model === object){
            return binding;
        }

        modelAttachHandler(object);

        return binding;
    };

    binding.detach = function(firm){
        if(firmer(binding, firm)){
            return binding;
        }

        bindingScope.value = undefined;
        if(binding._model.isAttached()){
            binding._model.detach();
        }
        binding.emit('detach', 1);
        return binding;
    };
    binding._set = function(newValue){
        if(same(binding._model.get(path), newValue)){
            return;
        }
        if(!binding._model.isAttached()){
            binding._model.attach(binding._model.get('.'));
        }
        binding._model.set(path, newValue);
    };
    binding._change = function(newValue){
        bindingScope.value = newValue;
        binding.emit('change', binding());
    };
    binding.clone = function(keepAttachment){
        var newBinding = createBinding.apply(null, binding._arguments);

        if(keepAttachment){
            newBinding.attach(bindingScope.attachedModel || binding._model._model, binding._firm);
        }

        return newBinding;
    };
    binding.destroy = function(soft){
        if(destroyed){
            return;
        }
        if(soft && binding.listeners('change').length){
            return;
        }
        destroyed = true;
        binding.emit('destroy');
        binding.detach();
        binding._model.destroy();
    };

    binding.destroyed = function(){
        return destroyed;
    };

    if(path !== '.'){
        binding._model.on(path, binding._change);
    }

    return binding;
}

function from(valueOrBinding){
    if(is.binding(valueOrBinding)){
        return valueOrBinding;
    }

    return createBinding()(valueOrBinding);
}

createBinding.from = from;

module.exports = createBinding;
},{"./firmer":20,"./functionEmitter":21,"./is":24,"enti":27,"same-value":32,"setprototypeof":35}],18:[function(require,module,exports){
function insertChild(fastn, container, child, index){
    var currentIndex = container._children.indexOf(child),
        newComponent = fastn.toComponent(child);

    if(newComponent !== child){
        container._children.splice(currentIndex, 1, newComponent);
    }

    if(!~currentIndex || newComponent !== child){
        newComponent.attach(container.scope(), 1);
    }

    if(currentIndex !== index){
        if(~currentIndex){
            container._children.splice(currentIndex, 1);
        }
        container._children.splice(index, 0, newComponent);
    }

    if(container.element){
        if(!newComponent.element){
            newComponent.render();
        }
        container._insert(newComponent.element, index);
        newComponent.emit('insert', container);
    }
}

function getContainerElement(){
    return this.containerElement || this.element;
}

function insert(child, index){
    var childComponent = child,
        container = this.container,
        fastn = this.fastn;

    if(index && typeof index === 'object'){
        childComponent = Array.prototype.slice.call(arguments);
    }

    if(isNaN(index)){
        index = container._children.length;
    }

    if(Array.isArray(childComponent)){
        for (var i = 0; i < childComponent.length; i++) {
            container.insert(childComponent[i], i + index);
        }
    }else{
        insertChild(fastn, container, childComponent, index);
    }

    return container;
}

module.exports = function(fastn, component, type, settings, children){
    component.insert = insert.bind({
        container: component,
        fastn: fastn
    });

    component._insert = function(element, index){
        var containerElement = component.getContainerElement();
        if(!containerElement){
            return;
        }

        if(containerElement.childNodes[index] === element){
            return;
        }

        containerElement.insertBefore(element, containerElement.childNodes[index]);
    };

    component.remove = function(childComponent){
        var index = component._children.indexOf(childComponent);
        if(~index){
            component._children.splice(index,1);
        }

        childComponent.detach(1);

        if(childComponent.element){
            component._remove(childComponent.element);
        }
    };

    component._remove = function(element){
        var containerElement = component.getContainerElement();

        if(!element || !containerElement || element.parentNode !== containerElement){
            return;
        }

        containerElement.removeChild(element);
    };

    component.empty = function(){
        while(component._children.length){
            component.remove(component._children.pop());
        }
    };

    component.replaceChild = function(oldChild, newChild){
        var index = component._children.indexOf(oldChild);

        if(!~index){
            return;
        }

        component.remove(oldChild);
        component.insert(newChild, index);
    };

    component.getContainerElement = getContainerElement.bind(component);

    component.on('render', component.insert.bind(null, component._children, 0));

    component.on('attach', function(model, firm){
        for(var i = 0; i < component._children.length; i++){
            if(fastn.isComponent(component._children[i])){
                component._children[i].attach(model, firm);
            }
        }
    });

    component.on('destroy', function(data, firm){
        for(var i = 0; i < component._children.length; i++){
            if(fastn.isComponent(component._children[i])){
                component._children[i].destroy(firm);
            }
        }
    });

    return component;
};
},{}],19:[function(require,module,exports){
var setify = require('setify'),
    classist = require('classist');

function updateTextProperty(generic, element, value){
    if(arguments.length === 2){
        return element.textContent;
    }
    element.textContent = (value == null ? '' : value);
}

module.exports = {
    class: function(generic, element, value){
        if(!generic._classist){
            generic._classist = classist(element);
        }

        if(arguments.length < 3){
            return generic._classist();
        }

        generic._classist(value);
    },
    display: function(generic, element, value){
        if(arguments.length === 2){
            return element.style.display !== 'none';
        }
        element.style.display = value ? null : 'none';
    },
    disabled: function(generic, element, value){
        if(arguments.length === 2){
            return element.hasAttribute('disabled');
        }
        if(value){
            element.setAttribute('disabled', 'disabled');
        }else{
            element.removeAttribute('disabled');
        }
    },
    textContent: updateTextProperty,
    innerText: updateTextProperty,
    innerHTML: updateTextProperty,
    value: function(generic, element, value){
        var inputType = element.type;

        if(element.nodeName === 'INPUT' && inputType === 'date'){
            if(arguments.length === 2){
                return element.value ? new Date(element.value.replace(/-/g,'/').replace('T',' ')) : null;
            }

            value = value != null ? new Date(value) : null;

            if(!value || isNaN(value)){
                element.value = null;
            }else{
                element.value = [
                    value.getFullYear(),
                    ('0' + (value.getMonth() + 1)).slice(-2),
                    ('0' + value.getDate()).slice(-2)
                ].join('-');
            }
            return;
        }

        if(arguments.length === 2){
            return element.value;
        }
        if(value === undefined){
            value = null;
        }

        setify(element, value);
    },
    style: function(generic, element, value){
        if(arguments.length === 2){
            return element.style;
        }

        for(var key in value){
            element.style[key] = value[key];
        }
    }
};
},{"classist":26,"setify":33}],20:[function(require,module,exports){
// Is the entity firmer than the new firmness
module.exports = function(entity, firm){
    if(firm != null && (entity._firm === undefined || firm < entity._firm)){
        return true;
    }
};
},{}],21:[function(require,module,exports){
var EventEmitter = require('events').EventEmitter,
    functionEmitterPrototype = function(){};

for(var key in EventEmitter.prototype){
    functionEmitterPrototype[key] = EventEmitter.prototype[key];
}

module.exports = functionEmitterPrototype;
},{"events":5}],22:[function(require,module,exports){
var containerComponent = require('./containerComponent'),
    schedule = require('./schedule'),
    fancyProps = require('./fancyProps'),
    matchDomHandlerName = /^((?:el\.)?)([^. ]+)(?:\.(capture))?$/,
    GENERIC = '_generic';

function createProperties(fastn, component, settings){
    for(var key in settings){
        var setting = settings[key];

        if(typeof setting === 'function' && !fastn.isProperty(setting) && !fastn.isBinding(setting)){
            continue;
        }

        component.addDomProperty(key);
    }
}

function addDomHandler(component, element, handlerName, eventName, capture){
    var eventParts = handlerName.split('.');

    if(eventParts[0] === 'on'){
        eventParts.shift();
    }

    var handler = function(event){
            component.emit(handlerName, event, component.scope());
        };

    element.addEventListener(eventName, handler, capture);

    component.on('destroy', function(){
        element.removeEventListener(eventName, handler, capture);
    });
}

function addDomHandlers(component, element, eventNames){
    var events = eventNames.split(' ');

    for(var i = 0; i < events.length; i++){
        var eventName = events[i],
            match = eventName.match(matchDomHandlerName);

        if(!match){
            continue;
        }

        if(match[1] || 'on' + match[2] in element){
            addDomHandler(component, element, eventNames, match[2], match[3]);
        }
    }
}

function addAutoHandler(component, element, key, settings){
    if(!settings[key]){
        return;
    }

    var autoEvent = settings[key].split(':'),
        eventName = key.slice(2);

    delete settings[key];

    var handler = function(event){
        var fancyProp = fancyProps[autoEvent[1]],
            value = fancyProp ? fancyProp(component, element) : element[autoEvent[1]];

        component[autoEvent[0]](value);
    };

    element.addEventListener(eventName, handler);

    component.on('destroy', function(){
        element.removeEventListener(eventName, handler);
    });
}

function addDomProperty(fastn, key, property){
    var component = this;

    property = property || component[key] || fastn.property();
    component.setProperty(key, property);

    function update(){
        var element = component.getPropertyElement(key),
            value = property();

        if(!element || component.destroyed()){
            return;
        }

        var isProperty = key in element,
            fancyProp = fancyProps[key],
            previous = fancyProp ? fancyProp(component, element) : isProperty ? element[key] : element.getAttribute(key);

        if(!fancyProp && !isProperty && value == null){
            value = '';
        }

        if(value !== previous){
            if(fancyProp){
                fancyProp(component, element, value);
                return;
            }

            if(isProperty){
                element[key] = value;
                return;
            }

            if(typeof value !== 'function' && typeof value !== 'object'){
                element.setAttribute(key, value);
            }
        }
    }

    property.updater(update);
}

function onRender(){
    var component = this,
        element;

    for(var key in component._settings){
        element = component.getEventElement(key);
        if(key.slice(0,2) === 'on' && key in element){
            addAutoHandler(component, element, key, component._settings);
        }
    }

    for(var eventKey in component._events){
        element = component.getEventElement(key);
        addDomHandlers(component, element, eventKey);
    }
}

function render(){
    this.element = this.createElement(this._settings.tagName || this._tagName);

    this.emit('render');

    return this;
};

function genericComponent(fastn, component, type, settings, children){
    if(component.is(type)){
        return component;
    }

    if(type === GENERIC){
        component._tagName = component._tagName || 'div';
    }else{
        component._tagName = type;
    }

    if(component.is(GENERIC)){
        return component;
    }

    component.extend('_container', settings, children);

    component.addDomProperty = addDomProperty.bind(component, fastn);
    component.getEventElement = component.getContainerElement;
    component.getPropertyElement = component.getContainerElement;
    component.updateProperty = genericComponent.updateProperty;
    component.createElement = genericComponent.createElement;

    createProperties(fastn, component, settings);

    component.render = render.bind(component);

    component.on('render', onRender);

    return component;
}

genericComponent.updateProperty = function(component, property, update){
    if(typeof document !== 'undefined' && document.contains(component.element)){
        schedule(property, update);
    }else{
        update();
    }
};

genericComponent.createElement = function(tagName){
    if(tagName instanceof Node){
        return tagName;
    }
    return document.createElement(tagName);
};

module.exports = genericComponent;
},{"./containerComponent":18,"./fancyProps":19,"./schedule":42}],23:[function(require,module,exports){
var createProperty = require('./property'),
    createBinding = require('./binding'),
    BaseComponent = require('./baseComponent'),
    crel = require('crel'),
    Enti = require('enti'),
    objectAssign = require('object-assign'),
    is = require('./is');

function inflateProperties(component, settings){
    for(var key in settings){
        var setting = settings[key],
            property = component[key];

        if(is.property(settings[key])){

            if(is.property(property)){
                property.destroy();
            }

            setting.addTo(component, key);

        }else if(is.property(property)){

            if(is.binding(setting)){
                property.binding(setting);
            }else{
                property(setting);
            }

            property.addTo(component, key);
        }
    }
}

function validateExpectedComponents(components, componentName, expectedComponents){
    expectedComponents = expectedComponents.filter(function(componentName){
        return !(componentName in components);
    });

    if(expectedComponents.length){
        console.warn([
            'fastn("' + componentName + '") uses some components that have not been registered with fastn',
            'Expected conponent constructors: ' + expectedComponents.join(', ')
        ].join('\n\n'));
    }
}

module.exports = function(components, debug){

    if(!components || typeof components !== 'object'){
        throw new Error('fastn must be initialised with a components object');
    }

    components._container = components._container || require('./containerComponent');

    function fastn(type){

        var args = [];
        for(var i = 0; i < arguments.length; i++){
            args[i] = arguments[i];
        }

        var settings = args[1],
            childrenIndex = 2,
            settingsChild = fastn.toComponent(args[1]);

        if(Array.isArray(args[1]) || settingsChild || !args[1]){
            args[1] = settingsChild || args[1];
            childrenIndex--;
            settings = null;
        }

        settings = objectAssign({}, settings || {});

        var types = typeof type === 'string' ? type.split(':') : Array.isArray(type) ? type : [type],
            baseType,
            children = args.slice(childrenIndex),
            component = fastn.base(type, settings, children);

        while(baseType = types.shift()){
            component.extend(baseType, settings, children);
        }

        component._properties = {};

        inflateProperties(component, settings);

        return component;
    }

    fastn.toComponent = function(component){
        if(component == null){
            return;
        }
        if(is.component(component)){
            return component;
        }
        if(typeof component !== 'object' || component instanceof Date){
            return fastn('text', {auto: true}, component);
        }
        if(crel.isElement(component)){
            return fastn(component);
        }
        if(crel.isNode(component)){
            return fastn('text', {auto: true}, component.textContent);
        }
    };

    fastn.debug = debug;
    fastn.property = createProperty;
    fastn.binding = createBinding;
    fastn.isComponent = is.component;
    fastn.isBinding = is.binding;
    fastn.isDefaultBinding = is.defaultBinding;
    fastn.isBindingObject = is.bindingObject;
    fastn.isProperty = is.property;
    fastn.components = components;
    fastn.Model = Enti;

    fastn.base = function(type, settings, children){
        return new BaseComponent(fastn, type, settings, children);
    };

    for(var key in components){
        var componentConstructor = components[key];

        if(componentConstructor.expectedComponents){
            validateExpectedComponents(components, key, componentConstructor.expectedComponents);
        }
    }

    return fastn;
};
},{"./baseComponent":16,"./binding":17,"./containerComponent":18,"./is":24,"./property":41,"crel":9,"enti":27,"object-assign":31}],24:[function(require,module,exports){
var FUNCTION = 'function',
    OBJECT = 'object',
    FASTNBINDING = '_fastn_binding',
    FASTNPROPERTY = '_fastn_property',
    FASTNCOMPONENT = '_fastn_component',
    DEFAULTBINDING = '_default_binding';

function isComponent(thing){
    return thing && typeof thing === OBJECT && FASTNCOMPONENT in thing;
}

function isBindingObject(thing){
    return thing && typeof thing === OBJECT && FASTNBINDING in thing;
}

function isBinding(thing){
    return typeof thing === FUNCTION && FASTNBINDING in thing;
}

function isProperty(thing){
    return typeof thing === FUNCTION && FASTNPROPERTY in thing;
}

function isDefaultBinding(thing){
    return typeof thing === FUNCTION && FASTNBINDING in thing && DEFAULTBINDING in thing;
}

module.exports = {
    component: isComponent,
    bindingObject: isBindingObject,
    binding: isBinding,
    defaultBinding: isDefaultBinding,
    property: isProperty
};
},{}],25:[function(require,module,exports){
var MultiMap = require('multimap'),
    merge = require('flat-merge');

MultiMap.Map = Map;

function each(value, fn){
    if(!value || typeof value !== 'object'){
        return;
    }

    if(Array.isArray(value)){
        for(var i = 0; i < value.length; i++){
            fn(value[i], i)
        }
    }else{
        for(var key in value){
            fn(value[key], key);
        }
    }
}

function keyFor(object, value){
    if(!object || typeof object !== 'object'){
        return false;
    }

    if(Array.isArray(object)){
        var index = object.indexOf(value);
        return index >=0 ? index : false;
    }

    for(var key in object){
        if(object[key] === value){
            return key;
        }
    }

    return false;
}

module.exports = function(fastn, component, type, settings, children){

    if(fastn.components._generic){
        component.extend('_generic', settings, children);
    }else{
        component.extend('_container', settings, children);
    }

    var itemsMap = new MultiMap(),
        dataMap = new WeakMap(),
        lastTemplate,
        existingItem = {};

    function updateItems(){
        var value = component.items(),
            template = component.template(),
            emptyTemplate = component.emptyTemplate(),
            newTemplate = lastTemplate !== template;

        var currentItems = merge(template ? value : []);

        itemsMap.forEach(function(childComponent, item){
            var currentKey = keyFor(currentItems, item);

            if(!newTemplate && currentKey !== false){
                currentItems[currentKey] = [existingItem, item, childComponent];
            }else{
                removeComponent(childComponent);
                itemsMap.delete(item);
            }
        });

        var index = 0;

        function updateItem(item, key){
            var child,
                existing;

            while(index < component._children.length && !component._children[index]._templated){
                index++;
            }

            if(Array.isArray(item) && item[0] === existingItem){
                existing = true;
                child = item[2];
                item = item[1];
            }

            var childModel;

            if(!existing){
                childModel = new fastn.Model({
                    item: item,
                    key: key
                });

                child = fastn.toComponent(template(childModel, component.scope()));
                if(!child){
                    child = fastn('template');
                }
                child._listItem = item;
                child._templated = true;

                dataMap.set(child, childModel);
                itemsMap.set(item, child);
            }else{
                childModel = dataMap.get(child);
                childModel.set('key', key);
            }

            if(fastn.isComponent(child) && component._settings.attachTemplates !== false){
                child.attach(childModel, 2);
            }

            component.insert(child, index);
            index++;
        }

        each(currentItems, updateItem);

        lastTemplate = template;

        if(index === 0 && emptyTemplate){
            var child = fastn.toComponent(emptyTemplate(component.scope()));
            if(!child){
                child = fastn('template');
            }
            child._templated = true;

            itemsMap.set({}, child);

            component.insert(child);
        }
    }

    function removeComponent(childComponent){
        component.remove(childComponent);
        childComponent.destroy();
    }

    component.setProperty('items',
        fastn.property([], settings.itemChanges || 'type keys shallowStructure')
            .on('change', updateItems)
    );

    component.setProperty('template',
        fastn.property().on('change', updateItems)
    );

    component.setProperty('emptyTemplate',
        fastn.property().on('change', updateItems)
    );

    return component;
};
},{"flat-merge":28,"multimap":30}],26:[function(require,module,exports){
var flatten = require('flatten');

module.exports = function(element){
    var lastClasses = [];

    return function(classes){

        if(!arguments.length){
            return lastClasses.join(' ');
        }

        function cleanClassName(result, className){
            if(typeof className === 'string' && className.match(/\s/)){
                className = className.split(' ');
            }

            if(Array.isArray(className)){
                return result.concat(className.reduce(cleanClassName, []));
            }

            if(className != null && className !== ''){
                result.push(String(className).trim());
            }

            return result;
        }

        var newClasses = cleanClassName([], classes),
            currentClasses = element.className ? element.className.split(' ') : [];

        lastClasses.map(function(className){
            if(!className){
                return;
            }

            var index = currentClasses.indexOf(className);

            if(~index){
                currentClasses.splice(index, 1);
            }
        });

        currentClasses = currentClasses.concat(newClasses);
        lastClasses = newClasses;

        element.className = currentClasses.join(' ');
    };
};
},{"flatten":29}],27:[function(require,module,exports){
(function (global){
var EventEmitter = require('events').EventEmitter;

function toArray(items){
    return Array.prototype.slice.call(items);
}

var deepRegex = /[|.]/i;

function matchDeep(path){
    return (path + '').match(deepRegex);
}

function isWildcardPath(path){
    var stringPath = (path + '');
    return ~stringPath.indexOf('*');
}

function getTargetKey(path){
    var stringPath = (path + '');
    return stringPath.split('|').shift();
}

var eventSystemVersion = 1,
    globalKey = '_entiEventState' + eventSystemVersion
    globalState = global[globalKey] = global[globalKey] || {
        instances: []
    };

var modifiedEnties = globalState.modifiedEnties = globalState.modifiedEnties || new Set(),
    trackedObjects = globalState.trackedObjects = globalState.trackedObjects || new WeakMap();

function leftAndRest(path){
    var stringPath = (path + '');

    // Special case when you want to filter on self (.)
    if(stringPath.slice(0,2) === '.|'){
        return ['.', stringPath.slice(2)];
    }

    var match = matchDeep(stringPath);
    if(match){
        return [stringPath.slice(0, match.index), stringPath.slice(match.index+1)];
    }
    return stringPath;
}

function isWildcardKey(key){
    return key.charAt(0) === '*';
}

function isFeralcardKey(key){
    return key === '**';
}

function addHandler(object, key, handler){
    var trackedKeys = trackedObjects.get(object);

    if(trackedKeys == null){
        trackedKeys = {};
        trackedObjects.set(object, trackedKeys);
    }

    var handlers = trackedKeys[key];

    if(!handlers){
        handlers = new Set();
        trackedKeys[key] = handlers;
    }

    handlers.add(handler);
}

function removeHandler(object, key, handler){
    var trackedKeys = trackedObjects.get(object);

    if(trackedKeys == null){
        return;
    }

    var handlers = trackedKeys[key];

    if(!handlers){
        return;
    }

    handlers.delete(handler);
}

function trackObjects(eventName, weakMap, handler, object, key, path){
    if(!object || typeof object !== 'object'){
        return;
    }

    var eventKey = key === '**' ? '*' : key,
        target = object[key],
        targetIsObject = target && typeof target === 'object';

    if(targetIsObject && weakMap.has(target)){
        return;
    }

    var handle = function(value, event, emitKey){
        if(eventKey !== '*' && typeof object[eventKey] === 'object' && object[eventKey] !== target){
            if(targetIsObject){
                weakMap.delete(target);
            }
            removeHandler(object, eventKey, handle);
            trackObjects(eventName, weakMap, handler, object, key, path);
            return;
        }

        if(eventKey === '*'){
            trackKeys(object, key, path);
        }

        if(!weakMap.has(object)){
            return;
        }

        if(key !== '**' || !path){
            handler(value, event, emitKey);
        }
    }

    function trackKeys(target, root, rest){
        var keys = Object.keys(target);
        for(var i = 0; i < keys.length; i++){
            if(isFeralcardKey(root)){
                trackObjects(eventName, weakMap, handler, target, keys[i], '**' + (rest ? '.' : '') + (rest || ''));
            }else{
                trackObjects(eventName, weakMap, handler, target, keys[i], rest);
            }
        }
    }

    addHandler(object, eventKey, handle);

    if(!targetIsObject){
        return;
    }

    // This would obviously be better implemented with a WeakSet,
    // But I'm trying to keep filesize down, and I don't really want another
    // polyfill when WeakMap works well enough for the task.
    weakMap.set(target, null);

    if(!path){
        return;
    }

    var rootAndRest = leftAndRest(path),
        root,
        rest;

    if(!Array.isArray(rootAndRest)){
        root = rootAndRest;
    }else{
        root = rootAndRest[0];
        rest = rootAndRest[1];

        // If the root is '.', watch for events on *
        if(root === '.'){
            root = '*';
        }
    }

    if(targetIsObject && isWildcardKey(root)){
        trackKeys(target, root, rest);
    }

    trackObjects(eventName, weakMap, handler, target, root, rest);
}

var trackedEvents = new WeakMap();
function createHandler(enti, trackedObjectPaths, trackedPaths, eventName){
    var oldModel = enti._model;
    return function(event, emitKey){
        trackedPaths.entis.forEach(function(enti){
            if(enti._emittedEvents[eventName] === emitKey){
                return;
            }

            if(enti._model !== oldModel){
                trackedPaths.entis.delete(enti);
                if(trackedPaths.entis.size === 0){
                    delete trackedObjectPaths[eventName];
                    if(!Object.keys(trackedObjectPaths).length){
                        trackedEvents.delete(oldModel);
                    }
                }
                return;
            }

            enti._emittedEvents[eventName] = emitKey;

            var targetKey = getTargetKey(eventName),
                value = isWildcardPath(targetKey) ? undefined : enti.get(targetKey);

            enti.emit(eventName, value, event);
        });
    };
}

function trackPath(enti, eventName){
    var object = enti._model,
        trackedObjectPaths = trackedEvents.get(object);

    if(!trackedObjectPaths){
        trackedObjectPaths = {};
        trackedEvents.set(object, trackedObjectPaths);
    }

    var trackedPaths = trackedObjectPaths[eventName];

    if(!trackedPaths){
        trackedPaths = {
            entis: new Set(),
            trackedObjects: new WeakMap()
        };
        trackedObjectPaths[eventName] = trackedPaths;
    }else if(trackedPaths.entis.has(enti)){
        return;
    }

    trackedPaths.entis.add(enti);

    var handler = createHandler(enti, trackedObjectPaths, trackedPaths, eventName);

    trackObjects(eventName, trackedPaths.trackedObjects, handler, {model:object}, 'model', eventName);
}

function trackPaths(enti){
    if(!enti._events || !enti._model){
        return;
    }

    for(var key in enti._events){
        trackPath(enti, key);
    }
    modifiedEnties.delete(enti);
}

function emitEvent(object, key, value, emitKey){

    modifiedEnties.forEach(trackPaths);

    var trackedKeys = trackedObjects.get(object);

    if(!trackedKeys){
        return;
    }

    var event = {
        value: value,
        key: key,
        object: object
    };

    function emitForKey(handler){
        handler(event, emitKey);
    }

    if(trackedKeys[key]){
        trackedKeys[key].forEach(emitForKey);
    }

    if(trackedKeys['*']){
        trackedKeys['*'].forEach(emitForKey);
    }
}

function emit(events){
    var emitKey = {};
    events.forEach(function(event){
        emitEvent(event[0], event[1], event[2], emitKey);
    });
}

function Enti(model){
    var detached = model === false;

    if(!model || (typeof model !== 'object' && typeof model !== 'function')){
        model = {};
    }

    this._emittedEvents = {};
    if(detached){
        this._model = {};
    }else{
        this.attach(model);
    }

    this.on('newListener', function(){
        modifiedEnties.add(this);
    });
}
Enti.get = function(model, key){
    if(!model || typeof model !== 'object'){
        return;
    }

    key = getTargetKey(key);

    if(key === '.'){
        return model;
    }


    var path = leftAndRest(key);
    if(Array.isArray(path)){
        return Enti.get(model[path[0]], path[1]);
    }

    return model[key];
};
Enti.set = function(model, key, value){
    if(!model || typeof model !== 'object'){
        return;
    }

    key = getTargetKey(key);

    var path = leftAndRest(key);
    if(Array.isArray(path)){
        return Enti.set(model[path[0]], path[1], value);
    }

    var original = model[key];

    if(typeof value !== 'object' && value === original){
        return;
    }

    var keysChanged = !(key in model);

    model[key] = value;

    var events = [[model, key, value]];

    if(keysChanged){
        if(Array.isArray(model)){
            events.push([model, 'length', model.length]);
        }
    }

    emit(events);
};
Enti.push = function(model, key, value){
    if(!model || typeof model !== 'object'){
        return;
    }

    var target;
    if(arguments.length < 3){
        value = key;
        key = '.';
        target = model;
    }else{
        var path = leftAndRest(key);
        if(Array.isArray(path)){
            return Enti.push(model[path[0]], path[1], value);
        }

        target = model[key];
    }

    if(!Array.isArray(target)){
        throw 'The target is not an array.';
    }

    target.push(value);

    var events = [
        [target, target.length-1, value],
        [target, 'length', target.length]
    ];

    emit(events);
};
Enti.insert = function(model, key, value, index){
    if(!model || typeof model !== 'object'){
        return;
    }


    var target;
    if(arguments.length < 4){
        index = value;
        value = key;
        key = '.';
        target = model;
    }else{
        var path = leftAndRest(key);
        if(Array.isArray(path)){
            return Enti.insert(model[path[0]], path[1], value, index);
        }

        target = model[key];
    }

    if(!Array.isArray(target)){
        throw 'The target is not an array.';
    }

    target.splice(index, 0, value);

    var events = [
        [target, index, value],
        [target, 'length', target.length]
    ];

    emit(events);
};
Enti.remove = function(model, key, subKey){
    if(!model || typeof model !== 'object'){
        return;
    }

    var path = leftAndRest(key);
    if(Array.isArray(path)){
        return Enti.remove(model[path[0]], path[1], subKey);
    }

    // Remove a key off of an object at 'key'
    if(subKey != null){
        Enti.remove(model[key], subKey);
        return;
    }

    if(key === '.'){
        throw '. (self) is not a valid key to remove';
    }

    var events = [];

    if(Array.isArray(model)){
        model.splice(key, 1);
        events.push([model, 'length', model.length]);
    }else{
        delete model[key];
        events.push([model, key]);
    }

    emit(events);
};
Enti.move = function(model, key, index){
    if(!model || typeof model !== 'object'){
        return;
    }

    var path = leftAndRest(key);
    if(Array.isArray(path)){
        return Enti.move(model[path[0]], path[1], index);
    }

    if(key === index){
        return;
    }

    if(!Array.isArray(model)){
        throw 'The model is not an array.';
    }

    var item = model[key];

    model.splice(key, 1);

    model.splice(index - (index > key ? 0 : 1), 0, item);

    emit([[model, index, item]]);
};
Enti.update = function(model, key, value){
    if(!model || typeof model !== 'object'){
        return;
    }

    var target,
        isArray = Array.isArray(value);

    if(arguments.length < 3){
        value = key;
        key = '.';
        target = model;
    }else{
        var path = leftAndRest(key);
        if(Array.isArray(path)){
            return Enti.update(model[path[0]], path[1], value);
        }

        target = model[key];

        if(target == null){
            model[key] = isArray ? [] : {};
        }
    }

    if(typeof value !== 'object'){
        throw 'The value is not an object.';
    }

    if(typeof target !== 'object'){
        throw 'The target is not an object.';
    }

    var events = [];

    function updateTarget(target, value){
        for(var key in value){
            if(target[key] && typeof target[key] === 'object'){
                updateTarget(target[key], value[key]);
                continue;
            }
            target[key] = value[key];
            events.push([target, key, value[key]]);
        }

        if(Array.isArray(target)){
            events.push([target, 'length', target.length]);
        }
    }

    updateTarget(target, value);

    emit(events);
};
Enti.prototype = Object.create(EventEmitter.prototype);
Enti.prototype._maxListeners = 100;
Enti.prototype.constructor = Enti;
Enti.prototype.attach = function(model){
    if(this._model !== model){
        this.detach();
    }

    modifiedEnties.add(this);
    this._attached = true;
    this._model = model;
    this.emit('attach', model);
};
Enti.prototype.detach = function(){
    modifiedEnties.delete(this);

    this._emittedEvents = {};
    this._model = {};
    this._attached = false;
    this.emit('detach');
};
Enti.prototype.destroy = function(){
    this.detach();
    this._events = null;
    this.emit('destroy');
};
Enti.prototype.get = function(key){
    return Enti.get(this._model, key);
};

Enti.prototype.set = function(key, value){
    return Enti.set(this._model, key, value);
};

Enti.prototype.push = function(key, value){
    return Enti.push.apply(null, [this._model].concat(toArray(arguments)));
};

Enti.prototype.insert = function(key, value, index){
    return Enti.insert.apply(null, [this._model].concat(toArray(arguments)));
};

Enti.prototype.remove = function(key, subKey){
    return Enti.remove.apply(null, [this._model].concat(toArray(arguments)));
};

Enti.prototype.move = function(key, index){
    return Enti.move.apply(null, [this._model].concat(toArray(arguments)));
};

Enti.prototype.update = function(key, index){
    return Enti.update.apply(null, [this._model].concat(toArray(arguments)));
};
Enti.prototype.isAttached = function(){
    return this._attached;
};
Enti.prototype.attachedCount = function(){
    return modifiedEnties.size;
};

Enti.isEnti = function(target){
    return target && !!~globalState.instances.indexOf(target.constructor);
};

globalState.instances.push(Enti);

module.exports = Enti;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"events":5}],28:[function(require,module,exports){
function flatMerge(a,b){
    if(!b || typeof b !== 'object'){
        b = {};
    }

    if(!a || typeof a !== 'object'){
        a = new b.constructor();
    }

    var result = new a.constructor(),
        aKeys = Object.keys(a),
        bKeys = Object.keys(b);

    for(var i = 0; i < aKeys.length; i++){
        result[aKeys[i]] = a[aKeys[i]];
    }

    for(var i = 0; i < bKeys.length; i++){
        result[bKeys[i]] = b[bKeys[i]];
    }

    return result;
}

module.exports = flatMerge;
},{}],29:[function(require,module,exports){
module.exports = function flatten(list, depth) {
  depth = (typeof depth == 'number') ? depth : Infinity;

  return _flatten(list, 1);

  function _flatten(list, d) {
    return list.reduce(function (acc, item) {
      if (Array.isArray(item) && d < depth) {
        return acc.concat(_flatten(item, d + 1));
      }
      else {
        return acc.concat(item);
      }
    }, []);
  }
};

},{}],30:[function(require,module,exports){
"use strict";

/* global module, define */

function mapEach(map, operation){
  var keys = map.keys();
  var next;
  while(!(next = keys.next()).done) {
    operation(map.get(next.value), next.value, map);
  }
}

var Multimap = (function() {
  var mapCtor;
  if (typeof Map !== 'undefined') {
    mapCtor = Map;
  }

  function Multimap(iterable) {
    var self = this;

    self._map = mapCtor;

    if (Multimap.Map) {
      self._map = Multimap.Map;
    }

    self._ = self._map ? new self._map() : {};

    if (iterable) {
      iterable.forEach(function(i) {
        self.set(i[0], i[1]);
      });
    }
  }

  /**
   * @param {Object} key
   * @return {Array} An array of values, undefined if no such a key;
   */
  Multimap.prototype.get = function(key) {
    return this._map ? this._.get(key) : this._[key];
  };

  /**
   * @param {Object} key
   * @param {Object} val...
   */
  Multimap.prototype.set = function(key, val) {
    var args = Array.prototype.slice.call(arguments);

    key = args.shift();

    var entry = this.get(key);
    if (!entry) {
      entry = [];
      if (this._map)
        this._.set(key, entry);
      else
        this._[key] = entry;
    }

    Array.prototype.push.apply(entry, args);
    return this;
  };

  /**
   * @param {Object} key
   * @param {Object=} val
   * @return {boolean} true if any thing changed
   */
  Multimap.prototype.delete = function(key, val) {
    if (!this.has(key))
      return false;

    if (arguments.length == 1) {
      this._map ? (this._.delete(key)) : (delete this._[key]);
      return true;
    } else {
      var entry = this.get(key);
      var idx = entry.indexOf(val);
      if (idx != -1) {
        entry.splice(idx, 1);
        return true;
      }
    }

    return false;
  };

  /**
   * @param {Object} key
   * @param {Object=} val
   * @return {boolean} whether the map contains 'key' or 'key=>val' pair
   */
  Multimap.prototype.has = function(key, val) {
    var hasKey = this._map ? this._.has(key) : this._.hasOwnProperty(key);

    if (arguments.length == 1 || !hasKey)
      return hasKey;

    var entry = this.get(key) || [];
    return entry.indexOf(val) != -1;
  };


  /**
   * @return {Array} all the keys in the map
   */
  Multimap.prototype.keys = function() {
    if (this._map)
      return makeIterator(this._.keys());

    return makeIterator(Object.keys(this._));
  };

  /**
   * @return {Array} all the values in the map
   */
  Multimap.prototype.values = function() {
    var vals = [];
    this.forEachEntry(function(entry) {
      Array.prototype.push.apply(vals, entry);
    });

    return makeIterator(vals);
  };

  /**
   *
   */
  Multimap.prototype.forEachEntry = function(iter) {
    mapEach(this, iter);
  };

  Multimap.prototype.forEach = function(iter) {
    var self = this;
    self.forEachEntry(function(entry, key) {
      entry.forEach(function(item) {
        iter(item, key, self);
      });
    });
  };


  Multimap.prototype.clear = function() {
    if (this._map) {
      this._.clear();
    } else {
      this._ = {};
    }
  };

  Object.defineProperty(
    Multimap.prototype,
    "size", {
      configurable: false,
      enumerable: true,
      get: function() {
        var total = 0;

        mapEach(this, function(value){
          total += value.length;
        });

        return total;
      }
    });

  var safariNext;

  try{
    safariNext = new Function('iterator', 'makeIterator', 'var keysArray = []; for(var key of iterator){keysArray.push(key);} return makeIterator(keysArray).next;');
  }catch(error){
    // for of not implemented;
  }

  function makeIterator(iterator){
    if(Array.isArray(iterator)){
      var nextIndex = 0;

      return {
        next: function(){
          return nextIndex < iterator.length ?
            {value: iterator[nextIndex++], done: false} :
          {done: true};
        }
      };
    }

    // Only an issue in safari
    if(!iterator.next && safariNext){
      iterator.next = safariNext(iterator, makeIterator);
    }

    return iterator;
  }

  return Multimap;
})();


if(typeof exports === 'object' && module && module.exports)
  module.exports = Multimap;
else if(typeof define === 'function' && define.amd)
  define(function() { return Multimap; });

},{}],31:[function(require,module,exports){
'use strict';
var propIsEnumerable = Object.prototype.propertyIsEnumerable;

function ToObject(val) {
	if (val == null) {
		throw new TypeError('Object.assign cannot be called with null or undefined');
	}

	return Object(val);
}

function ownEnumerableKeys(obj) {
	var keys = Object.getOwnPropertyNames(obj);

	if (Object.getOwnPropertySymbols) {
		keys = keys.concat(Object.getOwnPropertySymbols(obj));
	}

	return keys.filter(function (key) {
		return propIsEnumerable.call(obj, key);
	});
}

module.exports = Object.assign || function (target, source) {
	var from;
	var keys;
	var to = ToObject(target);

	for (var s = 1; s < arguments.length; s++) {
		from = arguments[s];
		keys = ownEnumerableKeys(Object(from));

		for (var i = 0; i < keys.length; i++) {
			to[keys[i]] = from[keys[i]];
		}
	}

	return to;
};

},{}],32:[function(require,module,exports){
module.exports = function isSame(a, b){
    if(a === b){
        return true;
    }

    if(
        typeof a !== typeof b ||
        typeof a === 'object' &&
        !(a instanceof Date && b instanceof Date)
    ){
        return false;
    }

    return String(a) === String(b);
};
},{}],33:[function(require,module,exports){
var naturalSelection = require('natural-selection');

module.exports = function(element, value){
    var canSet = naturalSelection(element) && element === document.activeElement;

    if (canSet) {
        var start = element.selectionStart,
            end = element.selectionEnd;

        element.value = value;
        element.setSelectionRange(start, end);
    } else {
        element.value = value;
    }
};

},{"natural-selection":34}],34:[function(require,module,exports){
var supportedTypes = ['text', 'search', 'tel', 'url', 'password'];

module.exports = function(element){
    return !!(element.setSelectionRange && ~supportedTypes.indexOf(element.type));
};

},{}],35:[function(require,module,exports){
module.exports = Object.setPrototypeOf || {__proto__:[]} instanceof Array ? setProtoOf : mixinProperties;

function setProtoOf(obj, proto) {
	obj.__proto__ = proto;
}

function mixinProperties(obj, proto) {
	for (var prop in proto) {
		obj[prop] = proto[prop];
	}
}

},{}],36:[function(require,module,exports){
var clone = require('clone'),
    deepEqual = require('deep-equal');

function keysAreDifferent(keys1, keys2){
    if(keys1 === keys2){
        return;
    }
    if(!keys1 || !keys2 || keys1.length !== keys2.length){
        return true;
    }
    for(var i = 0; i < keys1.length; i++){
        if(!~keys2.indexOf(keys1[i])){
            return true;
        }
    }
}

function getKeys(value){
    if(!value || typeof value !== 'object'){
        return;
    }

    return Object.keys(value);
}

function WhatChanged(value, changesToTrack){
    this._changesToTrack = {};

    if(changesToTrack == null){
        changesToTrack = 'value type keys structure reference';
    }

    if(typeof changesToTrack !== 'string'){
        throw 'changesToTrack must be of type string';
    }

    changesToTrack = changesToTrack.split(' ');

    for (var i = 0; i < changesToTrack.length; i++) {
        this._changesToTrack[changesToTrack[i]] = true;
    };

    this.update(value);
}
WhatChanged.prototype.update = function(value){
    var result = {},
        changesToTrack = this._changesToTrack,
        newKeys = getKeys(value);

    if('value' in changesToTrack && value+'' !== this._lastReference+''){
        result.value = true;
    }
    if(
        'type' in changesToTrack && typeof value !== typeof this._lastValue ||
        (value === null || this._lastValue === null) && this.value !== this._lastValue // typeof null === 'object'
    ){
        result.type = true;
    }
    if('keys' in changesToTrack && keysAreDifferent(this._lastKeys, getKeys(value))){
        result.keys = true;
    }

    if(value !== null && typeof value === 'object'){
        var lastValue = this._lastValue;

        if('shallowStructure' in changesToTrack && (!lastValue || typeof lastValue !== 'object' || Object.keys(value).some(function(key, index){
            return value[key] !== lastValue[key];
        }))){
            result.shallowStructure = true;
        }
        if('structure' in changesToTrack && !deepEqual(value, lastValue)){
            result.structure = true;
        }
        if('reference' in changesToTrack && value !== this._lastReference){
            result.reference = true;
        }
    }

    this._lastValue = 'structure' in changesToTrack ? clone(value) : 'shallowStructure' in changesToTrack ? clone(value, true, 1): value;
    this._lastReference = value;
    this._lastKeys = newKeys;

    return result;
};

module.exports = WhatChanged;
},{"clone":37,"deep-equal":38}],37:[function(require,module,exports){
(function (Buffer){
var clone = (function() {
'use strict';

/**
 * Clones (copies) an Object using deep copying.
 *
 * This function supports circular references by default, but if you are certain
 * there are no circular references in your object, you can save some CPU time
 * by calling clone(obj, false).
 *
 * Caution: if `circular` is false and `parent` contains circular references,
 * your program may enter an infinite loop and crash.
 *
 * @param `parent` - the object to be cloned
 * @param `circular` - set to true if the object to be cloned may contain
 *    circular references. (optional - true by default)
 * @param `depth` - set to a number if the object is only to be cloned to
 *    a particular depth. (optional - defaults to Infinity)
 * @param `prototype` - sets the prototype to be used when cloning an object.
 *    (optional - defaults to parent prototype).
*/
function clone(parent, circular, depth, prototype) {
  var filter;
  if (typeof circular === 'object') {
    depth = circular.depth;
    prototype = circular.prototype;
    filter = circular.filter;
    circular = circular.circular
  }
  // maintain two arrays for circular references, where corresponding parents
  // and children have the same index
  var allParents = [];
  var allChildren = [];

  var useBuffer = typeof Buffer != 'undefined';

  if (typeof circular == 'undefined')
    circular = true;

  if (typeof depth == 'undefined')
    depth = Infinity;

  // recurse this function so we don't reset allParents and allChildren
  function _clone(parent, depth) {
    // cloning null always returns null
    if (parent === null)
      return null;

    if (depth == 0)
      return parent;

    var child;
    var proto;
    if (typeof parent != 'object') {
      return parent;
    }

    if (clone.__isArray(parent)) {
      child = [];
    } else if (clone.__isRegExp(parent)) {
      child = new RegExp(parent.source, __getRegExpFlags(parent));
      if (parent.lastIndex) child.lastIndex = parent.lastIndex;
    } else if (clone.__isDate(parent)) {
      child = new Date(parent.getTime());
    } else if (useBuffer && Buffer.isBuffer(parent)) {
      child = new Buffer(parent.length);
      parent.copy(child);
      return child;
    } else {
      if (typeof prototype == 'undefined') {
        proto = Object.getPrototypeOf(parent);
        child = Object.create(proto);
      }
      else {
        child = Object.create(prototype);
        proto = prototype;
      }
    }

    if (circular) {
      var index = allParents.indexOf(parent);

      if (index != -1) {
        return allChildren[index];
      }
      allParents.push(parent);
      allChildren.push(child);
    }

    for (var i in parent) {
      var attrs;
      if (proto) {
        attrs = Object.getOwnPropertyDescriptor(proto, i);
      }

      if (attrs && attrs.set == null) {
        continue;
      }
      child[i] = _clone(parent[i], depth - 1);
    }

    return child;
  }

  return _clone(parent, depth);
}

/**
 * Simple flat clone using prototype, accepts only objects, usefull for property
 * override on FLAT configuration object (no nested props).
 *
 * USE WITH CAUTION! This may not behave as you wish if you do not know how this
 * works.
 */
clone.clonePrototype = function clonePrototype(parent) {
  if (parent === null)
    return null;

  var c = function () {};
  c.prototype = parent;
  return new c();
};

// private utility functions

function __objToStr(o) {
  return Object.prototype.toString.call(o);
};
clone.__objToStr = __objToStr;

function __isDate(o) {
  return typeof o === 'object' && __objToStr(o) === '[object Date]';
};
clone.__isDate = __isDate;

function __isArray(o) {
  return typeof o === 'object' && __objToStr(o) === '[object Array]';
};
clone.__isArray = __isArray;

function __isRegExp(o) {
  return typeof o === 'object' && __objToStr(o) === '[object RegExp]';
};
clone.__isRegExp = __isRegExp;

function __getRegExpFlags(re) {
  var flags = '';
  if (re.global) flags += 'g';
  if (re.ignoreCase) flags += 'i';
  if (re.multiline) flags += 'm';
  return flags;
};
clone.__getRegExpFlags = __getRegExpFlags;

return clone;
})();

if (typeof module === 'object' && module.exports) {
  module.exports = clone;
}

}).call(this,require("buffer").Buffer)

},{"buffer":1}],38:[function(require,module,exports){
var pSlice = Array.prototype.slice;
var objectKeys = require('./lib/keys.js');
var isArguments = require('./lib/is_arguments.js');

var deepEqual = module.exports = function (actual, expected, opts) {
  if (!opts) opts = {};
  // 7.1. All identical values are equivalent, as determined by ===.
  if (actual === expected) {
    return true;

  } else if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();

  // 7.3. Other pairs that do not both pass typeof value == 'object',
  // equivalence is determined by ==.
  } else if (typeof actual != 'object' && typeof expected != 'object') {
    return opts.strict ? actual === expected : actual == expected;

  // 7.4. For all other Object pairs, including Array objects, equivalence is
  // determined by having the same number of owned properties (as verified
  // with Object.prototype.hasOwnProperty.call), the same set of keys
  // (although not necessarily the same order), equivalent values for every
  // corresponding key, and an identical 'prototype' property. Note: this
  // accounts for both named and indexed properties on Arrays.
  } else {
    return objEquiv(actual, expected, opts);
  }
}

function isUndefinedOrNull(value) {
  return value === null || value === undefined;
}

function isBuffer (x) {
  if (!x || typeof x !== 'object' || typeof x.length !== 'number') return false;
  if (typeof x.copy !== 'function' || typeof x.slice !== 'function') {
    return false;
  }
  if (x.length > 0 && typeof x[0] !== 'number') return false;
  return true;
}

function objEquiv(a, b, opts) {
  var i, key;
  if (isUndefinedOrNull(a) || isUndefinedOrNull(b))
    return false;
  // an identical 'prototype' property.
  if (a.prototype !== b.prototype) return false;
  //~~~I've managed to break Object.keys through screwy arguments passing.
  //   Converting to array solves the problem.
  if (isArguments(a)) {
    if (!isArguments(b)) {
      return false;
    }
    a = pSlice.call(a);
    b = pSlice.call(b);
    return deepEqual(a, b, opts);
  }
  if (isBuffer(a)) {
    if (!isBuffer(b)) {
      return false;
    }
    if (a.length !== b.length) return false;
    for (i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  try {
    var ka = objectKeys(a),
        kb = objectKeys(b);
  } catch (e) {//happens when one is a string literal and the other isn't
    return false;
  }
  // having the same number of owned properties (keys incorporates
  // hasOwnProperty)
  if (ka.length != kb.length)
    return false;
  //the same set of keys (although not necessarily the same order),
  ka.sort();
  kb.sort();
  //~~~cheap key test
  for (i = ka.length - 1; i >= 0; i--) {
    if (ka[i] != kb[i])
      return false;
  }
  //equivalent values for every corresponding key, and
  //~~~possibly expensive deep test
  for (i = ka.length - 1; i >= 0; i--) {
    key = ka[i];
    if (!deepEqual(a[key], b[key], opts)) return false;
  }
  return typeof a === typeof b;
}

},{"./lib/is_arguments.js":39,"./lib/keys.js":40}],39:[function(require,module,exports){
var supportsArgumentsClass = (function(){
  return Object.prototype.toString.call(arguments)
})() == '[object Arguments]';

exports = module.exports = supportsArgumentsClass ? supported : unsupported;

exports.supported = supported;
function supported(object) {
  return Object.prototype.toString.call(object) == '[object Arguments]';
};

exports.unsupported = unsupported;
function unsupported(object){
  return object &&
    typeof object == 'object' &&
    typeof object.length == 'number' &&
    Object.prototype.hasOwnProperty.call(object, 'callee') &&
    !Object.prototype.propertyIsEnumerable.call(object, 'callee') ||
    false;
};

},{}],40:[function(require,module,exports){
exports = module.exports = typeof Object.keys === 'function'
  ? Object.keys : shim;

exports.shim = shim;
function shim (obj) {
  var keys = [];
  for (var key in obj) keys.push(key);
  return keys;
}

},{}],41:[function(require,module,exports){
var Enti = require('enti'),
    WhatChanged = require('what-changed'),
    same = require('same-value'),
    firmer = require('./firmer'),
    createBinding = require('./binding'),
    functionEmitter = require('./functionEmitter'),
    setPrototypeOf = require('setprototypeof'),
    is = require('./is');

var propertyProto = Object.create(functionEmitter);

propertyProto._fastn_property = true;
propertyProto._firm = 1;

function propertyTemplate(value){
    if(!arguments.length){
        return this.binding && this.binding() || this.property._value;
    }

    if(!this.destroyed){
        if(this.binding){
            this.binding(value);
            return this.property;
        }

        this.valueUpdate(value);
    }

    return this.property;
}

function changeChecker(current, changes){
    if(changes){
        var changes = new WhatChanged(current, changes);

        return function(value){
            return Object.keys(changes.update(value)).length > 0;
        };
    }else{
        var lastValue = current;
        return function(newValue){
            if(!same(lastValue, newValue)){
                lastValue = newValue;
                return true;
            }
        };
    }
}


function propertyBinding(newBinding){
    if(!arguments.length){
        return this.binding;
    }

    if(!is.binding(newBinding)){
        newBinding = createBinding(newBinding);
    }

    if(newBinding === this.binding){
        return this.property;
    }

    if(this.binding){
        this.binding.removeListener('change', this.valueUpdate);
    }

    this.binding = newBinding;

    if(this.model){
        this.property.attach(this.model, this.property._firm);
    }

    this.binding.on('change', this.valueUpdate);
    this.valueUpdate(this.binding());

    return this.property;
};

function attachProperty(object, firm){
    if(firmer(this.property, firm)){
        return this.property;
    }

    this.property._firm = firm;

    if(!(object instanceof Object)){
        object = {};
    }

    if(this.binding){
        this.model = object;
        this.binding.attach(object, 1);
    }

    if(this.property._events && 'attach' in this.property._events){
        this.property.emit('attach', object, 1);
    }

    return this.property;
};

function detachProperty(firm){
    if(firmer(this.property, firm)){
        return this.property;
    }

    if(this.binding){
        this.binding.removeListener('change', this.valueUpdate);
        this.binding.detach(1);
        this.model = null;
    }

    if(this.property._events && 'detach' in this.property._events){
        this.property.emit('detach', 1);
    }

    return this.property;
};

function updateProperty(){
    if(!this.destroyed){

        if(this.property._update){
            this.property._update(this.property._value, this.property);
        }

        this.property.emit('update', this.property._value);
    }
    return this.property;
};

function propertyUpdater(fn){
    if(!arguments.length){
        return this.property._update;
    }
    this.property._update = fn;
    return this.property;
};

function destroyProperty(){
    if(!this.destroyed){
        this.destroyed = true;

        this.property
            .removeAllListeners('change')
            .removeAllListeners('update')
            .removeAllListeners('attach');

        this.property.emit('destroy');
        this.property.detach();
        if(this.binding){
            this.binding.destroy(true);
        }
    }
    return this.property;
};

function propertyDestroyed(){
    return this.destroyed;
};

function addPropertyTo(component, key){
    component.setProperty(key, this.property);

    return this.property;
};

function createProperty(currentValue, changes, updater){
    if(typeof changes === 'function'){
        updater = changes;
        changes = null;
    }

    var propertyScope =
        property = propertyTemplate.bind(propertyScope)
        propertyScope = {
        hasChanged: changeChecker(currentValue, changes),
        valueUpdate: function(value){
            property._value = value;
            if(!propertyScope.hasChanged(value)){
                return;
            }
            property.emit('change', property._value);
            property.update();
        }
    };

    var property = propertyScope.property = propertyTemplate.bind(propertyScope);

    property._value = currentValue;
    property._update = updater;

    setPrototypeOf(property, propertyProto);

    property.binding = propertyBinding.bind(propertyScope);
    property.attach = attachProperty.bind(propertyScope);
    property.detach = detachProperty.bind(propertyScope);
    property.update = updateProperty.bind(propertyScope);
    property.updater = propertyUpdater.bind(propertyScope);
    property.destroy = destroyProperty.bind(propertyScope);
    property.destroyed = propertyDestroyed.bind(propertyScope);
    property.addTo = addPropertyTo.bind(propertyScope);

    return property;
};

module.exports = createProperty;
},{"./binding":17,"./firmer":20,"./functionEmitter":21,"./is":24,"enti":27,"same-value":32,"setprototypeof":35,"what-changed":36}],42:[function(require,module,exports){
var todo = [],
    todoKeys = [],
    scheduled,
    updates = 0;

function run(){
    var startTime = Date.now();

    while(todo.length && Date.now() - startTime < 16){
        todoKeys.shift();
        todo.shift()();
    }

    if(todo.length){
        requestAnimationFrame(run);
    }else{
        scheduled = false;
    }
}

function schedule(key, fn){
    if(~todoKeys.indexOf(key)){
        return;
    }

    todo.push(fn);
    todoKeys.push(key);

    if(!scheduled){
        scheduled = true;
        requestAnimationFrame(run);
    }
}

module.exports = schedule;
},{}],43:[function(require,module,exports){
module.exports = function(fastn, component, type, settings, children){
    var itemModel = new fastn.Model({});

    function replaceElement(element){
        if(component.element && component.element.parentNode){
            component.element.parentNode.replaceChild(element, component.element);
        }
        component.element = element;
    }

    function update(){

        var value = component.data(),
            template = component.template();

        itemModel.set('item', value);

        var newComponent = template && fastn.toComponent(template(itemModel, component.scope(), component._currentComponent));

        if(component._currentComponent && component._currentComponent !== newComponent){
            if(fastn.isComponent(component._currentComponent)){
                component._currentComponent.destroy();
            }
        }

        component._currentComponent = newComponent;

        if(!newComponent){
            replaceElement(component.emptyElement);
            return;
        }

        if(fastn.isComponent(newComponent)){
            if(component._settings.attachTemplates !== false){
                newComponent.attach(itemModel, 2);
            }else{
                newComponent.attach(component.scope(), 1);
            }

            if(component.element && component.element !== newComponent.element){
                if(newComponent.element == null){
                    newComponent.render();
                }
                replaceElement(component._currentComponent.element);
            }
        }
    }

    component.render = function(){
        var element;
        component.emptyElement = document.createTextNode('');
        if(component._currentComponent){
            component._currentComponent.render();
            element = component._currentComponent.element;
        }
        component.element = element || component.emptyElement;
        component.emit('render');
    };

    component.setProperty('data',
        fastn.property(undefined, settings.dataChanges || 'value structure')
            .on('change', update)
    );

    component.setProperty('template',
        fastn.property(undefined, 'value')
            .on('change', update)
    );

    component.on('destroy', function(){
        if(fastn.isComponent(component._currentComponent)){
            component._currentComponent.destroy();
        }
    });

    component.on('attach', function(data){
        if(fastn.isComponent(component._currentComponent)){
            component._currentComponent.attach(component.scope(), 1);
        }
    });

    return component;
};
},{}],44:[function(require,module,exports){
function updateText(){
    if(!this.element){
        return;
    }

    var value = this.text();

    this.element.textContent = (value == null ? '' : value);
}

function autoRender(content){
    this.element = document.createTextNode(content);
}

function autoText(text, fastn, content) {
    text.render = autoRender.bind(text, content);

    return text;
}

function render(){
    this.element = this.createTextNode(this.text());
    this.emit('render');
};

function textComponent(fastn, component, type, settings, children){
    if(settings.auto){
        delete settings.auto;
        if(!fastn.isBinding(children[0])){
            return autoText(component, fastn, children[0]);
        }
        settings.text = children.pop();
    }

    component.createTextNode = textComponent.createTextNode;
    component.render = render.bind(component);

    component.setProperty('text', fastn.property('', updateText.bind(component)));

    return component;
}

textComponent.createTextNode = function(text){
    return document.createTextNode(text);
};

module.exports = textComponent;
},{}]},{},[6])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy5udm0vdmVyc2lvbnMvbm9kZS92NC4xLjIvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiLi4vLi4vLm52bS92ZXJzaW9ucy9ub2RlL3Y0LjEuMi9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvaW5kZXguanMiLCIuLi8uLi8ubnZtL3ZlcnNpb25zL25vZGUvdjQuMS4yL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIuLi8uLi8ubnZtL3ZlcnNpb25zL25vZGUvdjQuMS4yL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvaWVlZTc1NC9pbmRleC5qcyIsIi4uLy4uLy5udm0vdmVyc2lvbnMvbm9kZS92NC4xLjIvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pcy1hcnJheS9pbmRleC5qcyIsIi4uLy4uLy5udm0vdmVyc2lvbnMvbm9kZS92NC4xLjIvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvZXZlbnRzL2V2ZW50cy5qcyIsImV4YW1wbGUvaW5kZXguanMiLCJpbmRleC5qcyIsIm1vZGFsQ29tcG9uZW50LmpzIiwibm9kZV9tb2R1bGVzL2NyZWwvY3JlbC5qcyIsIm5vZGVfbW9kdWxlcy9kZWZhdWx0Y3NzL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2RvYy1qcy9kb2MuanMiLCJub2RlX21vZHVsZXMvZG9jLWpzL2ZsdWVudC5qcyIsIm5vZGVfbW9kdWxlcy9kb2MtanMvZ2V0VGFyZ2V0LmpzIiwibm9kZV9tb2R1bGVzL2RvYy1qcy9nZXRUYXJnZXRzLmpzIiwibm9kZV9tb2R1bGVzL2RvYy1qcy9pc0xpc3QuanMiLCJub2RlX21vZHVsZXMvZmFzdG4vYmFzZUNvbXBvbmVudC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9iaW5kaW5nLmpzIiwibm9kZV9tb2R1bGVzL2Zhc3RuL2NvbnRhaW5lckNvbXBvbmVudC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9mYW5jeVByb3BzLmpzIiwibm9kZV9tb2R1bGVzL2Zhc3RuL2Zpcm1lci5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9mdW5jdGlvbkVtaXR0ZXIuanMiLCJub2RlX21vZHVsZXMvZmFzdG4vZ2VuZXJpY0NvbXBvbmVudC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9pcy5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9saXN0Q29tcG9uZW50LmpzIiwibm9kZV9tb2R1bGVzL2Zhc3RuL25vZGVfbW9kdWxlcy9jbGFzc2lzdC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9ub2RlX21vZHVsZXMvZmxhdC1tZXJnZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9ub2RlX21vZHVsZXMvZmxhdHRlbi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9ub2RlX21vZHVsZXMvbXVsdGltYXAvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZmFzdG4vbm9kZV9tb2R1bGVzL29iamVjdC1hc3NpZ24vaW5kZXguanMiLCJub2RlX21vZHVsZXMvZmFzdG4vbm9kZV9tb2R1bGVzL3NhbWUtdmFsdWUvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZmFzdG4vbm9kZV9tb2R1bGVzL3NldGlmeS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9ub2RlX21vZHVsZXMvc2V0aWZ5L25vZGVfbW9kdWxlcy9uYXR1cmFsLXNlbGVjdGlvbi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9ub2RlX21vZHVsZXMvc2V0cHJvdG90eXBlb2YvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZmFzdG4vbm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9ub2RlX21vZHVsZXMvd2hhdC1jaGFuZ2VkL25vZGVfbW9kdWxlcy9jbG9uZS9jbG9uZS5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9ub2RlX21vZHVsZXMvd2hhdC1jaGFuZ2VkL25vZGVfbW9kdWxlcy9kZWVwLWVxdWFsL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2Zhc3RuL25vZGVfbW9kdWxlcy93aGF0LWNoYW5nZWQvbm9kZV9tb2R1bGVzL2RlZXAtZXF1YWwvbGliL2lzX2FyZ3VtZW50cy5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9ub2RlX21vZHVsZXMvd2hhdC1jaGFuZ2VkL25vZGVfbW9kdWxlcy9kZWVwLWVxdWFsL2xpYi9rZXlzLmpzIiwibm9kZV9tb2R1bGVzL2Zhc3RuL3Byb3BlcnR5LmpzIiwibm9kZV9tb2R1bGVzL2Zhc3RuL3NjaGVkdWxlLmpzIiwibm9kZV9tb2R1bGVzL2Zhc3RuL3RlbXBsYXRlckNvbXBvbmVudC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi90ZXh0Q29tcG9uZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ3hnREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdTQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3prQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25GQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hCQTtBQUNBO0FBQ0E7O0FDRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6T0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4SUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcElBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQy9DQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDaGxCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlNQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDckZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNoS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvTUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKiFcbiAqIFRoZSBidWZmZXIgbW9kdWxlIGZyb20gbm9kZS5qcywgZm9yIHRoZSBicm93c2VyLlxuICpcbiAqIEBhdXRob3IgICBGZXJvc3MgQWJvdWtoYWRpamVoIDxmZXJvc3NAZmVyb3NzLm9yZz4gPGh0dHA6Ly9mZXJvc3Mub3JnPlxuICogQGxpY2Vuc2UgIE1JVFxuICovXG4vKiBlc2xpbnQtZGlzYWJsZSBuby1wcm90byAqL1xuXG52YXIgYmFzZTY0ID0gcmVxdWlyZSgnYmFzZTY0LWpzJylcbnZhciBpZWVlNzU0ID0gcmVxdWlyZSgnaWVlZTc1NCcpXG52YXIgaXNBcnJheSA9IHJlcXVpcmUoJ2lzLWFycmF5JylcblxuZXhwb3J0cy5CdWZmZXIgPSBCdWZmZXJcbmV4cG9ydHMuU2xvd0J1ZmZlciA9IFNsb3dCdWZmZXJcbmV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVMgPSA1MFxuQnVmZmVyLnBvb2xTaXplID0gODE5MiAvLyBub3QgdXNlZCBieSB0aGlzIGltcGxlbWVudGF0aW9uXG5cbnZhciByb290UGFyZW50ID0ge31cblxuLyoqXG4gKiBJZiBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgOlxuICogICA9PT0gdHJ1ZSAgICBVc2UgVWludDhBcnJheSBpbXBsZW1lbnRhdGlvbiAoZmFzdGVzdClcbiAqICAgPT09IGZhbHNlICAgVXNlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiAobW9zdCBjb21wYXRpYmxlLCBldmVuIElFNilcbiAqXG4gKiBCcm93c2VycyB0aGF0IHN1cHBvcnQgdHlwZWQgYXJyYXlzIGFyZSBJRSAxMCssIEZpcmVmb3ggNCssIENocm9tZSA3KywgU2FmYXJpIDUuMSssXG4gKiBPcGVyYSAxMS42KywgaU9TIDQuMisuXG4gKlxuICogRHVlIHRvIHZhcmlvdXMgYnJvd3NlciBidWdzLCBzb21ldGltZXMgdGhlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiB3aWxsIGJlIHVzZWQgZXZlblxuICogd2hlbiB0aGUgYnJvd3NlciBzdXBwb3J0cyB0eXBlZCBhcnJheXMuXG4gKlxuICogTm90ZTpcbiAqXG4gKiAgIC0gRmlyZWZveCA0LTI5IGxhY2tzIHN1cHBvcnQgZm9yIGFkZGluZyBuZXcgcHJvcGVydGllcyB0byBgVWludDhBcnJheWAgaW5zdGFuY2VzLFxuICogICAgIFNlZTogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9Njk1NDM4LlxuICpcbiAqICAgLSBTYWZhcmkgNS03IGxhY2tzIHN1cHBvcnQgZm9yIGNoYW5naW5nIHRoZSBgT2JqZWN0LnByb3RvdHlwZS5jb25zdHJ1Y3RvcmAgcHJvcGVydHlcbiAqICAgICBvbiBvYmplY3RzLlxuICpcbiAqICAgLSBDaHJvbWUgOS0xMCBpcyBtaXNzaW5nIHRoZSBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uLlxuICpcbiAqICAgLSBJRTEwIGhhcyBhIGJyb2tlbiBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uIHdoaWNoIHJldHVybnMgYXJyYXlzIG9mXG4gKiAgICAgaW5jb3JyZWN0IGxlbmd0aCBpbiBzb21lIHNpdHVhdGlvbnMuXG5cbiAqIFdlIGRldGVjdCB0aGVzZSBidWdneSBicm93c2VycyBhbmQgc2V0IGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGAgdG8gYGZhbHNlYCBzbyB0aGV5XG4gKiBnZXQgdGhlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiwgd2hpY2ggaXMgc2xvd2VyIGJ1dCBiZWhhdmVzIGNvcnJlY3RseS5cbiAqL1xuQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgPSBnbG9iYWwuVFlQRURfQVJSQVlfU1VQUE9SVCAhPT0gdW5kZWZpbmVkXG4gID8gZ2xvYmFsLlRZUEVEX0FSUkFZX1NVUFBPUlRcbiAgOiB0eXBlZEFycmF5U3VwcG9ydCgpXG5cbmZ1bmN0aW9uIHR5cGVkQXJyYXlTdXBwb3J0ICgpIHtcbiAgZnVuY3Rpb24gQmFyICgpIHt9XG4gIHRyeSB7XG4gICAgdmFyIGFyciA9IG5ldyBVaW50OEFycmF5KDEpXG4gICAgYXJyLmZvbyA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIDQyIH1cbiAgICBhcnIuY29uc3RydWN0b3IgPSBCYXJcbiAgICByZXR1cm4gYXJyLmZvbygpID09PSA0MiAmJiAvLyB0eXBlZCBhcnJheSBpbnN0YW5jZXMgY2FuIGJlIGF1Z21lbnRlZFxuICAgICAgICBhcnIuY29uc3RydWN0b3IgPT09IEJhciAmJiAvLyBjb25zdHJ1Y3RvciBjYW4gYmUgc2V0XG4gICAgICAgIHR5cGVvZiBhcnIuc3ViYXJyYXkgPT09ICdmdW5jdGlvbicgJiYgLy8gY2hyb21lIDktMTAgbGFjayBgc3ViYXJyYXlgXG4gICAgICAgIGFyci5zdWJhcnJheSgxLCAxKS5ieXRlTGVuZ3RoID09PSAwIC8vIGllMTAgaGFzIGJyb2tlbiBgc3ViYXJyYXlgXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5mdW5jdGlvbiBrTWF4TGVuZ3RoICgpIHtcbiAgcmV0dXJuIEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUXG4gICAgPyAweDdmZmZmZmZmXG4gICAgOiAweDNmZmZmZmZmXG59XG5cbi8qKlxuICogQ2xhc3M6IEJ1ZmZlclxuICogPT09PT09PT09PT09PVxuICpcbiAqIFRoZSBCdWZmZXIgY29uc3RydWN0b3IgcmV0dXJucyBpbnN0YW5jZXMgb2YgYFVpbnQ4QXJyYXlgIHRoYXQgYXJlIGF1Z21lbnRlZFxuICogd2l0aCBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciBhbGwgdGhlIG5vZGUgYEJ1ZmZlcmAgQVBJIGZ1bmN0aW9ucy4gV2UgdXNlXG4gKiBgVWludDhBcnJheWAgc28gdGhhdCBzcXVhcmUgYnJhY2tldCBub3RhdGlvbiB3b3JrcyBhcyBleHBlY3RlZCAtLSBpdCByZXR1cm5zXG4gKiBhIHNpbmdsZSBvY3RldC5cbiAqXG4gKiBCeSBhdWdtZW50aW5nIHRoZSBpbnN0YW5jZXMsIHdlIGNhbiBhdm9pZCBtb2RpZnlpbmcgdGhlIGBVaW50OEFycmF5YFxuICogcHJvdG90eXBlLlxuICovXG5mdW5jdGlvbiBCdWZmZXIgKGFyZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQnVmZmVyKSkge1xuICAgIC8vIEF2b2lkIGdvaW5nIHRocm91Z2ggYW4gQXJndW1lbnRzQWRhcHRvclRyYW1wb2xpbmUgaW4gdGhlIGNvbW1vbiBjYXNlLlxuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkgcmV0dXJuIG5ldyBCdWZmZXIoYXJnLCBhcmd1bWVudHNbMV0pXG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoYXJnKVxuICB9XG5cbiAgdGhpcy5sZW5ndGggPSAwXG4gIHRoaXMucGFyZW50ID0gdW5kZWZpbmVkXG5cbiAgLy8gQ29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnbnVtYmVyJykge1xuICAgIHJldHVybiBmcm9tTnVtYmVyKHRoaXMsIGFyZylcbiAgfVxuXG4gIC8vIFNsaWdodGx5IGxlc3MgY29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBmcm9tU3RyaW5nKHRoaXMsIGFyZywgYXJndW1lbnRzLmxlbmd0aCA+IDEgPyBhcmd1bWVudHNbMV0gOiAndXRmOCcpXG4gIH1cblxuICAvLyBVbnVzdWFsLlxuICByZXR1cm4gZnJvbU9iamVjdCh0aGlzLCBhcmcpXG59XG5cbmZ1bmN0aW9uIGZyb21OdW1iZXIgKHRoYXQsIGxlbmd0aCkge1xuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoIDwgMCA/IDAgOiBjaGVja2VkKGxlbmd0aCkgfCAwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgdGhhdFtpXSA9IDBcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbVN0cmluZyAodGhhdCwgc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIGVuY29kaW5nICE9PSAnc3RyaW5nJyB8fCBlbmNvZGluZyA9PT0gJycpIGVuY29kaW5nID0gJ3V0ZjgnXG5cbiAgLy8gQXNzdW1wdGlvbjogYnl0ZUxlbmd0aCgpIHJldHVybiB2YWx1ZSBpcyBhbHdheXMgPCBrTWF4TGVuZ3RoLlxuICB2YXIgbGVuZ3RoID0gYnl0ZUxlbmd0aChzdHJpbmcsIGVuY29kaW5nKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcblxuICB0aGF0LndyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21PYmplY3QgKHRoYXQsIG9iamVjdCkge1xuICBpZiAoQnVmZmVyLmlzQnVmZmVyKG9iamVjdCkpIHJldHVybiBmcm9tQnVmZmVyKHRoYXQsIG9iamVjdClcblxuICBpZiAoaXNBcnJheShvYmplY3QpKSByZXR1cm4gZnJvbUFycmF5KHRoYXQsIG9iamVjdClcblxuICBpZiAob2JqZWN0ID09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtdXN0IHN0YXJ0IHdpdGggbnVtYmVyLCBidWZmZXIsIGFycmF5IG9yIHN0cmluZycpXG4gIH1cblxuICBpZiAodHlwZW9mIEFycmF5QnVmZmVyICE9PSAndW5kZWZpbmVkJykge1xuICAgIGlmIChvYmplY3QuYnVmZmVyIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcbiAgICAgIHJldHVybiBmcm9tVHlwZWRBcnJheSh0aGF0LCBvYmplY3QpXG4gICAgfVxuICAgIGlmIChvYmplY3QgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xuICAgICAgcmV0dXJuIGZyb21BcnJheUJ1ZmZlcih0aGF0LCBvYmplY3QpXG4gICAgfVxuICB9XG5cbiAgaWYgKG9iamVjdC5sZW5ndGgpIHJldHVybiBmcm9tQXJyYXlMaWtlKHRoYXQsIG9iamVjdClcblxuICByZXR1cm4gZnJvbUpzb25PYmplY3QodGhhdCwgb2JqZWN0KVxufVxuXG5mdW5jdGlvbiBmcm9tQnVmZmVyICh0aGF0LCBidWZmZXIpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYnVmZmVyLmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGJ1ZmZlci5jb3B5KHRoYXQsIDAsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5ICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuLy8gRHVwbGljYXRlIG9mIGZyb21BcnJheSgpIHRvIGtlZXAgZnJvbUFycmF5KCkgbW9ub21vcnBoaWMuXG5mdW5jdGlvbiBmcm9tVHlwZWRBcnJheSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgLy8gVHJ1bmNhdGluZyB0aGUgZWxlbWVudHMgaXMgcHJvYmFibHkgbm90IHdoYXQgcGVvcGxlIGV4cGVjdCBmcm9tIHR5cGVkXG4gIC8vIGFycmF5cyB3aXRoIEJZVEVTX1BFUl9FTEVNRU5UID4gMSBidXQgaXQncyBjb21wYXRpYmxlIHdpdGggdGhlIGJlaGF2aW9yXG4gIC8vIG9mIHRoZSBvbGQgQnVmZmVyIGNvbnN0cnVjdG9yLlxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5QnVmZmVyICh0aGF0LCBhcnJheSkge1xuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAvLyBSZXR1cm4gYW4gYXVnbWVudGVkIGBVaW50OEFycmF5YCBpbnN0YW5jZSwgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICBhcnJheS5ieXRlTGVuZ3RoXG4gICAgdGhhdCA9IEJ1ZmZlci5fYXVnbWVudChuZXcgVWludDhBcnJheShhcnJheSkpXG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFJldHVybiBhbiBvYmplY3QgaW5zdGFuY2Ugb2YgdGhlIEJ1ZmZlciBjbGFzc1xuICAgIHRoYXQgPSBmcm9tVHlwZWRBcnJheSh0aGF0LCBuZXcgVWludDhBcnJheShhcnJheSkpXG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5TGlrZSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbi8vIERlc2VyaWFsaXplIHsgdHlwZTogJ0J1ZmZlcicsIGRhdGE6IFsxLDIsMywuLi5dIH0gaW50byBhIEJ1ZmZlciBvYmplY3QuXG4vLyBSZXR1cm5zIGEgemVyby1sZW5ndGggYnVmZmVyIGZvciBpbnB1dHMgdGhhdCBkb24ndCBjb25mb3JtIHRvIHRoZSBzcGVjLlxuZnVuY3Rpb24gZnJvbUpzb25PYmplY3QgKHRoYXQsIG9iamVjdCkge1xuICB2YXIgYXJyYXlcbiAgdmFyIGxlbmd0aCA9IDBcblxuICBpZiAob2JqZWN0LnR5cGUgPT09ICdCdWZmZXInICYmIGlzQXJyYXkob2JqZWN0LmRhdGEpKSB7XG4gICAgYXJyYXkgPSBvYmplY3QuZGF0YVxuICAgIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgfVxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5pZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgQnVmZmVyLnByb3RvdHlwZS5fX3Byb3RvX18gPSBVaW50OEFycmF5LnByb3RvdHlwZVxuICBCdWZmZXIuX19wcm90b19fID0gVWludDhBcnJheVxufVxuXG5mdW5jdGlvbiBhbGxvY2F0ZSAodGhhdCwgbGVuZ3RoKSB7XG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlLCBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIHRoYXQgPSBCdWZmZXIuX2F1Z21lbnQobmV3IFVpbnQ4QXJyYXkobGVuZ3RoKSlcbiAgICB0aGF0Ll9fcHJvdG9fXyA9IEJ1ZmZlci5wcm90b3R5cGVcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjazogUmV0dXJuIGFuIG9iamVjdCBpbnN0YW5jZSBvZiB0aGUgQnVmZmVyIGNsYXNzXG4gICAgdGhhdC5sZW5ndGggPSBsZW5ndGhcbiAgICB0aGF0Ll9pc0J1ZmZlciA9IHRydWVcbiAgfVxuXG4gIHZhciBmcm9tUG9vbCA9IGxlbmd0aCAhPT0gMCAmJiBsZW5ndGggPD0gQnVmZmVyLnBvb2xTaXplID4+PiAxXG4gIGlmIChmcm9tUG9vbCkgdGhhdC5wYXJlbnQgPSByb290UGFyZW50XG5cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gY2hlY2tlZCAobGVuZ3RoKSB7XG4gIC8vIE5vdGU6IGNhbm5vdCB1c2UgYGxlbmd0aCA8IGtNYXhMZW5ndGhgIGhlcmUgYmVjYXVzZSB0aGF0IGZhaWxzIHdoZW5cbiAgLy8gbGVuZ3RoIGlzIE5hTiAod2hpY2ggaXMgb3RoZXJ3aXNlIGNvZXJjZWQgdG8gemVyby4pXG4gIGlmIChsZW5ndGggPj0ga01heExlbmd0aCgpKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0F0dGVtcHQgdG8gYWxsb2NhdGUgQnVmZmVyIGxhcmdlciB0aGFuIG1heGltdW0gJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgJ3NpemU6IDB4JyArIGtNYXhMZW5ndGgoKS50b1N0cmluZygxNikgKyAnIGJ5dGVzJylcbiAgfVxuICByZXR1cm4gbGVuZ3RoIHwgMFxufVxuXG5mdW5jdGlvbiBTbG93QnVmZmVyIChzdWJqZWN0LCBlbmNvZGluZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgU2xvd0J1ZmZlcikpIHJldHVybiBuZXcgU2xvd0J1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcbiAgZGVsZXRlIGJ1Zi5wYXJlbnRcbiAgcmV0dXJuIGJ1ZlxufVxuXG5CdWZmZXIuaXNCdWZmZXIgPSBmdW5jdGlvbiBpc0J1ZmZlciAoYikge1xuICByZXR1cm4gISEoYiAhPSBudWxsICYmIGIuX2lzQnVmZmVyKVxufVxuXG5CdWZmZXIuY29tcGFyZSA9IGZ1bmN0aW9uIGNvbXBhcmUgKGEsIGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYSkgfHwgIUJ1ZmZlci5pc0J1ZmZlcihiKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyBtdXN0IGJlIEJ1ZmZlcnMnKVxuICB9XG5cbiAgaWYgKGEgPT09IGIpIHJldHVybiAwXG5cbiAgdmFyIHggPSBhLmxlbmd0aFxuICB2YXIgeSA9IGIubGVuZ3RoXG5cbiAgdmFyIGkgPSAwXG4gIHZhciBsZW4gPSBNYXRoLm1pbih4LCB5KVxuICB3aGlsZSAoaSA8IGxlbikge1xuICAgIGlmIChhW2ldICE9PSBiW2ldKSBicmVha1xuXG4gICAgKytpXG4gIH1cblxuICBpZiAoaSAhPT0gbGVuKSB7XG4gICAgeCA9IGFbaV1cbiAgICB5ID0gYltpXVxuICB9XG5cbiAgaWYgKHggPCB5KSByZXR1cm4gLTFcbiAgaWYgKHkgPCB4KSByZXR1cm4gMVxuICByZXR1cm4gMFxufVxuXG5CdWZmZXIuaXNFbmNvZGluZyA9IGZ1bmN0aW9uIGlzRW5jb2RpbmcgKGVuY29kaW5nKSB7XG4gIHN3aXRjaCAoU3RyaW5nKGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICBjYXNlICdyYXcnOlxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5CdWZmZXIuY29uY2F0ID0gZnVuY3Rpb24gY29uY2F0IChsaXN0LCBsZW5ndGgpIHtcbiAgaWYgKCFpc0FycmF5KGxpc3QpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0IGFyZ3VtZW50IG11c3QgYmUgYW4gQXJyYXkgb2YgQnVmZmVycy4nKVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBuZXcgQnVmZmVyKDApXG4gIH1cblxuICB2YXIgaVxuICBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQpIHtcbiAgICBsZW5ndGggPSAwXG4gICAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgIGxlbmd0aCArPSBsaXN0W2ldLmxlbmd0aFxuICAgIH1cbiAgfVxuXG4gIHZhciBidWYgPSBuZXcgQnVmZmVyKGxlbmd0aClcbiAgdmFyIHBvcyA9IDBcbiAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgaXRlbSA9IGxpc3RbaV1cbiAgICBpdGVtLmNvcHkoYnVmLCBwb3MpXG4gICAgcG9zICs9IGl0ZW0ubGVuZ3RoXG4gIH1cbiAgcmV0dXJuIGJ1ZlxufVxuXG5mdW5jdGlvbiBieXRlTGVuZ3RoIChzdHJpbmcsIGVuY29kaW5nKSB7XG4gIGlmICh0eXBlb2Ygc3RyaW5nICE9PSAnc3RyaW5nJykgc3RyaW5nID0gJycgKyBzdHJpbmdcblxuICB2YXIgbGVuID0gc3RyaW5nLmxlbmd0aFxuICBpZiAobGVuID09PSAwKSByZXR1cm4gMFxuXG4gIC8vIFVzZSBhIGZvciBsb29wIHRvIGF2b2lkIHJlY3Vyc2lvblxuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuICBmb3IgKDs7KSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgIC8vIERlcHJlY2F0ZWRcbiAgICAgIGNhc2UgJ3Jhdyc6XG4gICAgICBjYXNlICdyYXdzJzpcbiAgICAgICAgcmV0dXJuIGxlblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4VG9CeXRlcyhzdHJpbmcpLmxlbmd0aFxuICAgICAgY2FzZSAndWNzMic6XG4gICAgICBjYXNlICd1Y3MtMic6XG4gICAgICBjYXNlICd1dGYxNmxlJzpcbiAgICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgICAgcmV0dXJuIGxlbiAqIDJcbiAgICAgIGNhc2UgJ2hleCc6XG4gICAgICAgIHJldHVybiBsZW4gPj4+IDFcbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIHJldHVybiBiYXNlNjRUb0J5dGVzKHN0cmluZykubGVuZ3RoXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAobG93ZXJlZENhc2UpIHJldHVybiB1dGY4VG9CeXRlcyhzdHJpbmcpLmxlbmd0aCAvLyBhc3N1bWUgdXRmOFxuICAgICAgICBlbmNvZGluZyA9ICgnJyArIGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuQnVmZmVyLmJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoXG5cbi8vIHByZS1zZXQgZm9yIHZhbHVlcyB0aGF0IG1heSBleGlzdCBpbiB0aGUgZnV0dXJlXG5CdWZmZXIucHJvdG90eXBlLmxlbmd0aCA9IHVuZGVmaW5lZFxuQnVmZmVyLnByb3RvdHlwZS5wYXJlbnQgPSB1bmRlZmluZWRcblxuZnVuY3Rpb24gc2xvd1RvU3RyaW5nIChlbmNvZGluZywgc3RhcnQsIGVuZCkge1xuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuXG4gIHN0YXJ0ID0gc3RhcnQgfCAwXG4gIGVuZCA9IGVuZCA9PT0gdW5kZWZpbmVkIHx8IGVuZCA9PT0gSW5maW5pdHkgPyB0aGlzLmxlbmd0aCA6IGVuZCB8IDBcblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAoZW5kIDw9IHN0YXJ0KSByZXR1cm4gJydcblxuICB3aGlsZSAodHJ1ZSkge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2hleCc6XG4gICAgICAgIHJldHVybiBoZXhTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICd1dGY4JzpcbiAgICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgICAgcmV0dXJuIHV0ZjhTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdhc2NpaSc6XG4gICAgICAgIHJldHVybiBhc2NpaVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAgIHJldHVybiBiaW5hcnlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndWNzMic6XG4gICAgICBjYXNlICd1Y3MtMic6XG4gICAgICBjYXNlICd1dGYxNmxlJzpcbiAgICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgICAgcmV0dXJuIHV0ZjE2bGVTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAobG93ZXJlZENhc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZylcbiAgICAgICAgZW5jb2RpbmcgPSAoZW5jb2RpbmcgKyAnJykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uIHRvU3RyaW5nICgpIHtcbiAgdmFyIGxlbmd0aCA9IHRoaXMubGVuZ3RoIHwgMFxuICBpZiAobGVuZ3RoID09PSAwKSByZXR1cm4gJydcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHJldHVybiB1dGY4U2xpY2UodGhpcywgMCwgbGVuZ3RoKVxuICByZXR1cm4gc2xvd1RvU3RyaW5nLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5lcXVhbHMgPSBmdW5jdGlvbiBlcXVhbHMgKGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IG11c3QgYmUgYSBCdWZmZXInKVxuICBpZiAodGhpcyA9PT0gYikgcmV0dXJuIHRydWVcbiAgcmV0dXJuIEJ1ZmZlci5jb21wYXJlKHRoaXMsIGIpID09PSAwXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5zcGVjdCA9IGZ1bmN0aW9uIGluc3BlY3QgKCkge1xuICB2YXIgc3RyID0gJydcbiAgdmFyIG1heCA9IGV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVNcbiAgaWYgKHRoaXMubGVuZ3RoID4gMCkge1xuICAgIHN0ciA9IHRoaXMudG9TdHJpbmcoJ2hleCcsIDAsIG1heCkubWF0Y2goLy57Mn0vZykuam9pbignICcpXG4gICAgaWYgKHRoaXMubGVuZ3RoID4gbWF4KSBzdHIgKz0gJyAuLi4gJ1xuICB9XG4gIHJldHVybiAnPEJ1ZmZlciAnICsgc3RyICsgJz4nXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuY29tcGFyZSA9IGZ1bmN0aW9uIGNvbXBhcmUgKGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IG11c3QgYmUgYSBCdWZmZXInKVxuICBpZiAodGhpcyA9PT0gYikgcmV0dXJuIDBcbiAgcmV0dXJuIEJ1ZmZlci5jb21wYXJlKHRoaXMsIGIpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5kZXhPZiA9IGZ1bmN0aW9uIGluZGV4T2YgKHZhbCwgYnl0ZU9mZnNldCkge1xuICBpZiAoYnl0ZU9mZnNldCA+IDB4N2ZmZmZmZmYpIGJ5dGVPZmZzZXQgPSAweDdmZmZmZmZmXG4gIGVsc2UgaWYgKGJ5dGVPZmZzZXQgPCAtMHg4MDAwMDAwMCkgYnl0ZU9mZnNldCA9IC0weDgwMDAwMDAwXG4gIGJ5dGVPZmZzZXQgPj49IDBcblxuICBpZiAodGhpcy5sZW5ndGggPT09IDApIHJldHVybiAtMVxuICBpZiAoYnl0ZU9mZnNldCA+PSB0aGlzLmxlbmd0aCkgcmV0dXJuIC0xXG5cbiAgLy8gTmVnYXRpdmUgb2Zmc2V0cyBzdGFydCBmcm9tIHRoZSBlbmQgb2YgdGhlIGJ1ZmZlclxuICBpZiAoYnl0ZU9mZnNldCA8IDApIGJ5dGVPZmZzZXQgPSBNYXRoLm1heCh0aGlzLmxlbmd0aCArIGJ5dGVPZmZzZXQsIDApXG5cbiAgaWYgKHR5cGVvZiB2YWwgPT09ICdzdHJpbmcnKSB7XG4gICAgaWYgKHZhbC5sZW5ndGggPT09IDApIHJldHVybiAtMSAvLyBzcGVjaWFsIGNhc2U6IGxvb2tpbmcgZm9yIGVtcHR5IHN0cmluZyBhbHdheXMgZmFpbHNcbiAgICByZXR1cm4gU3RyaW5nLnByb3RvdHlwZS5pbmRleE9mLmNhbGwodGhpcywgdmFsLCBieXRlT2Zmc2V0KVxuICB9XG4gIGlmIChCdWZmZXIuaXNCdWZmZXIodmFsKSkge1xuICAgIHJldHVybiBhcnJheUluZGV4T2YodGhpcywgdmFsLCBieXRlT2Zmc2V0KVxuICB9XG4gIGlmICh0eXBlb2YgdmFsID09PSAnbnVtYmVyJykge1xuICAgIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCAmJiBVaW50OEFycmF5LnByb3RvdHlwZS5pbmRleE9mID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgICB9XG4gICAgcmV0dXJuIGFycmF5SW5kZXhPZih0aGlzLCBbIHZhbCBdLCBieXRlT2Zmc2V0KVxuICB9XG5cbiAgZnVuY3Rpb24gYXJyYXlJbmRleE9mIChhcnIsIHZhbCwgYnl0ZU9mZnNldCkge1xuICAgIHZhciBmb3VuZEluZGV4ID0gLTFcbiAgICBmb3IgKHZhciBpID0gMDsgYnl0ZU9mZnNldCArIGkgPCBhcnIubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChhcnJbYnl0ZU9mZnNldCArIGldID09PSB2YWxbZm91bmRJbmRleCA9PT0gLTEgPyAwIDogaSAtIGZvdW5kSW5kZXhdKSB7XG4gICAgICAgIGlmIChmb3VuZEluZGV4ID09PSAtMSkgZm91bmRJbmRleCA9IGlcbiAgICAgICAgaWYgKGkgLSBmb3VuZEluZGV4ICsgMSA9PT0gdmFsLmxlbmd0aCkgcmV0dXJuIGJ5dGVPZmZzZXQgKyBmb3VuZEluZGV4XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3VuZEluZGV4ID0gLTFcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIC0xXG4gIH1cblxuICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2YWwgbXVzdCBiZSBzdHJpbmcsIG51bWJlciBvciBCdWZmZXInKVxufVxuXG4vLyBgZ2V0YCBpcyBkZXByZWNhdGVkXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIGdldCAob2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuZ2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy5yZWFkVUludDgob2Zmc2V0KVxufVxuXG4vLyBgc2V0YCBpcyBkZXByZWNhdGVkXG5CdWZmZXIucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uIHNldCAodiwgb2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuc2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy53cml0ZVVJbnQ4KHYsIG9mZnNldClcbn1cblxuZnVuY3Rpb24gaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICAvLyBtdXN0IGJlIGFuIGV2ZW4gbnVtYmVyIG9mIGRpZ2l0c1xuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuICBpZiAoc3RyTGVuICUgMiAhPT0gMCkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuXG4gIGlmIChsZW5ndGggPiBzdHJMZW4gLyAyKSB7XG4gICAgbGVuZ3RoID0gc3RyTGVuIC8gMlxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFyc2VkID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGlmIChpc05hTihwYXJzZWQpKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG4gICAgYnVmW29mZnNldCArIGldID0gcGFyc2VkXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gdXRmOFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYXNjaWlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKGFzY2lpVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBiaW5hcnlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBhc2NpaVdyaXRlKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihiYXNlNjRUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIHVjczJXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjE2bGVUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiB3cml0ZSAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpIHtcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZylcbiAgaWYgKG9mZnNldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgZW5jb2RpbmcgPSAndXRmOCdcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIH0gZWxzZSBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgJiYgdHlwZW9mIG9mZnNldCA9PT0gJ3N0cmluZycpIHtcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIGxlbmd0aCA9IHRoaXMubGVuZ3RoXG4gICAgb2Zmc2V0ID0gMFxuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nLCBvZmZzZXRbLCBsZW5ndGhdWywgZW5jb2RpbmddKVxuICB9IGVsc2UgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gICAgaWYgKGlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGxlbmd0aCA9IGxlbmd0aCB8IDBcbiAgICAgIGlmIChlbmNvZGluZyA9PT0gdW5kZWZpbmVkKSBlbmNvZGluZyA9ICd1dGY4J1xuICAgIH0gZWxzZSB7XG4gICAgICBlbmNvZGluZyA9IGxlbmd0aFxuICAgICAgbGVuZ3RoID0gdW5kZWZpbmVkXG4gICAgfVxuICAvLyBsZWdhY3kgd3JpdGUoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0LCBsZW5ndGgpIC0gcmVtb3ZlIGluIHYwLjEzXG4gIH0gZWxzZSB7XG4gICAgdmFyIHN3YXAgPSBlbmNvZGluZ1xuICAgIGVuY29kaW5nID0gb2Zmc2V0XG4gICAgb2Zmc2V0ID0gbGVuZ3RoIHwgMFxuICAgIGxlbmd0aCA9IHN3YXBcbiAgfVxuXG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldFxuICBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgfHwgbGVuZ3RoID4gcmVtYWluaW5nKSBsZW5ndGggPSByZW1haW5pbmdcblxuICBpZiAoKHN0cmluZy5sZW5ndGggPiAwICYmIChsZW5ndGggPCAwIHx8IG9mZnNldCA8IDApKSB8fCBvZmZzZXQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdhdHRlbXB0IHRvIHdyaXRlIG91dHNpZGUgYnVmZmVyIGJvdW5kcycpXG4gIH1cblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG4gIGZvciAoOzspIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgLy8gV2FybmluZzogbWF4TGVuZ3RoIG5vdCB0YWtlbiBpbnRvIGFjY291bnQgaW4gYmFzZTY0V3JpdGVcbiAgICAgICAgcmV0dXJuIGJhc2U2NFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1Y3MyV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKCcnICsgZW5jb2RpbmcpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9KU09OID0gZnVuY3Rpb24gdG9KU09OICgpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnQnVmZmVyJyxcbiAgICBkYXRhOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCh0aGlzLl9hcnIgfHwgdGhpcywgMClcbiAgfVxufVxuXG5mdW5jdGlvbiBiYXNlNjRTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA9PT0gMCAmJiBlbmQgPT09IGJ1Zi5sZW5ndGgpIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYuc2xpY2Uoc3RhcnQsIGVuZCkpXG4gIH1cbn1cblxuZnVuY3Rpb24gdXRmOFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuICB2YXIgcmVzID0gW11cblxuICB2YXIgaSA9IHN0YXJ0XG4gIHdoaWxlIChpIDwgZW5kKSB7XG4gICAgdmFyIGZpcnN0Qnl0ZSA9IGJ1ZltpXVxuICAgIHZhciBjb2RlUG9pbnQgPSBudWxsXG4gICAgdmFyIGJ5dGVzUGVyU2VxdWVuY2UgPSAoZmlyc3RCeXRlID4gMHhFRikgPyA0XG4gICAgICA6IChmaXJzdEJ5dGUgPiAweERGKSA/IDNcbiAgICAgIDogKGZpcnN0Qnl0ZSA+IDB4QkYpID8gMlxuICAgICAgOiAxXG5cbiAgICBpZiAoaSArIGJ5dGVzUGVyU2VxdWVuY2UgPD0gZW5kKSB7XG4gICAgICB2YXIgc2Vjb25kQnl0ZSwgdGhpcmRCeXRlLCBmb3VydGhCeXRlLCB0ZW1wQ29kZVBvaW50XG5cbiAgICAgIHN3aXRjaCAoYnl0ZXNQZXJTZXF1ZW5jZSkge1xuICAgICAgICBjYXNlIDE6XG4gICAgICAgICAgaWYgKGZpcnN0Qnl0ZSA8IDB4ODApIHtcbiAgICAgICAgICAgIGNvZGVQb2ludCA9IGZpcnN0Qnl0ZVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVha1xuICAgICAgICBjYXNlIDI6XG4gICAgICAgICAgc2Vjb25kQnl0ZSA9IGJ1ZltpICsgMV1cbiAgICAgICAgICBpZiAoKHNlY29uZEJ5dGUgJiAweEMwKSA9PT0gMHg4MCkge1xuICAgICAgICAgICAgdGVtcENvZGVQb2ludCA9IChmaXJzdEJ5dGUgJiAweDFGKSA8PCAweDYgfCAoc2Vjb25kQnl0ZSAmIDB4M0YpXG4gICAgICAgICAgICBpZiAodGVtcENvZGVQb2ludCA+IDB4N0YpIHtcbiAgICAgICAgICAgICAgY29kZVBvaW50ID0gdGVtcENvZGVQb2ludFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVha1xuICAgICAgICBjYXNlIDM6XG4gICAgICAgICAgc2Vjb25kQnl0ZSA9IGJ1ZltpICsgMV1cbiAgICAgICAgICB0aGlyZEJ5dGUgPSBidWZbaSArIDJdXG4gICAgICAgICAgaWYgKChzZWNvbmRCeXRlICYgMHhDMCkgPT09IDB4ODAgJiYgKHRoaXJkQnl0ZSAmIDB4QzApID09PSAweDgwKSB7XG4gICAgICAgICAgICB0ZW1wQ29kZVBvaW50ID0gKGZpcnN0Qnl0ZSAmIDB4RikgPDwgMHhDIHwgKHNlY29uZEJ5dGUgJiAweDNGKSA8PCAweDYgfCAodGhpcmRCeXRlICYgMHgzRilcbiAgICAgICAgICAgIGlmICh0ZW1wQ29kZVBvaW50ID4gMHg3RkYgJiYgKHRlbXBDb2RlUG9pbnQgPCAweEQ4MDAgfHwgdGVtcENvZGVQb2ludCA+IDB4REZGRikpIHtcbiAgICAgICAgICAgICAgY29kZVBvaW50ID0gdGVtcENvZGVQb2ludFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVha1xuICAgICAgICBjYXNlIDQ6XG4gICAgICAgICAgc2Vjb25kQnl0ZSA9IGJ1ZltpICsgMV1cbiAgICAgICAgICB0aGlyZEJ5dGUgPSBidWZbaSArIDJdXG4gICAgICAgICAgZm91cnRoQnl0ZSA9IGJ1ZltpICsgM11cbiAgICAgICAgICBpZiAoKHNlY29uZEJ5dGUgJiAweEMwKSA9PT0gMHg4MCAmJiAodGhpcmRCeXRlICYgMHhDMCkgPT09IDB4ODAgJiYgKGZvdXJ0aEJ5dGUgJiAweEMwKSA9PT0gMHg4MCkge1xuICAgICAgICAgICAgdGVtcENvZGVQb2ludCA9IChmaXJzdEJ5dGUgJiAweEYpIDw8IDB4MTIgfCAoc2Vjb25kQnl0ZSAmIDB4M0YpIDw8IDB4QyB8ICh0aGlyZEJ5dGUgJiAweDNGKSA8PCAweDYgfCAoZm91cnRoQnl0ZSAmIDB4M0YpXG4gICAgICAgICAgICBpZiAodGVtcENvZGVQb2ludCA+IDB4RkZGRiAmJiB0ZW1wQ29kZVBvaW50IDwgMHgxMTAwMDApIHtcbiAgICAgICAgICAgICAgY29kZVBvaW50ID0gdGVtcENvZGVQb2ludFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY29kZVBvaW50ID09PSBudWxsKSB7XG4gICAgICAvLyB3ZSBkaWQgbm90IGdlbmVyYXRlIGEgdmFsaWQgY29kZVBvaW50IHNvIGluc2VydCBhXG4gICAgICAvLyByZXBsYWNlbWVudCBjaGFyIChVK0ZGRkQpIGFuZCBhZHZhbmNlIG9ubHkgMSBieXRlXG4gICAgICBjb2RlUG9pbnQgPSAweEZGRkRcbiAgICAgIGJ5dGVzUGVyU2VxdWVuY2UgPSAxXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPiAweEZGRkYpIHtcbiAgICAgIC8vIGVuY29kZSB0byB1dGYxNiAoc3Vycm9nYXRlIHBhaXIgZGFuY2UpXG4gICAgICBjb2RlUG9pbnQgLT0gMHgxMDAwMFxuICAgICAgcmVzLnB1c2goY29kZVBvaW50ID4+PiAxMCAmIDB4M0ZGIHwgMHhEODAwKVxuICAgICAgY29kZVBvaW50ID0gMHhEQzAwIHwgY29kZVBvaW50ICYgMHgzRkZcbiAgICB9XG5cbiAgICByZXMucHVzaChjb2RlUG9pbnQpXG4gICAgaSArPSBieXRlc1BlclNlcXVlbmNlXG4gIH1cblxuICByZXR1cm4gZGVjb2RlQ29kZVBvaW50c0FycmF5KHJlcylcbn1cblxuLy8gQmFzZWQgb24gaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL2EvMjI3NDcyNzIvNjgwNzQyLCB0aGUgYnJvd3NlciB3aXRoXG4vLyB0aGUgbG93ZXN0IGxpbWl0IGlzIENocm9tZSwgd2l0aCAweDEwMDAwIGFyZ3MuXG4vLyBXZSBnbyAxIG1hZ25pdHVkZSBsZXNzLCBmb3Igc2FmZXR5XG52YXIgTUFYX0FSR1VNRU5UU19MRU5HVEggPSAweDEwMDBcblxuZnVuY3Rpb24gZGVjb2RlQ29kZVBvaW50c0FycmF5IChjb2RlUG9pbnRzKSB7XG4gIHZhciBsZW4gPSBjb2RlUG9pbnRzLmxlbmd0aFxuICBpZiAobGVuIDw9IE1BWF9BUkdVTUVOVFNfTEVOR1RIKSB7XG4gICAgcmV0dXJuIFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkoU3RyaW5nLCBjb2RlUG9pbnRzKSAvLyBhdm9pZCBleHRyYSBzbGljZSgpXG4gIH1cblxuICAvLyBEZWNvZGUgaW4gY2h1bmtzIHRvIGF2b2lkIFwiY2FsbCBzdGFjayBzaXplIGV4Y2VlZGVkXCIuXG4gIHZhciByZXMgPSAnJ1xuICB2YXIgaSA9IDBcbiAgd2hpbGUgKGkgPCBsZW4pIHtcbiAgICByZXMgKz0gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShcbiAgICAgIFN0cmluZyxcbiAgICAgIGNvZGVQb2ludHMuc2xpY2UoaSwgaSArPSBNQVhfQVJHVU1FTlRTX0xFTkdUSClcbiAgICApXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5mdW5jdGlvbiBhc2NpaVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSAmIDB4N0YpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBiaW5hcnlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICByZXQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBoZXhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG5cbiAgaWYgKCFzdGFydCB8fCBzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCB8fCBlbmQgPCAwIHx8IGVuZCA+IGxlbikgZW5kID0gbGVuXG5cbiAgdmFyIG91dCA9ICcnXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgb3V0ICs9IHRvSGV4KGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBieXRlcyA9IGJ1Zi5zbGljZShzdGFydCwgZW5kKVxuICB2YXIgcmVzID0gJydcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHJlcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW2ldICsgYnl0ZXNbaSArIDFdICogMjU2KVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uIHNsaWNlIChzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBzdGFydCA9IH5+c3RhcnRcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgPyBsZW4gOiB+fmVuZFxuXG4gIGlmIChzdGFydCA8IDApIHtcbiAgICBzdGFydCArPSBsZW5cbiAgICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgfSBlbHNlIGlmIChzdGFydCA+IGxlbikge1xuICAgIHN0YXJ0ID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgMCkge1xuICAgIGVuZCArPSBsZW5cbiAgICBpZiAoZW5kIDwgMCkgZW5kID0gMFxuICB9IGVsc2UgaWYgKGVuZCA+IGxlbikge1xuICAgIGVuZCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSBlbmQgPSBzdGFydFxuXG4gIHZhciBuZXdCdWZcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgbmV3QnVmID0gQnVmZmVyLl9hdWdtZW50KHRoaXMuc3ViYXJyYXkoc3RhcnQsIGVuZCkpXG4gIH0gZWxzZSB7XG4gICAgdmFyIHNsaWNlTGVuID0gZW5kIC0gc3RhcnRcbiAgICBuZXdCdWYgPSBuZXcgQnVmZmVyKHNsaWNlTGVuLCB1bmRlZmluZWQpXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzbGljZUxlbjsgaSsrKSB7XG4gICAgICBuZXdCdWZbaV0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH1cblxuICBpZiAobmV3QnVmLmxlbmd0aCkgbmV3QnVmLnBhcmVudCA9IHRoaXMucGFyZW50IHx8IHRoaXNcblxuICByZXR1cm4gbmV3QnVmXG59XG5cbi8qXG4gKiBOZWVkIHRvIG1ha2Ugc3VyZSB0aGF0IGJ1ZmZlciBpc24ndCB0cnlpbmcgdG8gd3JpdGUgb3V0IG9mIGJvdW5kcy5cbiAqL1xuZnVuY3Rpb24gY2hlY2tPZmZzZXQgKG9mZnNldCwgZXh0LCBsZW5ndGgpIHtcbiAgaWYgKChvZmZzZXQgJSAxKSAhPT0gMCB8fCBvZmZzZXQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignb2Zmc2V0IGlzIG5vdCB1aW50JylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1RyeWluZyB0byBhY2Nlc3MgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50TEUgPSBmdW5jdGlvbiByZWFkVUludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50QkUgPSBmdW5jdGlvbiByZWFkVUludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuICB9XG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgLS1ieXRlTGVuZ3RoXVxuICB2YXIgbXVsID0gMVxuICB3aGlsZSAoYnl0ZUxlbmd0aCA+IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdICogbXVsXG4gIH1cblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQ4ID0gZnVuY3Rpb24gcmVhZFVJbnQ4IChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiB0aGlzW29mZnNldF1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2TEUgPSBmdW5jdGlvbiByZWFkVUludDE2TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkJFID0gZnVuY3Rpb24gcmVhZFVJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDgpIHwgdGhpc1tvZmZzZXQgKyAxXVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAoKHRoaXNbb2Zmc2V0XSkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpKSArXG4gICAgICAodGhpc1tvZmZzZXQgKyAzXSAqIDB4MTAwMDAwMClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyQkUgPSBmdW5jdGlvbiByZWFkVUludDMyQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSAqIDB4MTAwMDAwMCkgK1xuICAgICgodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICB0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnRMRSA9IGZ1bmN0aW9uIHJlYWRJbnRMRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF1cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgaV0gKiBtdWxcbiAgfVxuICBtdWwgKj0gMHg4MFxuXG4gIGlmICh2YWwgPj0gbXVsKSB2YWwgLT0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpXG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnRCRSA9IGZ1bmN0aW9uIHJlYWRJbnRCRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aFxuICB2YXIgbXVsID0gMVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWldXG4gIHdoaWxlIChpID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0taV0gKiBtdWxcbiAgfVxuICBtdWwgKj0gMHg4MFxuXG4gIGlmICh2YWwgPj0gbXVsKSB2YWwgLT0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpXG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQ4ID0gZnVuY3Rpb24gcmVhZEludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgaWYgKCEodGhpc1tvZmZzZXRdICYgMHg4MCkpIHJldHVybiAodGhpc1tvZmZzZXRdKVxuICByZXR1cm4gKCgweGZmIC0gdGhpc1tvZmZzZXRdICsgMSkgKiAtMSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF0gfCAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2QkUgPSBmdW5jdGlvbiByZWFkSW50MTZCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAxXSB8ICh0aGlzW29mZnNldF0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkxFID0gZnVuY3Rpb24gcmVhZEludDMyTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSkgfFxuICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDNdIDw8IDI0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkJFID0gZnVuY3Rpb24gcmVhZEludDMyQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSA8PCAyNCkgfFxuICAgICh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgICh0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdExFID0gZnVuY3Rpb24gcmVhZEZsb2F0TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIHRydWUsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdEJFID0gZnVuY3Rpb24gcmVhZEZsb2F0QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlTEUgPSBmdW5jdGlvbiByZWFkRG91YmxlTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA4LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIHRydWUsIDUyLCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVCRSA9IGZ1bmN0aW9uIHJlYWREb3VibGVCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDUyLCA4KVxufVxuXG5mdW5jdGlvbiBjaGVja0ludCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGJ1ZikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2J1ZmZlciBtdXN0IGJlIGEgQnVmZmVyIGluc3RhbmNlJylcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnRMRSA9IGZ1bmN0aW9uIHdyaXRlVUludExFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCksIDApXG5cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAodmFsdWUgLyBtdWwpICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnRCRSA9IGZ1bmN0aW9uIHdyaXRlVUludEJFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCksIDApXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB0aGlzW29mZnNldCArIGldID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgtLWkgPj0gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAodmFsdWUgLyBtdWwpICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQ4ID0gZnVuY3Rpb24gd3JpdGVVSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweGZmLCAwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB2YWx1ZSA9IE1hdGguZmxvb3IodmFsdWUpXG4gIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDE2IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDIpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlICYgKDB4ZmYgPDwgKDggKiAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSkpKSA+Pj5cbiAgICAgIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpICogOFxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgJiAweGZmKVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2QkUgPSBmdW5jdGlvbiB3cml0ZVVJbnQxNkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgJiAweGZmKVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDMyIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCA0KTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSA+Pj4gKGxpdHRsZUVuZGlhbiA/IGkgOiAzIC0gaSkgKiA4KSAmIDB4ZmZcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyTEUgPSBmdW5jdGlvbiB3cml0ZVVJbnQzMkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlICYgMHhmZilcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgJiAweGZmKVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRMRSA9IGZ1bmN0aW9uIHdyaXRlSW50TEUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBsaW1pdCA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSlcblxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIGxpbWl0IC0gMSwgLWxpbWl0KVxuICB9XG5cbiAgdmFyIGkgPSAwXG4gIHZhciBtdWwgPSAxXG4gIHZhciBzdWIgPSB2YWx1ZSA8IDAgPyAxIDogMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50QkUgPSBmdW5jdGlvbiB3cml0ZUludEJFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICB2YXIgbGltaXQgPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCAtIDEpXG5cbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBsaW1pdCAtIDEsIC1saW1pdClcbiAgfVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICgodmFsdWUgLyBtdWwpID4+IDApIC0gc3ViICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDggPSBmdW5jdGlvbiB3cml0ZUludDggKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHg3ZiwgLTB4ODApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmICsgdmFsdWUgKyAxXG4gIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVJbnQxNkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4N2ZmZiwgLTB4ODAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlICYgMHhmZilcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2QkUgPSBmdW5jdGlvbiB3cml0ZUludDE2QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEUgPSBmdW5jdGlvbiB3cml0ZUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSAmIDB4ZmYpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkJFID0gZnVuY3Rpb24gd3JpdGVJbnQzMkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgJiAweGZmKVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbmZ1bmN0aW9uIGNoZWNrSUVFRTc1NCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICh2YWx1ZSA+IG1heCB8fCB2YWx1ZSA8IG1pbikgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3ZhbHVlIGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG4gIGlmIChvZmZzZXQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuZnVuY3Rpb24gd3JpdGVGbG9hdCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA0LCAzLjQwMjgyMzQ2NjM4NTI4ODZlKzM4LCAtMy40MDI4MjM0NjYzODUyODg2ZSszOClcbiAgfVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCAyMywgNClcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0TEUgPSBmdW5jdGlvbiB3cml0ZUZsb2F0TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRCRSA9IGZ1bmN0aW9uIHdyaXRlRmxvYXRCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiB3cml0ZURvdWJsZSAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA4LCAxLjc5NzY5MzEzNDg2MjMxNTdFKzMwOCwgLTEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4KVxuICB9XG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDUyLCA4KVxuICByZXR1cm4gb2Zmc2V0ICsgOFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlTEUgPSBmdW5jdGlvbiB3cml0ZURvdWJsZUxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVCRSA9IGZ1bmN0aW9uIHdyaXRlRG91YmxlQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbi8vIGNvcHkodGFyZ2V0QnVmZmVyLCB0YXJnZXRTdGFydD0wLCBzb3VyY2VTdGFydD0wLCBzb3VyY2VFbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uIGNvcHkgKHRhcmdldCwgdGFyZ2V0U3RhcnQsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCFzdGFydCkgc3RhcnQgPSAwXG4gIGlmICghZW5kICYmIGVuZCAhPT0gMCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldFN0YXJ0ID49IHRhcmdldC5sZW5ndGgpIHRhcmdldFN0YXJ0ID0gdGFyZ2V0Lmxlbmd0aFxuICBpZiAoIXRhcmdldFN0YXJ0KSB0YXJnZXRTdGFydCA9IDBcbiAgaWYgKGVuZCA+IDAgJiYgZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgLy8gQ29weSAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm4gMFxuICBpZiAodGFyZ2V0Lmxlbmd0aCA9PT0gMCB8fCB0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBGYXRhbCBlcnJvciBjb25kaXRpb25zXG4gIGlmICh0YXJnZXRTdGFydCA8IDApIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndGFyZ2V0U3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIH1cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3NvdXJjZVN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoZW5kIDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3NvdXJjZUVuZCBvdXQgb2YgYm91bmRzJylcblxuICAvLyBBcmUgd2Ugb29iP1xuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0U3RhcnQgPCBlbmQgLSBzdGFydCkge1xuICAgIGVuZCA9IHRhcmdldC5sZW5ndGggLSB0YXJnZXRTdGFydCArIHN0YXJ0XG4gIH1cblxuICB2YXIgbGVuID0gZW5kIC0gc3RhcnRcbiAgdmFyIGlcblxuICBpZiAodGhpcyA9PT0gdGFyZ2V0ICYmIHN0YXJ0IDwgdGFyZ2V0U3RhcnQgJiYgdGFyZ2V0U3RhcnQgPCBlbmQpIHtcbiAgICAvLyBkZXNjZW5kaW5nIGNvcHkgZnJvbSBlbmRcbiAgICBmb3IgKGkgPSBsZW4gLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgdGFyZ2V0W2kgKyB0YXJnZXRTdGFydF0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH0gZWxzZSBpZiAobGVuIDwgMTAwMCB8fCAhQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAvLyBhc2NlbmRpbmcgY29weSBmcm9tIHN0YXJ0XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB0YXJnZXRbaSArIHRhcmdldFN0YXJ0XSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0YXJnZXQuX3NldCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBzdGFydCArIGxlbiksIHRhcmdldFN0YXJ0KVxuICB9XG5cbiAgcmV0dXJuIGxlblxufVxuXG4vLyBmaWxsKHZhbHVlLCBzdGFydD0wLCBlbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuZmlsbCA9IGZ1bmN0aW9uIGZpbGwgKHZhbHVlLCBzdGFydCwgZW5kKSB7XG4gIGlmICghdmFsdWUpIHZhbHVlID0gMFxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQpIGVuZCA9IHRoaXMubGVuZ3RoXG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIDwgc3RhcnQnKVxuXG4gIC8vIEZpbGwgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuXG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3N0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoZW5kIDwgMCB8fCBlbmQgPiB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2VuZCBvdXQgb2YgYm91bmRzJylcblxuICB2YXIgaVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykge1xuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSB2YWx1ZVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB2YXIgYnl0ZXMgPSB1dGY4VG9CeXRlcyh2YWx1ZS50b1N0cmluZygpKVxuICAgIHZhciBsZW4gPSBieXRlcy5sZW5ndGhcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICB0aGlzW2ldID0gYnl0ZXNbaSAlIGxlbl1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpc1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgYEFycmF5QnVmZmVyYCB3aXRoIHRoZSAqY29waWVkKiBtZW1vcnkgb2YgdGhlIGJ1ZmZlciBpbnN0YW5jZS5cbiAqIEFkZGVkIGluIE5vZGUgMC4xMi4gT25seSBhdmFpbGFibGUgaW4gYnJvd3NlcnMgdGhhdCBzdXBwb3J0IEFycmF5QnVmZmVyLlxuICovXG5CdWZmZXIucHJvdG90eXBlLnRvQXJyYXlCdWZmZXIgPSBmdW5jdGlvbiB0b0FycmF5QnVmZmVyICgpIHtcbiAgaWYgKHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJykge1xuICAgIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgICAgcmV0dXJuIChuZXcgQnVmZmVyKHRoaXMpKS5idWZmZXJcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGJ1ZiA9IG5ldyBVaW50OEFycmF5KHRoaXMubGVuZ3RoKVxuICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGJ1Zi5sZW5ndGg7IGkgPCBsZW47IGkgKz0gMSkge1xuICAgICAgICBidWZbaV0gPSB0aGlzW2ldXG4gICAgICB9XG4gICAgICByZXR1cm4gYnVmLmJ1ZmZlclxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdCdWZmZXIudG9BcnJheUJ1ZmZlciBub3Qgc3VwcG9ydGVkIGluIHRoaXMgYnJvd3NlcicpXG4gIH1cbn1cblxuLy8gSEVMUEVSIEZVTkNUSU9OU1xuLy8gPT09PT09PT09PT09PT09PVxuXG52YXIgQlAgPSBCdWZmZXIucHJvdG90eXBlXG5cbi8qKlxuICogQXVnbWVudCBhIFVpbnQ4QXJyYXkgKmluc3RhbmNlKiAobm90IHRoZSBVaW50OEFycmF5IGNsYXNzISkgd2l0aCBCdWZmZXIgbWV0aG9kc1xuICovXG5CdWZmZXIuX2F1Z21lbnQgPSBmdW5jdGlvbiBfYXVnbWVudCAoYXJyKSB7XG4gIGFyci5jb25zdHJ1Y3RvciA9IEJ1ZmZlclxuICBhcnIuX2lzQnVmZmVyID0gdHJ1ZVxuXG4gIC8vIHNhdmUgcmVmZXJlbmNlIHRvIG9yaWdpbmFsIFVpbnQ4QXJyYXkgc2V0IG1ldGhvZCBiZWZvcmUgb3ZlcndyaXRpbmdcbiAgYXJyLl9zZXQgPSBhcnIuc2V0XG5cbiAgLy8gZGVwcmVjYXRlZFxuICBhcnIuZ2V0ID0gQlAuZ2V0XG4gIGFyci5zZXQgPSBCUC5zZXRcblxuICBhcnIud3JpdGUgPSBCUC53cml0ZVxuICBhcnIudG9TdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9Mb2NhbGVTdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9KU09OID0gQlAudG9KU09OXG4gIGFyci5lcXVhbHMgPSBCUC5lcXVhbHNcbiAgYXJyLmNvbXBhcmUgPSBCUC5jb21wYXJlXG4gIGFyci5pbmRleE9mID0gQlAuaW5kZXhPZlxuICBhcnIuY29weSA9IEJQLmNvcHlcbiAgYXJyLnNsaWNlID0gQlAuc2xpY2VcbiAgYXJyLnJlYWRVSW50TEUgPSBCUC5yZWFkVUludExFXG4gIGFyci5yZWFkVUludEJFID0gQlAucmVhZFVJbnRCRVxuICBhcnIucmVhZFVJbnQ4ID0gQlAucmVhZFVJbnQ4XG4gIGFyci5yZWFkVUludDE2TEUgPSBCUC5yZWFkVUludDE2TEVcbiAgYXJyLnJlYWRVSW50MTZCRSA9IEJQLnJlYWRVSW50MTZCRVxuICBhcnIucmVhZFVJbnQzMkxFID0gQlAucmVhZFVJbnQzMkxFXG4gIGFyci5yZWFkVUludDMyQkUgPSBCUC5yZWFkVUludDMyQkVcbiAgYXJyLnJlYWRJbnRMRSA9IEJQLnJlYWRJbnRMRVxuICBhcnIucmVhZEludEJFID0gQlAucmVhZEludEJFXG4gIGFyci5yZWFkSW50OCA9IEJQLnJlYWRJbnQ4XG4gIGFyci5yZWFkSW50MTZMRSA9IEJQLnJlYWRJbnQxNkxFXG4gIGFyci5yZWFkSW50MTZCRSA9IEJQLnJlYWRJbnQxNkJFXG4gIGFyci5yZWFkSW50MzJMRSA9IEJQLnJlYWRJbnQzMkxFXG4gIGFyci5yZWFkSW50MzJCRSA9IEJQLnJlYWRJbnQzMkJFXG4gIGFyci5yZWFkRmxvYXRMRSA9IEJQLnJlYWRGbG9hdExFXG4gIGFyci5yZWFkRmxvYXRCRSA9IEJQLnJlYWRGbG9hdEJFXG4gIGFyci5yZWFkRG91YmxlTEUgPSBCUC5yZWFkRG91YmxlTEVcbiAgYXJyLnJlYWREb3VibGVCRSA9IEJQLnJlYWREb3VibGVCRVxuICBhcnIud3JpdGVVSW50OCA9IEJQLndyaXRlVUludDhcbiAgYXJyLndyaXRlVUludExFID0gQlAud3JpdGVVSW50TEVcbiAgYXJyLndyaXRlVUludEJFID0gQlAud3JpdGVVSW50QkVcbiAgYXJyLndyaXRlVUludDE2TEUgPSBCUC53cml0ZVVJbnQxNkxFXG4gIGFyci53cml0ZVVJbnQxNkJFID0gQlAud3JpdGVVSW50MTZCRVxuICBhcnIud3JpdGVVSW50MzJMRSA9IEJQLndyaXRlVUludDMyTEVcbiAgYXJyLndyaXRlVUludDMyQkUgPSBCUC53cml0ZVVJbnQzMkJFXG4gIGFyci53cml0ZUludExFID0gQlAud3JpdGVJbnRMRVxuICBhcnIud3JpdGVJbnRCRSA9IEJQLndyaXRlSW50QkVcbiAgYXJyLndyaXRlSW50OCA9IEJQLndyaXRlSW50OFxuICBhcnIud3JpdGVJbnQxNkxFID0gQlAud3JpdGVJbnQxNkxFXG4gIGFyci53cml0ZUludDE2QkUgPSBCUC53cml0ZUludDE2QkVcbiAgYXJyLndyaXRlSW50MzJMRSA9IEJQLndyaXRlSW50MzJMRVxuICBhcnIud3JpdGVJbnQzMkJFID0gQlAud3JpdGVJbnQzMkJFXG4gIGFyci53cml0ZUZsb2F0TEUgPSBCUC53cml0ZUZsb2F0TEVcbiAgYXJyLndyaXRlRmxvYXRCRSA9IEJQLndyaXRlRmxvYXRCRVxuICBhcnIud3JpdGVEb3VibGVMRSA9IEJQLndyaXRlRG91YmxlTEVcbiAgYXJyLndyaXRlRG91YmxlQkUgPSBCUC53cml0ZURvdWJsZUJFXG4gIGFyci5maWxsID0gQlAuZmlsbFxuICBhcnIuaW5zcGVjdCA9IEJQLmluc3BlY3RcbiAgYXJyLnRvQXJyYXlCdWZmZXIgPSBCUC50b0FycmF5QnVmZmVyXG5cbiAgcmV0dXJuIGFyclxufVxuXG52YXIgSU5WQUxJRF9CQVNFNjRfUkUgPSAvW14rXFwvMC05QS1aYS16LV9dL2dcblxuZnVuY3Rpb24gYmFzZTY0Y2xlYW4gKHN0cikge1xuICAvLyBOb2RlIHN0cmlwcyBvdXQgaW52YWxpZCBjaGFyYWN0ZXJzIGxpa2UgXFxuIGFuZCBcXHQgZnJvbSB0aGUgc3RyaW5nLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgc3RyID0gc3RyaW5ndHJpbShzdHIpLnJlcGxhY2UoSU5WQUxJRF9CQVNFNjRfUkUsICcnKVxuICAvLyBOb2RlIGNvbnZlcnRzIHN0cmluZ3Mgd2l0aCBsZW5ndGggPCAyIHRvICcnXG4gIGlmIChzdHIubGVuZ3RoIDwgMikgcmV0dXJuICcnXG4gIC8vIE5vZGUgYWxsb3dzIGZvciBub24tcGFkZGVkIGJhc2U2NCBzdHJpbmdzIChtaXNzaW5nIHRyYWlsaW5nID09PSksIGJhc2U2NC1qcyBkb2VzIG5vdFxuICB3aGlsZSAoc3RyLmxlbmd0aCAlIDQgIT09IDApIHtcbiAgICBzdHIgPSBzdHIgKyAnPSdcbiAgfVxuICByZXR1cm4gc3RyXG59XG5cbmZ1bmN0aW9uIHN0cmluZ3RyaW0gKHN0cikge1xuICBpZiAoc3RyLnRyaW0pIHJldHVybiBzdHIudHJpbSgpXG4gIHJldHVybiBzdHIucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpXG59XG5cbmZ1bmN0aW9uIHRvSGV4IChuKSB7XG4gIGlmIChuIDwgMTYpIHJldHVybiAnMCcgKyBuLnRvU3RyaW5nKDE2KVxuICByZXR1cm4gbi50b1N0cmluZygxNilcbn1cblxuZnVuY3Rpb24gdXRmOFRvQnl0ZXMgKHN0cmluZywgdW5pdHMpIHtcbiAgdW5pdHMgPSB1bml0cyB8fCBJbmZpbml0eVxuICB2YXIgY29kZVBvaW50XG4gIHZhciBsZW5ndGggPSBzdHJpbmcubGVuZ3RoXG4gIHZhciBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICB2YXIgYnl0ZXMgPSBbXVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBjb2RlUG9pbnQgPSBzdHJpbmcuY2hhckNvZGVBdChpKVxuXG4gICAgLy8gaXMgc3Vycm9nYXRlIGNvbXBvbmVudFxuICAgIGlmIChjb2RlUG9pbnQgPiAweEQ3RkYgJiYgY29kZVBvaW50IDwgMHhFMDAwKSB7XG4gICAgICAvLyBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKCFsZWFkU3Vycm9nYXRlKSB7XG4gICAgICAgIC8vIG5vIGxlYWQgeWV0XG4gICAgICAgIGlmIChjb2RlUG9pbnQgPiAweERCRkYpIHtcbiAgICAgICAgICAvLyB1bmV4cGVjdGVkIHRyYWlsXG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIGlmIChpICsgMSA9PT0gbGVuZ3RoKSB7XG4gICAgICAgICAgLy8gdW5wYWlyZWQgbGVhZFxuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICAvLyB2YWxpZCBsZWFkXG4gICAgICAgIGxlYWRTdXJyb2dhdGUgPSBjb2RlUG9pbnRcblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICAvLyAyIGxlYWRzIGluIGEgcm93XG4gICAgICBpZiAoY29kZVBvaW50IDwgMHhEQzAwKSB7XG4gICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8vIHZhbGlkIHN1cnJvZ2F0ZSBwYWlyXG4gICAgICBjb2RlUG9pbnQgPSBsZWFkU3Vycm9nYXRlIC0gMHhEODAwIDw8IDEwIHwgY29kZVBvaW50IC0gMHhEQzAwIHwgMHgxMDAwMFxuICAgIH0gZWxzZSBpZiAobGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgLy8gdmFsaWQgYm1wIGNoYXIsIGJ1dCBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgfVxuXG4gICAgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcblxuICAgIC8vIGVuY29kZSB1dGY4XG4gICAgaWYgKGNvZGVQb2ludCA8IDB4ODApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMSkgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChjb2RlUG9pbnQpXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDgwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2IHwgMHhDMCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MTAwMDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyB8IDB4RTAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MTEwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDQpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDEyIHwgMHhGMCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBjb2RlIHBvaW50JylcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYnl0ZXNcbn1cblxuZnVuY3Rpb24gYXNjaWlUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgLy8gTm9kZSdzIGNvZGUgc2VlbXMgdG8gYmUgZG9pbmcgdGhpcyBhbmQgbm90ICYgMHg3Ri4uXG4gICAgYnl0ZUFycmF5LnB1c2goc3RyLmNoYXJDb2RlQXQoaSkgJiAweEZGKVxuICB9XG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVRvQnl0ZXMgKHN0ciwgdW5pdHMpIHtcbiAgdmFyIGMsIGhpLCBsb1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoKHVuaXRzIC09IDIpIDwgMCkgYnJlYWtcblxuICAgIGMgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGhpID0gYyA+PiA4XG4gICAgbG8gPSBjICUgMjU2XG4gICAgYnl0ZUFycmF5LnB1c2gobG8pXG4gICAgYnl0ZUFycmF5LnB1c2goaGkpXG4gIH1cblxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMgKHN0cikge1xuICByZXR1cm4gYmFzZTY0LnRvQnl0ZUFycmF5KGJhc2U2NGNsZWFuKHN0cikpXG59XG5cbmZ1bmN0aW9uIGJsaXRCdWZmZXIgKHNyYywgZHN0LCBvZmZzZXQsIGxlbmd0aCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKChpICsgb2Zmc2V0ID49IGRzdC5sZW5ndGgpIHx8IChpID49IHNyYy5sZW5ndGgpKSBicmVha1xuICAgIGRzdFtpICsgb2Zmc2V0XSA9IHNyY1tpXVxuICB9XG4gIHJldHVybiBpXG59XG4iLCJ2YXIgbG9va3VwID0gJ0FCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky8nO1xuXG47KGZ1bmN0aW9uIChleHBvcnRzKSB7XG5cdCd1c2Ugc3RyaWN0JztcblxuICB2YXIgQXJyID0gKHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJylcbiAgICA/IFVpbnQ4QXJyYXlcbiAgICA6IEFycmF5XG5cblx0dmFyIFBMVVMgICA9ICcrJy5jaGFyQ29kZUF0KDApXG5cdHZhciBTTEFTSCAgPSAnLycuY2hhckNvZGVBdCgwKVxuXHR2YXIgTlVNQkVSID0gJzAnLmNoYXJDb2RlQXQoMClcblx0dmFyIExPV0VSICA9ICdhJy5jaGFyQ29kZUF0KDApXG5cdHZhciBVUFBFUiAgPSAnQScuY2hhckNvZGVBdCgwKVxuXHR2YXIgUExVU19VUkxfU0FGRSA9ICctJy5jaGFyQ29kZUF0KDApXG5cdHZhciBTTEFTSF9VUkxfU0FGRSA9ICdfJy5jaGFyQ29kZUF0KDApXG5cblx0ZnVuY3Rpb24gZGVjb2RlIChlbHQpIHtcblx0XHR2YXIgY29kZSA9IGVsdC5jaGFyQ29kZUF0KDApXG5cdFx0aWYgKGNvZGUgPT09IFBMVVMgfHxcblx0XHQgICAgY29kZSA9PT0gUExVU19VUkxfU0FGRSlcblx0XHRcdHJldHVybiA2MiAvLyAnKydcblx0XHRpZiAoY29kZSA9PT0gU0xBU0ggfHxcblx0XHQgICAgY29kZSA9PT0gU0xBU0hfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjMgLy8gJy8nXG5cdFx0aWYgKGNvZGUgPCBOVU1CRVIpXG5cdFx0XHRyZXR1cm4gLTEgLy9ubyBtYXRjaFxuXHRcdGlmIChjb2RlIDwgTlVNQkVSICsgMTApXG5cdFx0XHRyZXR1cm4gY29kZSAtIE5VTUJFUiArIDI2ICsgMjZcblx0XHRpZiAoY29kZSA8IFVQUEVSICsgMjYpXG5cdFx0XHRyZXR1cm4gY29kZSAtIFVQUEVSXG5cdFx0aWYgKGNvZGUgPCBMT1dFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBMT1dFUiArIDI2XG5cdH1cblxuXHRmdW5jdGlvbiBiNjRUb0J5dGVBcnJheSAoYjY0KSB7XG5cdFx0dmFyIGksIGosIGwsIHRtcCwgcGxhY2VIb2xkZXJzLCBhcnJcblxuXHRcdGlmIChiNjQubGVuZ3RoICUgNCA+IDApIHtcblx0XHRcdHRocm93IG5ldyBFcnJvcignSW52YWxpZCBzdHJpbmcuIExlbmd0aCBtdXN0IGJlIGEgbXVsdGlwbGUgb2YgNCcpXG5cdFx0fVxuXG5cdFx0Ly8gdGhlIG51bWJlciBvZiBlcXVhbCBzaWducyAocGxhY2UgaG9sZGVycylcblx0XHQvLyBpZiB0aGVyZSBhcmUgdHdvIHBsYWNlaG9sZGVycywgdGhhbiB0aGUgdHdvIGNoYXJhY3RlcnMgYmVmb3JlIGl0XG5cdFx0Ly8gcmVwcmVzZW50IG9uZSBieXRlXG5cdFx0Ly8gaWYgdGhlcmUgaXMgb25seSBvbmUsIHRoZW4gdGhlIHRocmVlIGNoYXJhY3RlcnMgYmVmb3JlIGl0IHJlcHJlc2VudCAyIGJ5dGVzXG5cdFx0Ly8gdGhpcyBpcyBqdXN0IGEgY2hlYXAgaGFjayB0byBub3QgZG8gaW5kZXhPZiB0d2ljZVxuXHRcdHZhciBsZW4gPSBiNjQubGVuZ3RoXG5cdFx0cGxhY2VIb2xkZXJzID0gJz0nID09PSBiNjQuY2hhckF0KGxlbiAtIDIpID8gMiA6ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAxKSA/IDEgOiAwXG5cblx0XHQvLyBiYXNlNjQgaXMgNC8zICsgdXAgdG8gdHdvIGNoYXJhY3RlcnMgb2YgdGhlIG9yaWdpbmFsIGRhdGFcblx0XHRhcnIgPSBuZXcgQXJyKGI2NC5sZW5ndGggKiAzIC8gNCAtIHBsYWNlSG9sZGVycylcblxuXHRcdC8vIGlmIHRoZXJlIGFyZSBwbGFjZWhvbGRlcnMsIG9ubHkgZ2V0IHVwIHRvIHRoZSBsYXN0IGNvbXBsZXRlIDQgY2hhcnNcblx0XHRsID0gcGxhY2VIb2xkZXJzID4gMCA/IGI2NC5sZW5ndGggLSA0IDogYjY0Lmxlbmd0aFxuXG5cdFx0dmFyIEwgPSAwXG5cblx0XHRmdW5jdGlvbiBwdXNoICh2KSB7XG5cdFx0XHRhcnJbTCsrXSA9IHZcblx0XHR9XG5cblx0XHRmb3IgKGkgPSAwLCBqID0gMDsgaSA8IGw7IGkgKz0gNCwgaiArPSAzKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDE4KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpIDw8IDEyKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpIDw8IDYpIHwgZGVjb2RlKGI2NC5jaGFyQXQoaSArIDMpKVxuXHRcdFx0cHVzaCgodG1wICYgMHhGRjAwMDApID4+IDE2KVxuXHRcdFx0cHVzaCgodG1wICYgMHhGRjAwKSA+PiA4KVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdGlmIChwbGFjZUhvbGRlcnMgPT09IDIpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA+PiA0KVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH0gZWxzZSBpZiAocGxhY2VIb2xkZXJzID09PSAxKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDEwKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpIDw8IDQpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAyKSkgPj4gMilcblx0XHRcdHB1c2goKHRtcCA+PiA4KSAmIDB4RkYpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fVxuXG5cdFx0cmV0dXJuIGFyclxuXHR9XG5cblx0ZnVuY3Rpb24gdWludDhUb0Jhc2U2NCAodWludDgpIHtcblx0XHR2YXIgaSxcblx0XHRcdGV4dHJhQnl0ZXMgPSB1aW50OC5sZW5ndGggJSAzLCAvLyBpZiB3ZSBoYXZlIDEgYnl0ZSBsZWZ0LCBwYWQgMiBieXRlc1xuXHRcdFx0b3V0cHV0ID0gXCJcIixcblx0XHRcdHRlbXAsIGxlbmd0aFxuXG5cdFx0ZnVuY3Rpb24gZW5jb2RlIChudW0pIHtcblx0XHRcdHJldHVybiBsb29rdXAuY2hhckF0KG51bSlcblx0XHR9XG5cblx0XHRmdW5jdGlvbiB0cmlwbGV0VG9CYXNlNjQgKG51bSkge1xuXHRcdFx0cmV0dXJuIGVuY29kZShudW0gPj4gMTggJiAweDNGKSArIGVuY29kZShudW0gPj4gMTIgJiAweDNGKSArIGVuY29kZShudW0gPj4gNiAmIDB4M0YpICsgZW5jb2RlKG51bSAmIDB4M0YpXG5cdFx0fVxuXG5cdFx0Ly8gZ28gdGhyb3VnaCB0aGUgYXJyYXkgZXZlcnkgdGhyZWUgYnl0ZXMsIHdlJ2xsIGRlYWwgd2l0aCB0cmFpbGluZyBzdHVmZiBsYXRlclxuXHRcdGZvciAoaSA9IDAsIGxlbmd0aCA9IHVpbnQ4Lmxlbmd0aCAtIGV4dHJhQnl0ZXM7IGkgPCBsZW5ndGg7IGkgKz0gMykge1xuXHRcdFx0dGVtcCA9ICh1aW50OFtpXSA8PCAxNikgKyAodWludDhbaSArIDFdIDw8IDgpICsgKHVpbnQ4W2kgKyAyXSlcblx0XHRcdG91dHB1dCArPSB0cmlwbGV0VG9CYXNlNjQodGVtcClcblx0XHR9XG5cblx0XHQvLyBwYWQgdGhlIGVuZCB3aXRoIHplcm9zLCBidXQgbWFrZSBzdXJlIHRvIG5vdCBmb3JnZXQgdGhlIGV4dHJhIGJ5dGVzXG5cdFx0c3dpdGNoIChleHRyYUJ5dGVzKSB7XG5cdFx0XHRjYXNlIDE6XG5cdFx0XHRcdHRlbXAgPSB1aW50OFt1aW50OC5sZW5ndGggLSAxXVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMilcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA8PCA0KSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSAnPT0nXG5cdFx0XHRcdGJyZWFrXG5cdFx0XHRjYXNlIDI6XG5cdFx0XHRcdHRlbXAgPSAodWludDhbdWludDgubGVuZ3RoIC0gMl0gPDwgOCkgKyAodWludDhbdWludDgubGVuZ3RoIC0gMV0pXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUodGVtcCA+PiAxMClcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA+PiA0KSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgMikgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz0nXG5cdFx0XHRcdGJyZWFrXG5cdFx0fVxuXG5cdFx0cmV0dXJuIG91dHB1dFxuXHR9XG5cblx0ZXhwb3J0cy50b0J5dGVBcnJheSA9IGI2NFRvQnl0ZUFycmF5XG5cdGV4cG9ydHMuZnJvbUJ5dGVBcnJheSA9IHVpbnQ4VG9CYXNlNjRcbn0odHlwZW9mIGV4cG9ydHMgPT09ICd1bmRlZmluZWQnID8gKHRoaXMuYmFzZTY0anMgPSB7fSkgOiBleHBvcnRzKSlcbiIsImV4cG9ydHMucmVhZCA9IGZ1bmN0aW9uIChidWZmZXIsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtXG4gIHZhciBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxXG4gIHZhciBlTWF4ID0gKDEgPDwgZUxlbikgLSAxXG4gIHZhciBlQmlhcyA9IGVNYXggPj4gMVxuICB2YXIgbkJpdHMgPSAtN1xuICB2YXIgaSA9IGlzTEUgPyAobkJ5dGVzIC0gMSkgOiAwXG4gIHZhciBkID0gaXNMRSA/IC0xIDogMVxuICB2YXIgcyA9IGJ1ZmZlcltvZmZzZXQgKyBpXVxuXG4gIGkgKz0gZFxuXG4gIGUgPSBzICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpXG4gIHMgPj49ICgtbkJpdHMpXG4gIG5CaXRzICs9IGVMZW5cbiAgZm9yICg7IG5CaXRzID4gMDsgZSA9IGUgKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCkge31cblxuICBtID0gZSAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBlID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBtTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IG0gPSBtICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpIHt9XG5cbiAgaWYgKGUgPT09IDApIHtcbiAgICBlID0gMSAtIGVCaWFzXG4gIH0gZWxzZSBpZiAoZSA9PT0gZU1heCkge1xuICAgIHJldHVybiBtID8gTmFOIDogKChzID8gLTEgOiAxKSAqIEluZmluaXR5KVxuICB9IGVsc2Uge1xuICAgIG0gPSBtICsgTWF0aC5wb3coMiwgbUxlbilcbiAgICBlID0gZSAtIGVCaWFzXG4gIH1cbiAgcmV0dXJuIChzID8gLTEgOiAxKSAqIG0gKiBNYXRoLnBvdygyLCBlIC0gbUxlbilcbn1cblxuZXhwb3J0cy53cml0ZSA9IGZ1bmN0aW9uIChidWZmZXIsIHZhbHVlLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbSwgY1xuICB2YXIgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIHJ0ID0gKG1MZW4gPT09IDIzID8gTWF0aC5wb3coMiwgLTI0KSAtIE1hdGgucG93KDIsIC03NykgOiAwKVxuICB2YXIgaSA9IGlzTEUgPyAwIDogKG5CeXRlcyAtIDEpXG4gIHZhciBkID0gaXNMRSA/IDEgOiAtMVxuICB2YXIgcyA9IHZhbHVlIDwgMCB8fCAodmFsdWUgPT09IDAgJiYgMSAvIHZhbHVlIDwgMCkgPyAxIDogMFxuXG4gIHZhbHVlID0gTWF0aC5hYnModmFsdWUpXG5cbiAgaWYgKGlzTmFOKHZhbHVlKSB8fCB2YWx1ZSA9PT0gSW5maW5pdHkpIHtcbiAgICBtID0gaXNOYU4odmFsdWUpID8gMSA6IDBcbiAgICBlID0gZU1heFxuICB9IGVsc2Uge1xuICAgIGUgPSBNYXRoLmZsb29yKE1hdGgubG9nKHZhbHVlKSAvIE1hdGguTE4yKVxuICAgIGlmICh2YWx1ZSAqIChjID0gTWF0aC5wb3coMiwgLWUpKSA8IDEpIHtcbiAgICAgIGUtLVxuICAgICAgYyAqPSAyXG4gICAgfVxuICAgIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgdmFsdWUgKz0gcnQgLyBjXG4gICAgfSBlbHNlIHtcbiAgICAgIHZhbHVlICs9IHJ0ICogTWF0aC5wb3coMiwgMSAtIGVCaWFzKVxuICAgIH1cbiAgICBpZiAodmFsdWUgKiBjID49IDIpIHtcbiAgICAgIGUrK1xuICAgICAgYyAvPSAyXG4gICAgfVxuXG4gICAgaWYgKGUgKyBlQmlhcyA+PSBlTWF4KSB7XG4gICAgICBtID0gMFxuICAgICAgZSA9IGVNYXhcbiAgICB9IGVsc2UgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICBtID0gKHZhbHVlICogYyAtIDEpICogTWF0aC5wb3coMiwgbUxlbilcbiAgICAgIGUgPSBlICsgZUJpYXNcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IHZhbHVlICogTWF0aC5wb3coMiwgZUJpYXMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gMFxuICAgIH1cbiAgfVxuXG4gIGZvciAoOyBtTGVuID49IDg7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IG0gJiAweGZmLCBpICs9IGQsIG0gLz0gMjU2LCBtTGVuIC09IDgpIHt9XG5cbiAgZSA9IChlIDw8IG1MZW4pIHwgbVxuICBlTGVuICs9IG1MZW5cbiAgZm9yICg7IGVMZW4gPiAwOyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBlICYgMHhmZiwgaSArPSBkLCBlIC89IDI1NiwgZUxlbiAtPSA4KSB7fVxuXG4gIGJ1ZmZlcltvZmZzZXQgKyBpIC0gZF0gfD0gcyAqIDEyOFxufVxuIiwiXG4vKipcbiAqIGlzQXJyYXlcbiAqL1xuXG52YXIgaXNBcnJheSA9IEFycmF5LmlzQXJyYXk7XG5cbi8qKlxuICogdG9TdHJpbmdcbiAqL1xuXG52YXIgc3RyID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZztcblxuLyoqXG4gKiBXaGV0aGVyIG9yIG5vdCB0aGUgZ2l2ZW4gYHZhbGBcbiAqIGlzIGFuIGFycmF5LlxuICpcbiAqIGV4YW1wbGU6XG4gKlxuICogICAgICAgIGlzQXJyYXkoW10pO1xuICogICAgICAgIC8vID4gdHJ1ZVxuICogICAgICAgIGlzQXJyYXkoYXJndW1lbnRzKTtcbiAqICAgICAgICAvLyA+IGZhbHNlXG4gKiAgICAgICAgaXNBcnJheSgnJyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICpcbiAqIEBwYXJhbSB7bWl4ZWR9IHZhbFxuICogQHJldHVybiB7Ym9vbH1cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGlzQXJyYXkgfHwgZnVuY3Rpb24gKHZhbCkge1xuICByZXR1cm4gISEgdmFsICYmICdbb2JqZWN0IEFycmF5XScgPT0gc3RyLmNhbGwodmFsKTtcbn07XG4iLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuZnVuY3Rpb24gRXZlbnRFbWl0dGVyKCkge1xuICB0aGlzLl9ldmVudHMgPSB0aGlzLl9ldmVudHMgfHwge307XG4gIHRoaXMuX21heExpc3RlbmVycyA9IHRoaXMuX21heExpc3RlbmVycyB8fCB1bmRlZmluZWQ7XG59XG5tb2R1bGUuZXhwb3J0cyA9IEV2ZW50RW1pdHRlcjtcblxuLy8gQmFja3dhcmRzLWNvbXBhdCB3aXRoIG5vZGUgMC4xMC54XG5FdmVudEVtaXR0ZXIuRXZlbnRFbWl0dGVyID0gRXZlbnRFbWl0dGVyO1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLl9ldmVudHMgPSB1bmRlZmluZWQ7XG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLl9tYXhMaXN0ZW5lcnMgPSB1bmRlZmluZWQ7XG5cbi8vIEJ5IGRlZmF1bHQgRXZlbnRFbWl0dGVycyB3aWxsIHByaW50IGEgd2FybmluZyBpZiBtb3JlIHRoYW4gMTAgbGlzdGVuZXJzIGFyZVxuLy8gYWRkZWQgdG8gaXQuIFRoaXMgaXMgYSB1c2VmdWwgZGVmYXVsdCB3aGljaCBoZWxwcyBmaW5kaW5nIG1lbW9yeSBsZWFrcy5cbkV2ZW50RW1pdHRlci5kZWZhdWx0TWF4TGlzdGVuZXJzID0gMTA7XG5cbi8vIE9idmlvdXNseSBub3QgYWxsIEVtaXR0ZXJzIHNob3VsZCBiZSBsaW1pdGVkIHRvIDEwLiBUaGlzIGZ1bmN0aW9uIGFsbG93c1xuLy8gdGhhdCB0byBiZSBpbmNyZWFzZWQuIFNldCB0byB6ZXJvIGZvciB1bmxpbWl0ZWQuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnNldE1heExpc3RlbmVycyA9IGZ1bmN0aW9uKG4pIHtcbiAgaWYgKCFpc051bWJlcihuKSB8fCBuIDwgMCB8fCBpc05hTihuKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ24gbXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlcicpO1xuICB0aGlzLl9tYXhMaXN0ZW5lcnMgPSBuO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuZW1pdCA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgdmFyIGVyLCBoYW5kbGVyLCBsZW4sIGFyZ3MsIGksIGxpc3RlbmVycztcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcblxuICAvLyBJZiB0aGVyZSBpcyBubyAnZXJyb3InIGV2ZW50IGxpc3RlbmVyIHRoZW4gdGhyb3cuXG4gIGlmICh0eXBlID09PSAnZXJyb3InKSB7XG4gICAgaWYgKCF0aGlzLl9ldmVudHMuZXJyb3IgfHxcbiAgICAgICAgKGlzT2JqZWN0KHRoaXMuX2V2ZW50cy5lcnJvcikgJiYgIXRoaXMuX2V2ZW50cy5lcnJvci5sZW5ndGgpKSB7XG4gICAgICBlciA9IGFyZ3VtZW50c1sxXTtcbiAgICAgIGlmIChlciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRocm93IGVyOyAvLyBVbmhhbmRsZWQgJ2Vycm9yJyBldmVudFxuICAgICAgfVxuICAgICAgdGhyb3cgVHlwZUVycm9yKCdVbmNhdWdodCwgdW5zcGVjaWZpZWQgXCJlcnJvclwiIGV2ZW50LicpO1xuICAgIH1cbiAgfVxuXG4gIGhhbmRsZXIgPSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgaWYgKGlzVW5kZWZpbmVkKGhhbmRsZXIpKVxuICAgIHJldHVybiBmYWxzZTtcblxuICBpZiAoaXNGdW5jdGlvbihoYW5kbGVyKSkge1xuICAgIHN3aXRjaCAoYXJndW1lbnRzLmxlbmd0aCkge1xuICAgICAgLy8gZmFzdCBjYXNlc1xuICAgICAgY2FzZSAxOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAyOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDM6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzLCBhcmd1bWVudHNbMV0sIGFyZ3VtZW50c1syXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgLy8gc2xvd2VyXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBsZW4gPSBhcmd1bWVudHMubGVuZ3RoO1xuICAgICAgICBhcmdzID0gbmV3IEFycmF5KGxlbiAtIDEpO1xuICAgICAgICBmb3IgKGkgPSAxOyBpIDwgbGVuOyBpKyspXG4gICAgICAgICAgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG4gICAgICAgIGhhbmRsZXIuYXBwbHkodGhpcywgYXJncyk7XG4gICAgfVxuICB9IGVsc2UgaWYgKGlzT2JqZWN0KGhhbmRsZXIpKSB7XG4gICAgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICBhcmdzID0gbmV3IEFycmF5KGxlbiAtIDEpO1xuICAgIGZvciAoaSA9IDE7IGkgPCBsZW47IGkrKylcbiAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuXG4gICAgbGlzdGVuZXJzID0gaGFuZGxlci5zbGljZSgpO1xuICAgIGxlbiA9IGxpc3RlbmVycy5sZW5ndGg7XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbjsgaSsrKVxuICAgICAgbGlzdGVuZXJzW2ldLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICB9XG5cbiAgcmV0dXJuIHRydWU7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmFkZExpc3RlbmVyID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgdmFyIG07XG5cbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzKVxuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuXG4gIC8vIFRvIGF2b2lkIHJlY3Vyc2lvbiBpbiB0aGUgY2FzZSB0aGF0IHR5cGUgPT09IFwibmV3TGlzdGVuZXJcIiEgQmVmb3JlXG4gIC8vIGFkZGluZyBpdCB0byB0aGUgbGlzdGVuZXJzLCBmaXJzdCBlbWl0IFwibmV3TGlzdGVuZXJcIi5cbiAgaWYgKHRoaXMuX2V2ZW50cy5uZXdMaXN0ZW5lcilcbiAgICB0aGlzLmVtaXQoJ25ld0xpc3RlbmVyJywgdHlwZSxcbiAgICAgICAgICAgICAgaXNGdW5jdGlvbihsaXN0ZW5lci5saXN0ZW5lcikgP1xuICAgICAgICAgICAgICBsaXN0ZW5lci5saXN0ZW5lciA6IGxpc3RlbmVyKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICAvLyBPcHRpbWl6ZSB0aGUgY2FzZSBvZiBvbmUgbGlzdGVuZXIuIERvbid0IG5lZWQgdGhlIGV4dHJhIGFycmF5IG9iamVjdC5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0gPSBsaXN0ZW5lcjtcbiAgZWxzZSBpZiAoaXNPYmplY3QodGhpcy5fZXZlbnRzW3R5cGVdKSlcbiAgICAvLyBJZiB3ZSd2ZSBhbHJlYWR5IGdvdCBhbiBhcnJheSwganVzdCBhcHBlbmQuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdLnB1c2gobGlzdGVuZXIpO1xuICBlbHNlXG4gICAgLy8gQWRkaW5nIHRoZSBzZWNvbmQgZWxlbWVudCwgbmVlZCB0byBjaGFuZ2UgdG8gYXJyYXkuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdID0gW3RoaXMuX2V2ZW50c1t0eXBlXSwgbGlzdGVuZXJdO1xuXG4gIC8vIENoZWNrIGZvciBsaXN0ZW5lciBsZWFrXG4gIGlmIChpc09iamVjdCh0aGlzLl9ldmVudHNbdHlwZV0pICYmICF0aGlzLl9ldmVudHNbdHlwZV0ud2FybmVkKSB7XG4gICAgdmFyIG07XG4gICAgaWYgKCFpc1VuZGVmaW5lZCh0aGlzLl9tYXhMaXN0ZW5lcnMpKSB7XG4gICAgICBtID0gdGhpcy5fbWF4TGlzdGVuZXJzO1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gRXZlbnRFbWl0dGVyLmRlZmF1bHRNYXhMaXN0ZW5lcnM7XG4gICAgfVxuXG4gICAgaWYgKG0gJiYgbSA+IDAgJiYgdGhpcy5fZXZlbnRzW3R5cGVdLmxlbmd0aCA+IG0pIHtcbiAgICAgIHRoaXMuX2V2ZW50c1t0eXBlXS53YXJuZWQgPSB0cnVlO1xuICAgICAgY29uc29sZS5lcnJvcignKG5vZGUpIHdhcm5pbmc6IHBvc3NpYmxlIEV2ZW50RW1pdHRlciBtZW1vcnkgJyArXG4gICAgICAgICAgICAgICAgICAgICdsZWFrIGRldGVjdGVkLiAlZCBsaXN0ZW5lcnMgYWRkZWQuICcgK1xuICAgICAgICAgICAgICAgICAgICAnVXNlIGVtaXR0ZXIuc2V0TWF4TGlzdGVuZXJzKCkgdG8gaW5jcmVhc2UgbGltaXQuJyxcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fZXZlbnRzW3R5cGVdLmxlbmd0aCk7XG4gICAgICBpZiAodHlwZW9mIGNvbnNvbGUudHJhY2UgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgLy8gbm90IHN1cHBvcnRlZCBpbiBJRSAxMFxuICAgICAgICBjb25zb2xlLnRyYWNlKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLm9uID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5hZGRMaXN0ZW5lcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIHZhciBmaXJlZCA9IGZhbHNlO1xuXG4gIGZ1bmN0aW9uIGcoKSB7XG4gICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBnKTtcblxuICAgIGlmICghZmlyZWQpIHtcbiAgICAgIGZpcmVkID0gdHJ1ZTtcbiAgICAgIGxpc3RlbmVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfVxuICB9XG5cbiAgZy5saXN0ZW5lciA9IGxpc3RlbmVyO1xuICB0aGlzLm9uKHR5cGUsIGcpO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuLy8gZW1pdHMgYSAncmVtb3ZlTGlzdGVuZXInIGV2ZW50IGlmZiB0aGUgbGlzdGVuZXIgd2FzIHJlbW92ZWRcbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucmVtb3ZlTGlzdGVuZXIgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICB2YXIgbGlzdCwgcG9zaXRpb24sIGxlbmd0aCwgaTtcblxuICBpZiAoIWlzRnVuY3Rpb24obGlzdGVuZXIpKVxuICAgIHRocm93IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMgfHwgIXRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICByZXR1cm4gdGhpcztcblxuICBsaXN0ID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuICBsZW5ndGggPSBsaXN0Lmxlbmd0aDtcbiAgcG9zaXRpb24gPSAtMTtcblxuICBpZiAobGlzdCA9PT0gbGlzdGVuZXIgfHxcbiAgICAgIChpc0Z1bmN0aW9uKGxpc3QubGlzdGVuZXIpICYmIGxpc3QubGlzdGVuZXIgPT09IGxpc3RlbmVyKSkge1xuICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgaWYgKHRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcilcbiAgICAgIHRoaXMuZW1pdCgncmVtb3ZlTGlzdGVuZXInLCB0eXBlLCBsaXN0ZW5lcik7XG5cbiAgfSBlbHNlIGlmIChpc09iamVjdChsaXN0KSkge1xuICAgIGZvciAoaSA9IGxlbmd0aDsgaS0tID4gMDspIHtcbiAgICAgIGlmIChsaXN0W2ldID09PSBsaXN0ZW5lciB8fFxuICAgICAgICAgIChsaXN0W2ldLmxpc3RlbmVyICYmIGxpc3RbaV0ubGlzdGVuZXIgPT09IGxpc3RlbmVyKSkge1xuICAgICAgICBwb3NpdGlvbiA9IGk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwb3NpdGlvbiA8IDApXG4gICAgICByZXR1cm4gdGhpcztcblxuICAgIGlmIChsaXN0Lmxlbmd0aCA9PT0gMSkge1xuICAgICAgbGlzdC5sZW5ndGggPSAwO1xuICAgICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGlzdC5zcGxpY2UocG9zaXRpb24sIDEpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpXG4gICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgbGlzdGVuZXIpO1xuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUFsbExpc3RlbmVycyA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgdmFyIGtleSwgbGlzdGVuZXJzO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzKVxuICAgIHJldHVybiB0aGlzO1xuXG4gIC8vIG5vdCBsaXN0ZW5pbmcgZm9yIHJlbW92ZUxpc3RlbmVyLCBubyBuZWVkIHRvIGVtaXRcbiAgaWYgKCF0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpIHtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMClcbiAgICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuICAgIGVsc2UgaWYgKHRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyBlbWl0IHJlbW92ZUxpc3RlbmVyIGZvciBhbGwgbGlzdGVuZXJzIG9uIGFsbCBldmVudHNcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICBmb3IgKGtleSBpbiB0aGlzLl9ldmVudHMpIHtcbiAgICAgIGlmIChrZXkgPT09ICdyZW1vdmVMaXN0ZW5lcicpIGNvbnRpbnVlO1xuICAgICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoa2V5KTtcbiAgICB9XG4gICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoJ3JlbW92ZUxpc3RlbmVyJyk7XG4gICAgdGhpcy5fZXZlbnRzID0ge307XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBsaXN0ZW5lcnMgPSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgaWYgKGlzRnVuY3Rpb24obGlzdGVuZXJzKSkge1xuICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgbGlzdGVuZXJzKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBMSUZPIG9yZGVyXG4gICAgd2hpbGUgKGxpc3RlbmVycy5sZW5ndGgpXG4gICAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVyc1tsaXN0ZW5lcnMubGVuZ3RoIC0gMV0pO1xuICB9XG4gIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmxpc3RlbmVycyA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgdmFyIHJldDtcbiAgaWYgKCF0aGlzLl9ldmVudHMgfHwgIXRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICByZXQgPSBbXTtcbiAgZWxzZSBpZiAoaXNGdW5jdGlvbih0aGlzLl9ldmVudHNbdHlwZV0pKVxuICAgIHJldCA9IFt0aGlzLl9ldmVudHNbdHlwZV1dO1xuICBlbHNlXG4gICAgcmV0ID0gdGhpcy5fZXZlbnRzW3R5cGVdLnNsaWNlKCk7XG4gIHJldHVybiByZXQ7XG59O1xuXG5FdmVudEVtaXR0ZXIubGlzdGVuZXJDb3VudCA9IGZ1bmN0aW9uKGVtaXR0ZXIsIHR5cGUpIHtcbiAgdmFyIHJldDtcbiAgaWYgKCFlbWl0dGVyLl9ldmVudHMgfHwgIWVtaXR0ZXIuX2V2ZW50c1t0eXBlXSlcbiAgICByZXQgPSAwO1xuICBlbHNlIGlmIChpc0Z1bmN0aW9uKGVtaXR0ZXIuX2V2ZW50c1t0eXBlXSkpXG4gICAgcmV0ID0gMTtcbiAgZWxzZVxuICAgIHJldCA9IGVtaXR0ZXIuX2V2ZW50c1t0eXBlXS5sZW5ndGg7XG4gIHJldHVybiByZXQ7XG59O1xuXG5mdW5jdGlvbiBpc0Z1bmN0aW9uKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ2Z1bmN0aW9uJztcbn1cblxuZnVuY3Rpb24gaXNOdW1iZXIoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnbnVtYmVyJztcbn1cblxuZnVuY3Rpb24gaXNPYmplY3QoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnb2JqZWN0JyAmJiBhcmcgIT09IG51bGw7XG59XG5cbmZ1bmN0aW9uIGlzVW5kZWZpbmVkKGFyZykge1xuICByZXR1cm4gYXJnID09PSB2b2lkIDA7XG59XG4iLCJ2YXIgY3JlYXRlTW9kYWwgPSByZXF1aXJlKCcuLi8nKSxcbiAgICBjcmVsID0gcmVxdWlyZSgnY3JlbCcpO1xuXG53aW5kb3cub25sb2FkID0gZnVuY3Rpb24oKXtcblxuICAgIC8vIENyZWF0ZSBhIG1vZGFsLlxuICAgIHZhciBtb2RhbCA9IGNyZWF0ZU1vZGFsKHtcblxuICAgICAgICBjb250ZW50OiBmdW5jdGlvbihzY29wZSl7XG4gICAgICAgICAgICAvLyBXaGF0IHRvIHJlbmRlciB3aGVuIHRoZSBtb2RhbCBpcyBzaG93bi5cbiAgICAgICAgICAgIC8vIFJldHVybiBhIHN0cmluZywgYSBET00gbm9kZSwgb3IgYSBmYXN0biBjb21wb25lbnQgaGVyZS5cblxuICAgICAgICAgICAgcmV0dXJuIGNyZWwoJ2RpdicsXG4gICAgICAgICAgICAgICAgY3JlbCgnaDEnLCAnSGVsbG8gV29ybGQnKSxcbiAgICAgICAgICAgICAgICAnTXkgY29vbCBtb2RhbCdcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgIH0pO1xuXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChtb2RhbC5lbGVtZW50KTtcblxuICAgIHZhciBidXR0b24gPSBjcmVsKCdidXR0b24nLCAnU2hvdyBtb2RhbCcpO1xuICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGZ1bmN0aW9uKCl7XG4gICAgICAgIG1vZGFsLnNob3codHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGJ1dHRvbik7XG5cbn07IiwidmFyIGZhc3RuID0gcmVxdWlyZSgnZmFzdG4nKSh7XG4gICAgX2dlbmVyaWM6IHJlcXVpcmUoJ2Zhc3RuL2dlbmVyaWNDb21wb25lbnQnKSxcbiAgICBsaXN0OiByZXF1aXJlKCdmYXN0bi9saXN0Q29tcG9uZW50JyksXG4gICAgdGVtcGxhdGVyOiByZXF1aXJlKCdmYXN0bi90ZW1wbGF0ZXJDb21wb25lbnQnKSxcbiAgICB0ZXh0OiByZXF1aXJlKCdmYXN0bi90ZXh0Q29tcG9uZW50JyksXG4gICAgbW9kYWw6IHJlcXVpcmUoJy4vbW9kYWxDb21wb25lbnQnKVxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oc2V0dGluZ3Mpe1xuICAgIHJldHVybiBmYXN0bignbW9kYWwnLCBzZXR0aW5ncykuYXR0YWNoKCkucmVuZGVyKCk7XG59OyIsInZhciBjcmVsID0gcmVxdWlyZSgnY3JlbCcpLFxuICAgIGRvYyA9IHJlcXVpcmUoJ2RvYy1qcycpLFxuICAgIGRlZmF1bHRDc3MgPSByZXF1aXJlKCdkZWZhdWx0Y3NzJyk7XG5cbmRlZmF1bHRDc3MoJ21vZGFsLWNvbXBvbmVudCcsICcubW9kYWwtY29tcG9uZW50e3Bvc2l0aW9uOmZpeGVkO3RvcDowO2JvdHRvbTowO2xlZnQ6MDtyaWdodDowO30ubW9kYWwtY29tcG9uZW50IC5jb250ZW50e2JhY2tncm91bmQ6d2hpdGV9Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZmFzdG4sIGNvbXBvbmVudCwgdHlwZSwgc2V0dGluZ3MsIGNoaWxkcmVuKXtcbiAgICB2YXIgbGFzdFNob3dUaW1lO1xuXG4gICAgY29tcG9uZW50LmV4dGVuZCgnX2dlbmVyaWMnLCBzZXR0aW5ncywgY2hpbGRyZW4pO1xuXG4gICAgY29tcG9uZW50Ll90eXBlID0gJ21vZGFsJztcbiAgICBjb21wb25lbnQuX2F0dGFjaENoaWxkcmVuID0gZmFsc2U7XG4gICAgY29tcG9uZW50LnJlbmRlciA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIGNvbXBvbmVudC5lbGVtZW50ID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJycpO1xuXG4gICAgICAgIGNvbXBvbmVudC5tb2RhbEVsZW1lbnQgPSBjcmVsKCdkaXYnLCB7J2NsYXNzJzonbW9kYWwtY29tcG9uZW50J30sXG4gICAgICAgICAgICBjb21wb25lbnQuY29udGFpbmVyRWxlbWVudCA9IGNvbXBvbmVudC5jb250ZW50RWxlbWVudCA9IGNyZWwoJ2RpdicsIHsnY2xhc3MnOidjb250ZW50J30pXG4gICAgICAgICk7XG5cbiAgICAgICAgY29tcG9uZW50LmVtaXQoJ3JlbmRlcicpO1xuXG4gICAgICAgIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICAgICAgaWYoY29tcG9uZW50LnNob3coKSAmJiAhZG9jKGV2ZW50LnRhcmdldCkuY2xvc2VzdChjb21wb25lbnQuY29udGVudEVsZW1lbnQpKXtcbiAgICAgICAgICAgICAgICBjb21wb25lbnQuc2hvdyhmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBoYW5kbGVyLCB0cnVlKTtcblxuICAgICAgICBjb21wb25lbnQub24oJ2Rlc3Ryb3knLCBmdW5jdGlvbigpe1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcignY2xpY2snLCBoYW5kbGVyLCB0cnVlKTtcbiAgICAgICAgICAgIHVwZGF0ZVNob3coZmFsc2UpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG4gICAgY29tcG9uZW50Ll9pbnNlcnQgPSBmdW5jdGlvbihlbGVtZW50LCBpbmRleCl7XG4gICAgICAgIGlmKCFjb21wb25lbnQuY29udGVudEVsZW1lbnQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoY29tcG9uZW50LmNvbnRlbnRFbGVtZW50LmNoaWxkTm9kZXNbaW5kZXhdID09PSBlbGVtZW50KXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbXBvbmVudC5jb250ZW50RWxlbWVudC5pbnNlcnRCZWZvcmUoZWxlbWVudCwgY29tcG9uZW50LmNvbnRlbnRFbGVtZW50LmNoaWxkTm9kZXNbaW5kZXhdKTtcbiAgICB9O1xuXG4gICAgdmFyIHRpbWVvdXQ7XG4gICAgZnVuY3Rpb24gd2FpdEZvckFuaW1hdGlvbihjYWxsYmFjayl7XG4gICAgICAgIGlmKHRpbWVvdXQpe1xuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQWxsb3cgaGlkZSB0aW1lb3V0IGZvciBhbmltYXRpb25zXG4gICAgICAgIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGNhbGxiYWNrLCBzZXR0aW5ncy5hbmltYXRpb25UaW1lIHx8IDApO1xuICAgIH1cblxuICAgIHZhciBzdGF0ZSA9ICdoaWRkZW4nO1xuICAgIGZ1bmN0aW9uIHNldE1vZGFsU3RhdGUobmV3U3RhdGUpe1xuICAgICAgICBkb2MoY29tcG9uZW50Lm1vZGFsRWxlbWVudCkucmVtb3ZlQ2xhc3Moc3RhdGUpLmFkZENsYXNzKG5ld1N0YXRlKTtcbiAgICAgICAgc3RhdGUgPSBuZXdTdGF0ZTtcbiAgICAgICAgY29tcG9uZW50LmVtaXQoJ3N0YXRlJywgc3RhdGUpO1xuICAgIH1cblxuICAgIHZhciBjb250ZW50Q2hpbGQ7XG5cbiAgICBmdW5jdGlvbiBjbGVhckNvbnRlbnRDaGlsZCgpe1xuICAgICAgICBpZihjb250ZW50Q2hpbGQpe1xuICAgICAgICAgICAgY29tcG9uZW50LnJlbW92ZShjb250ZW50Q2hpbGQpO1xuICAgICAgICAgICAgY29udGVudENoaWxkLmRlc3Ryb3koKTtcbiAgICAgICAgICAgIGNvbnRlbnRDaGlsZCA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVTaG93KHNob3cpe1xuICAgICAgICBpZighY29tcG9uZW50LmVsZW1lbnQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoc2hvdyl7XG4gICAgICAgICAgICBsYXN0U2hvd1RpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgICAgICAgICBjbGVhckNvbnRlbnRDaGlsZCgpO1xuXG4gICAgICAgICAgICBpZihjb21wb25lbnQuX3NldHRpbmdzLmNvbnRlbnQpe1xuICAgICAgICAgICAgICAgIGNvbnRlbnRDaGlsZCA9IGZhc3RuLnRvQ29tcG9uZW50KGNvbXBvbmVudC5fc2V0dGluZ3MuY29udGVudChjb21wb25lbnQuc2NvcGUoKSkpO1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudC5pbnNlcnQoY29udGVudENoaWxkKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoIWNvbXBvbmVudC5tb2RhbEVsZW1lbnQucGFyZW50Tm9kZSl7XG4gICAgICAgICAgICAgICAgY3JlbChkb2N1bWVudC5ib2R5LCBjb21wb25lbnQubW9kYWxFbGVtZW50KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc2V0TW9kYWxTdGF0ZSgnc2hvd2luZycpO1xuXG4gICAgICAgICAgICB3YWl0Rm9yQW5pbWF0aW9uKGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICAgICAgc2V0TW9kYWxTdGF0ZSgnc2hvd24nKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHNldE1vZGFsU3RhdGUoJ2hpZGluZycpO1xuXG4gICAgICAgICAgICB3YWl0Rm9yQW5pbWF0aW9uKGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICAgICAgc2V0TW9kYWxTdGF0ZSgnaGlkZGVuJyk7XG5cbiAgICAgICAgICAgICAgICBpZihjb21wb25lbnQubW9kYWxFbGVtZW50LnBhcmVudE5vZGUpe1xuICAgICAgICAgICAgICAgICAgICBjb21wb25lbnQubW9kYWxFbGVtZW50LnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoY29tcG9uZW50Lm1vZGFsRWxlbWVudCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY2xlYXJDb250ZW50Q2hpbGQoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29tcG9uZW50LnNldFByb3BlcnR5KCdzaG93Jyk7XG4gICAgY29tcG9uZW50LnNob3cudXBkYXRlcih1cGRhdGVTaG93KTtcblxuICAgIHJldHVybiBjb21wb25lbnQ7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5leHBlY3RlZENvbXBvbmVudHMgPSBbJ3RleHQnLCAnX2dlbmVyaWMnLCAnbGlzdCcsICd0ZW1wbGF0ZXInXTsiLCIvL0NvcHlyaWdodCAoQykgMjAxMiBLb3J5IE51bm5cclxuXHJcbi8vUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcclxuXHJcbi8vVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXHJcblxyXG4vL1RIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxyXG5cclxuLypcclxuXHJcbiAgICBUaGlzIGNvZGUgaXMgbm90IGZvcm1hdHRlZCBmb3IgcmVhZGFiaWxpdHksIGJ1dCByYXRoZXIgcnVuLXNwZWVkIGFuZCB0byBhc3Npc3QgY29tcGlsZXJzLlxyXG5cclxuICAgIEhvd2V2ZXIsIHRoZSBjb2RlJ3MgaW50ZW50aW9uIHNob3VsZCBiZSB0cmFuc3BhcmVudC5cclxuXHJcbiAgICAqKiogSUUgU1VQUE9SVCAqKipcclxuXHJcbiAgICBJZiB5b3UgcmVxdWlyZSB0aGlzIGxpYnJhcnkgdG8gd29yayBpbiBJRTcsIGFkZCB0aGUgZm9sbG93aW5nIGFmdGVyIGRlY2xhcmluZyBjcmVsLlxyXG5cclxuICAgIHZhciB0ZXN0RGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JyksXHJcbiAgICAgICAgdGVzdExhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnbGFiZWwnKTtcclxuXHJcbiAgICB0ZXN0RGl2LnNldEF0dHJpYnV0ZSgnY2xhc3MnLCAnYScpO1xyXG4gICAgdGVzdERpdlsnY2xhc3NOYW1lJ10gIT09ICdhJyA/IGNyZWwuYXR0ck1hcFsnY2xhc3MnXSA9ICdjbGFzc05hbWUnOnVuZGVmaW5lZDtcclxuICAgIHRlc3REaXYuc2V0QXR0cmlidXRlKCduYW1lJywnYScpO1xyXG4gICAgdGVzdERpdlsnbmFtZSddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ25hbWUnXSA9IGZ1bmN0aW9uKGVsZW1lbnQsIHZhbHVlKXtcclxuICAgICAgICBlbGVtZW50LmlkID0gdmFsdWU7XHJcbiAgICB9OnVuZGVmaW5lZDtcclxuXHJcblxyXG4gICAgdGVzdExhYmVsLnNldEF0dHJpYnV0ZSgnZm9yJywgJ2EnKTtcclxuICAgIHRlc3RMYWJlbFsnaHRtbEZvciddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ2ZvciddID0gJ2h0bWxGb3InOnVuZGVmaW5lZDtcclxuXHJcblxyXG5cclxuKi9cclxuXHJcbihmdW5jdGlvbiAocm9vdCwgZmFjdG9yeSkge1xyXG4gICAgaWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xyXG4gICAgICAgIG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeSgpO1xyXG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHtcclxuICAgICAgICBkZWZpbmUoZmFjdG9yeSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJvb3QuY3JlbCA9IGZhY3RvcnkoKTtcclxuICAgIH1cclxufSh0aGlzLCBmdW5jdGlvbiAoKSB7XHJcbiAgICB2YXIgZm4gPSAnZnVuY3Rpb24nLFxyXG4gICAgICAgIG9iaiA9ICdvYmplY3QnLFxyXG4gICAgICAgIG5vZGVUeXBlID0gJ25vZGVUeXBlJyxcclxuICAgICAgICB0ZXh0Q29udGVudCA9ICd0ZXh0Q29udGVudCcsXHJcbiAgICAgICAgc2V0QXR0cmlidXRlID0gJ3NldEF0dHJpYnV0ZScsXHJcbiAgICAgICAgYXR0ck1hcFN0cmluZyA9ICdhdHRyTWFwJyxcclxuICAgICAgICBpc05vZGVTdHJpbmcgPSAnaXNOb2RlJyxcclxuICAgICAgICBpc0VsZW1lbnRTdHJpbmcgPSAnaXNFbGVtZW50JyxcclxuICAgICAgICBkID0gdHlwZW9mIGRvY3VtZW50ID09PSBvYmogPyBkb2N1bWVudCA6IHt9LFxyXG4gICAgICAgIGlzVHlwZSA9IGZ1bmN0aW9uKGEsIHR5cGUpe1xyXG4gICAgICAgICAgICByZXR1cm4gdHlwZW9mIGEgPT09IHR5cGU7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBpc05vZGUgPSB0eXBlb2YgTm9kZSA9PT0gZm4gPyBmdW5jdGlvbiAob2JqZWN0KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBvYmplY3QgaW5zdGFuY2VvZiBOb2RlO1xyXG4gICAgICAgIH0gOlxyXG4gICAgICAgIC8vIGluIElFIDw9IDggTm9kZSBpcyBhbiBvYmplY3QsIG9idmlvdXNseS4uXHJcbiAgICAgICAgZnVuY3Rpb24ob2JqZWN0KXtcclxuICAgICAgICAgICAgcmV0dXJuIG9iamVjdCAmJlxyXG4gICAgICAgICAgICAgICAgaXNUeXBlKG9iamVjdCwgb2JqKSAmJlxyXG4gICAgICAgICAgICAgICAgKG5vZGVUeXBlIGluIG9iamVjdCkgJiZcclxuICAgICAgICAgICAgICAgIGlzVHlwZShvYmplY3Qub3duZXJEb2N1bWVudCxvYmopO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaXNFbGVtZW50ID0gZnVuY3Rpb24gKG9iamVjdCkge1xyXG4gICAgICAgICAgICByZXR1cm4gY3JlbFtpc05vZGVTdHJpbmddKG9iamVjdCkgJiYgb2JqZWN0W25vZGVUeXBlXSA9PT0gMTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGlzQXJyYXkgPSBmdW5jdGlvbihhKXtcclxuICAgICAgICAgICAgcmV0dXJuIGEgaW5zdGFuY2VvZiBBcnJheTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGFwcGVuZENoaWxkID0gZnVuY3Rpb24oZWxlbWVudCwgY2hpbGQpIHtcclxuICAgICAgICAgIGlmKCFjcmVsW2lzTm9kZVN0cmluZ10oY2hpbGQpKXtcclxuICAgICAgICAgICAgICBjaGlsZCA9IGQuY3JlYXRlVGV4dE5vZGUoY2hpbGQpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgZWxlbWVudC5hcHBlbmRDaGlsZChjaGlsZCk7XHJcbiAgICAgICAgfTtcclxuXHJcblxyXG4gICAgZnVuY3Rpb24gY3JlbCgpe1xyXG4gICAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzLCAvL05vdGU6IGFzc2lnbmVkIHRvIGEgdmFyaWFibGUgdG8gYXNzaXN0IGNvbXBpbGVycy4gU2F2ZXMgYWJvdXQgNDAgYnl0ZXMgaW4gY2xvc3VyZSBjb21waWxlci4gSGFzIG5lZ2xpZ2FibGUgZWZmZWN0IG9uIHBlcmZvcm1hbmNlLlxyXG4gICAgICAgICAgICBlbGVtZW50ID0gYXJnc1swXSxcclxuICAgICAgICAgICAgY2hpbGQsXHJcbiAgICAgICAgICAgIHNldHRpbmdzID0gYXJnc1sxXSxcclxuICAgICAgICAgICAgY2hpbGRJbmRleCA9IDIsXHJcbiAgICAgICAgICAgIGFyZ3VtZW50c0xlbmd0aCA9IGFyZ3MubGVuZ3RoLFxyXG4gICAgICAgICAgICBhdHRyaWJ1dGVNYXAgPSBjcmVsW2F0dHJNYXBTdHJpbmddO1xyXG5cclxuICAgICAgICBlbGVtZW50ID0gY3JlbFtpc0VsZW1lbnRTdHJpbmddKGVsZW1lbnQpID8gZWxlbWVudCA6IGQuY3JlYXRlRWxlbWVudChlbGVtZW50KTtcclxuICAgICAgICAvLyBzaG9ydGN1dFxyXG4gICAgICAgIGlmKGFyZ3VtZW50c0xlbmd0aCA9PT0gMSl7XHJcbiAgICAgICAgICAgIHJldHVybiBlbGVtZW50O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYoIWlzVHlwZShzZXR0aW5ncyxvYmopIHx8IGNyZWxbaXNOb2RlU3RyaW5nXShzZXR0aW5ncykgfHwgaXNBcnJheShzZXR0aW5ncykpIHtcclxuICAgICAgICAgICAgLS1jaGlsZEluZGV4O1xyXG4gICAgICAgICAgICBzZXR0aW5ncyA9IG51bGw7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBzaG9ydGN1dCBpZiB0aGVyZSBpcyBvbmx5IG9uZSBjaGlsZCB0aGF0IGlzIGEgc3RyaW5nXHJcbiAgICAgICAgaWYoKGFyZ3VtZW50c0xlbmd0aCAtIGNoaWxkSW5kZXgpID09PSAxICYmIGlzVHlwZShhcmdzW2NoaWxkSW5kZXhdLCAnc3RyaW5nJykgJiYgZWxlbWVudFt0ZXh0Q29udGVudF0gIT09IHVuZGVmaW5lZCl7XHJcbiAgICAgICAgICAgIGVsZW1lbnRbdGV4dENvbnRlbnRdID0gYXJnc1tjaGlsZEluZGV4XTtcclxuICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgICAgZm9yKDsgY2hpbGRJbmRleCA8IGFyZ3VtZW50c0xlbmd0aDsgKytjaGlsZEluZGV4KXtcclxuICAgICAgICAgICAgICAgIGNoaWxkID0gYXJnc1tjaGlsZEluZGV4XTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZihjaGlsZCA9PSBudWxsKXtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoaXNBcnJheShjaGlsZCkpIHtcclxuICAgICAgICAgICAgICAgICAgZm9yICh2YXIgaT0wOyBpIDwgY2hpbGQubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgICAgICAgICBhcHBlbmRDaGlsZChlbGVtZW50LCBjaGlsZFtpXSk7XHJcbiAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgIGFwcGVuZENoaWxkKGVsZW1lbnQsIGNoaWxkKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZm9yKHZhciBrZXkgaW4gc2V0dGluZ3Mpe1xyXG4gICAgICAgICAgICBpZighYXR0cmlidXRlTWFwW2tleV0pe1xyXG4gICAgICAgICAgICAgICAgZWxlbWVudFtzZXRBdHRyaWJ1dGVdKGtleSwgc2V0dGluZ3Nba2V5XSk7XHJcbiAgICAgICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICAgICAgdmFyIGF0dHIgPSBhdHRyaWJ1dGVNYXBba2V5XTtcclxuICAgICAgICAgICAgICAgIGlmKHR5cGVvZiBhdHRyID09PSBmbil7XHJcbiAgICAgICAgICAgICAgICAgICAgYXR0cihlbGVtZW50LCBzZXR0aW5nc1trZXldKTtcclxuICAgICAgICAgICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICAgICAgICAgIGVsZW1lbnRbc2V0QXR0cmlidXRlXShhdHRyLCBzZXR0aW5nc1trZXldKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGVsZW1lbnQ7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVXNlZCBmb3IgbWFwcGluZyBvbmUga2luZCBvZiBhdHRyaWJ1dGUgdG8gdGhlIHN1cHBvcnRlZCB2ZXJzaW9uIG9mIHRoYXQgaW4gYmFkIGJyb3dzZXJzLlxyXG4gICAgY3JlbFthdHRyTWFwU3RyaW5nXSA9IHt9O1xyXG5cclxuICAgIGNyZWxbaXNFbGVtZW50U3RyaW5nXSA9IGlzRWxlbWVudDtcclxuXHJcbiAgICBjcmVsW2lzTm9kZVN0cmluZ10gPSBpc05vZGU7XHJcblxyXG4gICAgcmV0dXJuIGNyZWw7XHJcbn0pKTtcclxuIiwiLyoganNoaW50IG5vZGU6IHRydWUgKi9cbid1c2Ugc3RyaWN0JztcblxuLyoqXG4gICMgZGVmYXVsdGNzc1xuXG4gIEEgdmVyeSBzaW1wbGUgbW9kdWxlIGZvciBjcmVhdGluZyBhIGxpdHRsZSBiaXQgb2YgZGVmYXVsdGNzcy4gIFRoaXMgaXNcbiAgcmVhbGx5IHVzZWZ1bCBpZiB5b3UgYXJlIGNyZWF0aW5nIGEgc21hbGwgSlMgd2lkZ2V0IHRoYXQgeW91IHdhbnQgdG8gYmVcbiAgY29tcGxldGVseSBzdHlsYWJsZSBieSB0aGUgYXBwbGljYXRpb24gaW1wbGVtZW50ZXIgYnV0IHdvdWxkIGFsc28gbGlrZSBpdFxuICB0byBsb29rIFwia2luZCBvZiBva1wiIGlmIHNvbWVvbmUgd2FudCB0byBoYXZlIGEgcXVpY2sgcGxheS5cblxuICAjIyBIb3cgaXQgV29ya3NcblxuICBUaGUgcHJvdmlkZWQgY3NzIHRleHQgaXMgaW5qZWN0ZWQgaW50byB0aGUgSFRNTCBkb2N1bWVudCB3aXRoaW4gdGhlIGRvY3VtZW50XG4gIGA8aGVhZD5gIHByaW9yIHRvIGFueSBvdGhlciBgPGxpbms+YCBvciBgPHN0eWxlPmAgdGFncy4gIFRoaXMgZW5zdXJlcyB0aGF0XG4gIGFueSBkZWZpbml0aW9ucyB0aGF0IGFyZSBtYWRlIHdpdGhpbiB5b3VyIHByb3ZpZGVkIENTUyBoYXZlIGFtcGxlXG4gIG9wcG9ydHVuaXR5IHRvIGJlIG92ZXJyaWRkZW4gYnkgdXNlciBkZWZpbmVkIENTUy5cblxuICAjIyBFeGFtcGxlIFVzYWdlXG5cbiAgPDw8IGV4YW1wbGVzL3dpZGdldC5qc1xuXG4gICMjIFJlZmVyZW5jZVxuXG4gICMjIyBkZWZhdWx0Y3NzXG5cbiAgYGBgXG4gIGRlZmF1bHRjc3MobGFiZWwsIGNzc3RleHQpXG4gIGBgYFxuXG4gIENyZWF0ZSBhIG5ldyBkZWZhdWx0IGBzdHlsZWAgZWxlbWVudCBhbmQgdXNlIHRoZSBwcm92aWRlZCBgbGFiZWxgIHRvXG4gIGdlbmVyYXRlIGFuIGlkIGZvciB0aGUgZWxlbWVudCBcIiVsYWJlbCVfZGVmYXVsdHN0eWxlXCIuICBJZiBhbiBleGlzdGluZ1xuICBlbGVtZW50IHdpdGggdGhhdCBpZCBpcyBmb3VuZCwgdGhlbiBkbyBub3RoaW5nLlxuXG4gIElmIG5vdCwgdGhlbiBjcmVhdGUgdGhlIG5ldyBlbGVtZW50IGFuZCB1c2UgdGhlIHByb3ZpZGVkIGBjc3N0ZXh0YCBhc1xuICBgaW5uZXJUZXh0YCBmb3IgdGggZWxlbWVudC5cbioqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihsYWJlbCwgdGV4dCkge1xuICB2YXIgc3R5bGVJZCA9IGxhYmVsICsgJ19kZWZhdWx0c3R5bGUnO1xuXG4gIC8vIGxvb2sgZm9yIGEgRE9NIGVsZW1lbnQgd2l0aCB0aGUgc3R5bGUgaWRcbiAgdmFyIHN0eWxlRWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChzdHlsZUlkKTtcblxuICAvLyBmaW5kIHRoZSBmaXJzdCA8bGluaz4gb3IgPHN0eWxlPiB0YWcgd2l0aGluIHRoZSBkb2N1bWVudCBoZWFkXG4gIHZhciBmaXJzdFN0eWxlRGVmID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignbGlua1tyZWw9XCJzdHlsZXNoZWV0XCJdLHN0eWxlJyk7XG5cbiAgLy8gaWYgd2UgY2FuIGZpbmQgYSBET00gZWxlbWVudCB3aXRoIHRoYXQgaWQsIHRoZW4gZG8gbm90aGluZyBhcyBhIGRlZmF1bHRcbiAgLy8gc3R5bGUgaGFzIGFscmVhZHkgYmVlbiBhcHBsaWVkXG4gIGlmIChzdHlsZUVsKSB7XG4gICAgcmV0dXJuIHN0eWxlRWw7XG4gIH1cblxuICAvLyBvdGhlcndpc2UsIGNyZWF0ZSBhIHN0eWxlIGVsZW1lbnRcbiAgc3R5bGVFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XG4gIHN0eWxlRWwuaW5uZXJIVE1MID0gdGV4dDtcblxuICAvLyBpbnNlcnQgdGhlIHN0eWxlIGVsZW1lbnQsIGluIG9yZGVyIG9yIHByZWZlcmVuY2VcbiAgLy8gMS4gYmVmb3JlIHRoZSBmaXJzdCBzdHlsZSByZWxhdGVkIGVsZW1lbnQgaW4gdGhlIHBhZ2VcbiAgaWYgKGZpcnN0U3R5bGVEZWYpIHtcbiAgICBmaXJzdFN0eWxlRGVmLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKHN0eWxlRWwsIGZpcnN0U3R5bGVEZWYpO1xuICB9XG4gIC8vIDIuIHRvIHRoZSBlbmQgb2YgdGhlIEhFQURcbiAgZWxzZSBpZiAoZG9jdW1lbnQuaGVhZCkge1xuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQoc3R5bGVFbCk7XG4gIH1cbiAgLy8gMy4gYXMgdGhlIGZpcnN0IGVsZW1lbnQgaW4gdGhlIGJvZHlcbiAgZWxzZSBpZiAoZG9jdW1lbnQuYm9keSAmJiBkb2N1bWVudC5ib2R5LmNoaWxkTm9kZXMubGVuZ3RoID4gMCkge1xuICAgIGRvY3VtZW50LmJvZHkuaW5zZXJ0QmVmb3JlKHN0eWxlRWwsIGRvY3VtZW50LmJvZHkuY2hpbGROb2Rlc1swXSk7XG4gIH1cbiAgLy8gNC4gaW4gdGhlIGJvZHlcbiAgZWxzZSBpZiAoZG9jdW1lbnQuYm9keSkge1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoc3R5bGVFbCk7XG4gIH1cblxuICByZXR1cm4gc3R5bGVFbDtcbn07XG4iLCJ2YXIgZG9jID0ge1xyXG4gICAgZG9jdW1lbnQ6IHR5cGVvZiBkb2N1bWVudCAhPT0gJ3VuZGVmaW5lZCcgPyBkb2N1bWVudCA6IG51bGwsXHJcbiAgICBzZXREb2N1bWVudDogZnVuY3Rpb24oZCl7XHJcbiAgICAgICAgdGhpcy5kb2N1bWVudCA9IGQ7XHJcbiAgICB9XHJcbn07XHJcblxyXG52YXIgYXJyYXlQcm90byA9IFtdLFxyXG4gICAgaXNMaXN0ID0gcmVxdWlyZSgnLi9pc0xpc3QnKSxcclxuICAgIGdldFRhcmdldHMgPSByZXF1aXJlKCcuL2dldFRhcmdldHMnKShkb2MuZG9jdW1lbnQpLFxyXG4gICAgZ2V0VGFyZ2V0ID0gcmVxdWlyZSgnLi9nZXRUYXJnZXQnKShkb2MuZG9jdW1lbnQpLFxyXG4gICAgc3BhY2UgPSAnICc7XHJcblxyXG5cclxuLy8vW1JFQURNRS5tZF1cclxuXHJcbmZ1bmN0aW9uIGlzSW4oYXJyYXksIGl0ZW0pe1xyXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGFycmF5Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgaWYoaXRlbSA9PT0gYXJyYXlbaV0pe1xyXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG5cclxuICAgICMjIC5maW5kXHJcblxyXG4gICAgZmluZHMgZWxlbWVudHMgdGhhdCBtYXRjaCB0aGUgcXVlcnkgd2l0aGluIHRoZSBzY29wZSBvZiB0YXJnZXRcclxuXHJcbiAgICAgICAgLy9mbHVlbnRcclxuICAgICAgICBkb2ModGFyZ2V0KS5maW5kKHF1ZXJ5KTtcclxuXHJcbiAgICAgICAgLy9sZWdhY3lcclxuICAgICAgICBkb2MuZmluZCh0YXJnZXQsIHF1ZXJ5KTtcclxuKi9cclxuXHJcbmZ1bmN0aW9uIGZpbmQodGFyZ2V0LCBxdWVyeSl7XHJcbiAgICB0YXJnZXQgPSBnZXRUYXJnZXRzKHRhcmdldCk7XHJcbiAgICBpZihxdWVyeSA9PSBudWxsKXtcclxuICAgICAgICByZXR1cm4gdGFyZ2V0O1xyXG4gICAgfVxyXG5cclxuICAgIGlmKGlzTGlzdCh0YXJnZXQpKXtcclxuICAgICAgICB2YXIgcmVzdWx0cyA9IFtdO1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGFyZ2V0Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgIHZhciBzdWJSZXN1bHRzID0gZG9jLmZpbmQodGFyZ2V0W2ldLCBxdWVyeSk7XHJcbiAgICAgICAgICAgIGZvcih2YXIgaiA9IDA7IGogPCBzdWJSZXN1bHRzLmxlbmd0aDsgaisrKSB7XHJcbiAgICAgICAgICAgICAgICBpZighaXNJbihyZXN1bHRzLCBzdWJSZXN1bHRzW2pdKSl7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKHN1YlJlc3VsdHNbal0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiByZXN1bHRzO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB0YXJnZXQgPyB0YXJnZXQucXVlcnlTZWxlY3RvckFsbChxdWVyeSkgOiBbXTtcclxufVxyXG5cclxuLyoqXHJcblxyXG4gICAgIyMgLmZpbmRPbmVcclxuXHJcbiAgICBmaW5kcyB0aGUgZmlyc3QgZWxlbWVudCB0aGF0IG1hdGNoZXMgdGhlIHF1ZXJ5IHdpdGhpbiB0aGUgc2NvcGUgb2YgdGFyZ2V0XHJcblxyXG4gICAgICAgIC8vZmx1ZW50XHJcbiAgICAgICAgZG9jKHRhcmdldCkuZmluZE9uZShxdWVyeSk7XHJcblxyXG4gICAgICAgIC8vbGVnYWN5XHJcbiAgICAgICAgZG9jLmZpbmRPbmUodGFyZ2V0LCBxdWVyeSk7XHJcbiovXHJcblxyXG5mdW5jdGlvbiBmaW5kT25lKHRhcmdldCwgcXVlcnkpe1xyXG4gICAgdGFyZ2V0ID0gZ2V0VGFyZ2V0KHRhcmdldCk7XHJcbiAgICBpZihxdWVyeSA9PSBudWxsKXtcclxuICAgICAgICByZXR1cm4gdGFyZ2V0O1xyXG4gICAgfVxyXG5cclxuICAgIGlmKGlzTGlzdCh0YXJnZXQpKXtcclxuICAgICAgICB2YXIgcmVzdWx0O1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGFyZ2V0Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IGZpbmRPbmUodGFyZ2V0W2ldLCBxdWVyeSk7XHJcbiAgICAgICAgICAgIGlmKHJlc3VsdCl7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB0YXJnZXQgPyB0YXJnZXQucXVlcnlTZWxlY3RvcihxdWVyeSkgOiBudWxsO1xyXG59XHJcblxyXG4vKipcclxuXHJcbiAgICAjIyAuY2xvc2VzdFxyXG5cclxuICAgIHJlY3Vyc2VzIHVwIHRoZSBET00gZnJvbSB0aGUgdGFyZ2V0IG5vZGUsIGNoZWNraW5nIGlmIHRoZSBjdXJyZW50IGVsZW1lbnQgbWF0Y2hlcyB0aGUgcXVlcnlcclxuXHJcbiAgICAgICAgLy9mbHVlbnRcclxuICAgICAgICBkb2ModGFyZ2V0KS5jbG9zZXN0KHF1ZXJ5KTtcclxuXHJcbiAgICAgICAgLy9sZWdhY3lcclxuICAgICAgICBkb2MuY2xvc2VzdCh0YXJnZXQsIHF1ZXJ5KTtcclxuKi9cclxuXHJcbmZ1bmN0aW9uIGNsb3Nlc3QodGFyZ2V0LCBxdWVyeSl7XHJcbiAgICB0YXJnZXQgPSBnZXRUYXJnZXQodGFyZ2V0KTtcclxuXHJcbiAgICBpZihpc0xpc3QodGFyZ2V0KSl7XHJcbiAgICAgICAgdGFyZ2V0ID0gdGFyZ2V0WzBdO1xyXG4gICAgfVxyXG5cclxuICAgIHdoaWxlKFxyXG4gICAgICAgIHRhcmdldCAmJlxyXG4gICAgICAgIHRhcmdldC5vd25lckRvY3VtZW50ICYmXHJcbiAgICAgICAgIWlzKHRhcmdldCwgcXVlcnkpXHJcbiAgICApe1xyXG4gICAgICAgIHRhcmdldCA9IHRhcmdldC5wYXJlbnROb2RlO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB0YXJnZXQgPT09IGRvYy5kb2N1bWVudCAmJiB0YXJnZXQgIT09IHF1ZXJ5ID8gbnVsbCA6IHRhcmdldDtcclxufVxyXG5cclxuLyoqXHJcblxyXG4gICAgIyMgLmlzXHJcblxyXG4gICAgcmV0dXJucyB0cnVlIGlmIHRoZSB0YXJnZXQgZWxlbWVudCBtYXRjaGVzIHRoZSBxdWVyeVxyXG5cclxuICAgICAgICAvL2ZsdWVudFxyXG4gICAgICAgIGRvYyh0YXJnZXQpLmlzKHF1ZXJ5KTtcclxuXHJcbiAgICAgICAgLy9sZWdhY3lcclxuICAgICAgICBkb2MuaXModGFyZ2V0LCBxdWVyeSk7XHJcbiovXHJcblxyXG5mdW5jdGlvbiBpcyh0YXJnZXQsIHF1ZXJ5KXtcclxuICAgIHRhcmdldCA9IGdldFRhcmdldCh0YXJnZXQpO1xyXG5cclxuICAgIGlmKGlzTGlzdCh0YXJnZXQpKXtcclxuICAgICAgICB0YXJnZXQgPSB0YXJnZXRbMF07XHJcbiAgICB9XHJcblxyXG4gICAgaWYoIXRhcmdldC5vd25lckRvY3VtZW50IHx8IHR5cGVvZiBxdWVyeSAhPT0gJ3N0cmluZycpe1xyXG4gICAgICAgIHJldHVybiB0YXJnZXQgPT09IHF1ZXJ5O1xyXG4gICAgfVxyXG5cclxuICAgIGlmKHRhcmdldCA9PT0gcXVlcnkpe1xyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBwYXJlbnRsZXNzID0gIXRhcmdldC5wYXJlbnROb2RlO1xyXG5cclxuICAgIGlmKHBhcmVudGxlc3Mpe1xyXG4gICAgICAgIC8vIEdpdmUgdGhlIGVsZW1lbnQgYSBwYXJlbnQgc28gdGhhdCAucXVlcnlTZWxlY3RvckFsbCBjYW4gYmUgdXNlZFxyXG4gICAgICAgIGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKS5hcHBlbmRDaGlsZCh0YXJnZXQpO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciByZXN1bHQgPSBhcnJheVByb3RvLmluZGV4T2YuY2FsbChmaW5kKHRhcmdldC5wYXJlbnROb2RlLCBxdWVyeSksIHRhcmdldCkgPj0gMDtcclxuXHJcbiAgICBpZihwYXJlbnRsZXNzKXtcclxuICAgICAgICB0YXJnZXQucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCh0YXJnZXQpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbi8qKlxyXG5cclxuICAgICMjIC5hZGRDbGFzc1xyXG5cclxuICAgIGFkZHMgY2xhc3NlcyB0byB0aGUgdGFyZ2V0IChzcGFjZSBzZXBhcmF0ZWQgc3RyaW5nIG9yIGFycmF5KVxyXG5cclxuICAgICAgICAvL2ZsdWVudFxyXG4gICAgICAgIGRvYyh0YXJnZXQpLmFkZENsYXNzKHF1ZXJ5KTtcclxuXHJcbiAgICAgICAgLy9sZWdhY3lcclxuICAgICAgICBkb2MuYWRkQ2xhc3ModGFyZ2V0LCBxdWVyeSk7XHJcbiovXHJcblxyXG5mdW5jdGlvbiBhZGRDbGFzcyh0YXJnZXQsIGNsYXNzZXMpe1xyXG4gICAgdGFyZ2V0ID0gZ2V0VGFyZ2V0cyh0YXJnZXQpO1xyXG5cclxuICAgIGlmKGlzTGlzdCh0YXJnZXQpKXtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRhcmdldC5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgICAgICBhZGRDbGFzcyh0YXJnZXRbaV0sIGNsYXNzZXMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdGhpcztcclxuICAgIH1cclxuICAgIGlmKCFjbGFzc2VzKXtcclxuICAgICAgICByZXR1cm4gdGhpcztcclxuICAgIH1cclxuXHJcbiAgICB2YXIgY2xhc3NlcyA9IEFycmF5LmlzQXJyYXkoY2xhc3NlcykgPyBjbGFzc2VzIDogY2xhc3Nlcy5zcGxpdChzcGFjZSksXHJcbiAgICAgICAgY3VycmVudENsYXNzZXMgPSB0YXJnZXQuY2xhc3NMaXN0ID8gbnVsbCA6IHRhcmdldC5jbGFzc05hbWUuc3BsaXQoc3BhY2UpO1xyXG5cclxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBjbGFzc2VzLmxlbmd0aDsgaSsrKXtcclxuICAgICAgICB2YXIgY2xhc3NUb0FkZCA9IGNsYXNzZXNbaV07XHJcbiAgICAgICAgaWYoIWNsYXNzVG9BZGQgfHwgY2xhc3NUb0FkZCA9PT0gc3BhY2Upe1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYodGFyZ2V0LmNsYXNzTGlzdCl7XHJcbiAgICAgICAgICAgIHRhcmdldC5jbGFzc0xpc3QuYWRkKGNsYXNzVG9BZGQpO1xyXG4gICAgICAgIH0gZWxzZSBpZighY3VycmVudENsYXNzZXMuaW5kZXhPZihjbGFzc1RvQWRkKT49MCl7XHJcbiAgICAgICAgICAgIGN1cnJlbnRDbGFzc2VzLnB1c2goY2xhc3NUb0FkZCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYoIXRhcmdldC5jbGFzc0xpc3Qpe1xyXG4gICAgICAgIHRhcmdldC5jbGFzc05hbWUgPSBjdXJyZW50Q2xhc3Nlcy5qb2luKHNwYWNlKTtcclxuICAgIH1cclxuICAgIHJldHVybiB0aGlzO1xyXG59XHJcblxyXG4vKipcclxuXHJcbiAgICAjIyAucmVtb3ZlQ2xhc3NcclxuXHJcbiAgICByZW1vdmVzIGNsYXNzZXMgZnJvbSB0aGUgdGFyZ2V0IChzcGFjZSBzZXBhcmF0ZWQgc3RyaW5nIG9yIGFycmF5KVxyXG5cclxuICAgICAgICAvL2ZsdWVudFxyXG4gICAgICAgIGRvYyh0YXJnZXQpLnJlbW92ZUNsYXNzKHF1ZXJ5KTtcclxuXHJcbiAgICAgICAgLy9sZWdhY3lcclxuICAgICAgICBkb2MucmVtb3ZlQ2xhc3ModGFyZ2V0LCBxdWVyeSk7XHJcbiovXHJcblxyXG5mdW5jdGlvbiByZW1vdmVDbGFzcyh0YXJnZXQsIGNsYXNzZXMpe1xyXG4gICAgdGFyZ2V0ID0gZ2V0VGFyZ2V0cyh0YXJnZXQpO1xyXG5cclxuICAgIGlmKGlzTGlzdCh0YXJnZXQpKXtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRhcmdldC5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgICAgICByZW1vdmVDbGFzcyh0YXJnZXRbaV0sIGNsYXNzZXMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdGhpcztcclxuICAgIH1cclxuXHJcbiAgICBpZighY2xhc3Nlcyl7XHJcbiAgICAgICAgcmV0dXJuIHRoaXM7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIGNsYXNzZXMgPSBBcnJheS5pc0FycmF5KGNsYXNzZXMpID8gY2xhc3NlcyA6IGNsYXNzZXMuc3BsaXQoc3BhY2UpLFxyXG4gICAgICAgIGN1cnJlbnRDbGFzc2VzID0gdGFyZ2V0LmNsYXNzTGlzdCA/IG51bGwgOiB0YXJnZXQuY2xhc3NOYW1lLnNwbGl0KHNwYWNlKTtcclxuXHJcbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgY2xhc3Nlcy5sZW5ndGg7IGkrKyl7XHJcbiAgICAgICAgdmFyIGNsYXNzVG9SZW1vdmUgPSBjbGFzc2VzW2ldO1xyXG4gICAgICAgIGlmKCFjbGFzc1RvUmVtb3ZlIHx8IGNsYXNzVG9SZW1vdmUgPT09IHNwYWNlKXtcclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmKHRhcmdldC5jbGFzc0xpc3Qpe1xyXG4gICAgICAgICAgICB0YXJnZXQuY2xhc3NMaXN0LnJlbW92ZShjbGFzc1RvUmVtb3ZlKTtcclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHZhciByZW1vdmVJbmRleCA9IGN1cnJlbnRDbGFzc2VzLmluZGV4T2YoY2xhc3NUb1JlbW92ZSk7XHJcbiAgICAgICAgaWYocmVtb3ZlSW5kZXggPj0gMCl7XHJcbiAgICAgICAgICAgIGN1cnJlbnRDbGFzc2VzLnNwbGljZShyZW1vdmVJbmRleCwgMSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYoIXRhcmdldC5jbGFzc0xpc3Qpe1xyXG4gICAgICAgIHRhcmdldC5jbGFzc05hbWUgPSBjdXJyZW50Q2xhc3Nlcy5qb2luKHNwYWNlKTtcclxuICAgIH1cclxuICAgIHJldHVybiB0aGlzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBhZGRFdmVudChzZXR0aW5ncyl7XHJcbiAgICB2YXIgdGFyZ2V0ID0gZ2V0VGFyZ2V0KHNldHRpbmdzLnRhcmdldCk7XHJcbiAgICBpZih0YXJnZXQpe1xyXG4gICAgICAgIHRhcmdldC5hZGRFdmVudExpc3RlbmVyKHNldHRpbmdzLmV2ZW50LCBzZXR0aW5ncy5jYWxsYmFjaywgZmFsc2UpO1xyXG4gICAgfWVsc2V7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdObyBlbGVtZW50cyBtYXRjaGVkIHRoZSBzZWxlY3Rvciwgc28gbm8gZXZlbnRzIHdlcmUgYm91bmQuJyk7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG5cclxuICAgICMjIC5vblxyXG5cclxuICAgIGJpbmRzIGEgY2FsbGJhY2sgdG8gYSB0YXJnZXQgd2hlbiBhIERPTSBldmVudCBpcyByYWlzZWQuXHJcblxyXG4gICAgICAgIC8vZmx1ZW50XHJcbiAgICAgICAgZG9jKHRhcmdldC9wcm94eSkub24oZXZlbnRzLCB0YXJnZXRbb3B0aW9uYWxdLCBjYWxsYmFjayk7XHJcblxyXG4gICAgbm90ZTogaWYgYSB0YXJnZXQgaXMgcGFzc2VkIHRvIHRoZSAub24gZnVuY3Rpb24sIGRvYydzIHRhcmdldCB3aWxsIGJlIHVzZWQgYXMgdGhlIHByb3h5LlxyXG5cclxuICAgICAgICAvL2xlZ2FjeVxyXG4gICAgICAgIGRvYy5vbihldmVudHMsIHRhcmdldCwgcXVlcnksIHByb3h5W29wdGlvbmFsXSk7XHJcbiovXHJcblxyXG5mdW5jdGlvbiBvbihldmVudHMsIHRhcmdldCwgY2FsbGJhY2ssIHByb3h5KXtcclxuXHJcbiAgICBwcm94eSA9IGdldFRhcmdldHMocHJveHkpO1xyXG5cclxuICAgIGlmKCFwcm94eSl7XHJcbiAgICAgICAgdGFyZ2V0ID0gZ2V0VGFyZ2V0cyh0YXJnZXQpO1xyXG4gICAgICAgIC8vIGhhbmRsZXMgbXVsdGlwbGUgdGFyZ2V0c1xyXG4gICAgICAgIGlmKGlzTGlzdCh0YXJnZXQpKXtcclxuICAgICAgICAgICAgdmFyIG11bHRpUmVtb3ZlQ2FsbGJhY2tzID0gW107XHJcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGFyZ2V0Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICBtdWx0aVJlbW92ZUNhbGxiYWNrcy5wdXNoKG9uKGV2ZW50cywgdGFyZ2V0W2ldLCBjYWxsYmFjaywgcHJveHkpKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24oKXtcclxuICAgICAgICAgICAgICAgIHdoaWxlKG11bHRpUmVtb3ZlQ2FsbGJhY2tzLmxlbmd0aCl7XHJcbiAgICAgICAgICAgICAgICAgICAgbXVsdGlSZW1vdmVDYWxsYmFja3MucG9wKCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIGhhbmRsZXMgbXVsdGlwbGUgcHJveGllc1xyXG4gICAgLy8gQWxyZWFkeSBoYW5kbGVzIG11bHRpcGxlIHByb3hpZXMgYW5kIHRhcmdldHMsXHJcbiAgICAvLyBiZWNhdXNlIHRoZSB0YXJnZXQgbG9vcCBjYWxscyB0aGlzIGxvb3AuXHJcbiAgICBpZihpc0xpc3QocHJveHkpKXtcclxuICAgICAgICB2YXIgbXVsdGlSZW1vdmVDYWxsYmFja3MgPSBbXTtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHByb3h5Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgIG11bHRpUmVtb3ZlQ2FsbGJhY2tzLnB1c2gob24oZXZlbnRzLCB0YXJnZXQsIGNhbGxiYWNrLCBwcm94eVtpXSkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gZnVuY3Rpb24oKXtcclxuICAgICAgICAgICAgd2hpbGUobXVsdGlSZW1vdmVDYWxsYmFja3MubGVuZ3RoKXtcclxuICAgICAgICAgICAgICAgIG11bHRpUmVtb3ZlQ2FsbGJhY2tzLnBvcCgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgcmVtb3ZlQ2FsbGJhY2tzID0gW107XHJcblxyXG4gICAgaWYodHlwZW9mIGV2ZW50cyA9PT0gJ3N0cmluZycpe1xyXG4gICAgICAgIGV2ZW50cyA9IGV2ZW50cy5zcGxpdChzcGFjZSk7XHJcbiAgICB9XHJcblxyXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGV2ZW50cy5sZW5ndGg7IGkrKyl7XHJcbiAgICAgICAgdmFyIGV2ZW50U2V0dGluZ3MgPSB7fTtcclxuICAgICAgICBpZihwcm94eSl7XHJcbiAgICAgICAgICAgIGlmKHByb3h5ID09PSB0cnVlKXtcclxuICAgICAgICAgICAgICAgIHByb3h5ID0gZG9jLmRvY3VtZW50O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGV2ZW50U2V0dGluZ3MudGFyZ2V0ID0gcHJveHk7XHJcbiAgICAgICAgICAgIGV2ZW50U2V0dGluZ3MuY2FsbGJhY2sgPSBmdW5jdGlvbihldmVudCl7XHJcbiAgICAgICAgICAgICAgICB2YXIgY2xvc2VzdFRhcmdldCA9IGNsb3Nlc3QoZXZlbnQudGFyZ2V0LCB0YXJnZXQpO1xyXG4gICAgICAgICAgICAgICAgaWYoY2xvc2VzdFRhcmdldCl7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2soZXZlbnQsIGNsb3Nlc3RUYXJnZXQpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICBldmVudFNldHRpbmdzLnRhcmdldCA9IHRhcmdldDtcclxuICAgICAgICAgICAgZXZlbnRTZXR0aW5ncy5jYWxsYmFjayA9IGNhbGxiYWNrO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZXZlbnRTZXR0aW5ncy5ldmVudCA9IGV2ZW50c1tpXTtcclxuXHJcbiAgICAgICAgYWRkRXZlbnQoZXZlbnRTZXR0aW5ncyk7XHJcblxyXG4gICAgICAgIHJlbW92ZUNhbGxiYWNrcy5wdXNoKGV2ZW50U2V0dGluZ3MpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBmdW5jdGlvbigpe1xyXG4gICAgICAgIHdoaWxlKHJlbW92ZUNhbGxiYWNrcy5sZW5ndGgpe1xyXG4gICAgICAgICAgICB2YXIgcmVtb3ZlQ2FsbGJhY2sgPSByZW1vdmVDYWxsYmFja3MucG9wKCk7XHJcbiAgICAgICAgICAgIGdldFRhcmdldChyZW1vdmVDYWxsYmFjay50YXJnZXQpLnJlbW92ZUV2ZW50TGlzdGVuZXIocmVtb3ZlQ2FsbGJhY2suZXZlbnQsIHJlbW92ZUNhbGxiYWNrLmNhbGxiYWNrKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG5cclxuICAgICMjIC5vZmZcclxuXHJcbiAgICByZW1vdmVzIGV2ZW50cyBhc3NpZ25lZCB0byBhIHRhcmdldC5cclxuXHJcbiAgICAgICAgLy9mbHVlbnRcclxuICAgICAgICBkb2ModGFyZ2V0L3Byb3h5KS5vZmYoZXZlbnRzLCB0YXJnZXRbb3B0aW9uYWxdLCBjYWxsYmFjayk7XHJcblxyXG4gICAgbm90ZTogaWYgYSB0YXJnZXQgaXMgcGFzc2VkIHRvIHRoZSAub24gZnVuY3Rpb24sIGRvYydzIHRhcmdldCB3aWxsIGJlIHVzZWQgYXMgdGhlIHByb3h5LlxyXG5cclxuICAgICAgICAvL2xlZ2FjeVxyXG4gICAgICAgIGRvYy5vZmYoZXZlbnRzLCB0YXJnZXQsIGNhbGxiYWNrLCBwcm94eSk7XHJcbiovXHJcblxyXG5mdW5jdGlvbiBvZmYoZXZlbnRzLCB0YXJnZXQsIGNhbGxiYWNrLCBwcm94eSl7XHJcbiAgICBpZihpc0xpc3QodGFyZ2V0KSl7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0YXJnZXQubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgb2ZmKGV2ZW50cywgdGFyZ2V0W2ldLCBjYWxsYmFjaywgcHJveHkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdGhpcztcclxuICAgIH1cclxuICAgIGlmKHByb3h5IGluc3RhbmNlb2YgQXJyYXkpe1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHJveHkubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgb2ZmKGV2ZW50cywgdGFyZ2V0LCBjYWxsYmFjaywgcHJveHlbaV0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdGhpcztcclxuICAgIH1cclxuXHJcbiAgICBpZih0eXBlb2YgZXZlbnRzID09PSAnc3RyaW5nJyl7XHJcbiAgICAgICAgZXZlbnRzID0gZXZlbnRzLnNwbGl0KHNwYWNlKTtcclxuICAgIH1cclxuXHJcbiAgICBpZih0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpe1xyXG4gICAgICAgIHByb3h5ID0gY2FsbGJhY2s7XHJcbiAgICAgICAgY2FsbGJhY2sgPSBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHByb3h5ID0gcHJveHkgPyBnZXRUYXJnZXQocHJveHkpIDogZG9jLmRvY3VtZW50O1xyXG5cclxuICAgIHZhciB0YXJnZXRzID0gdHlwZW9mIHRhcmdldCA9PT0gJ3N0cmluZycgPyBmaW5kKHRhcmdldCwgcHJveHkpIDogW3RhcmdldF07XHJcblxyXG4gICAgZm9yKHZhciB0YXJnZXRJbmRleCA9IDA7IHRhcmdldEluZGV4IDwgdGFyZ2V0cy5sZW5ndGg7IHRhcmdldEluZGV4Kyspe1xyXG4gICAgICAgIHZhciBjdXJyZW50VGFyZ2V0ID0gdGFyZ2V0c1t0YXJnZXRJbmRleF07XHJcblxyXG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBldmVudHMubGVuZ3RoOyBpKyspe1xyXG4gICAgICAgICAgICBjdXJyZW50VGFyZ2V0LnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnRzW2ldLCBjYWxsYmFjayk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRoaXM7XHJcbn1cclxuXHJcbi8qKlxyXG5cclxuICAgICMjIC5hcHBlbmRcclxuXHJcbiAgICBhZGRzIGVsZW1lbnRzIHRvIGEgdGFyZ2V0XHJcblxyXG4gICAgICAgIC8vZmx1ZW50XHJcbiAgICAgICAgZG9jKHRhcmdldCkuYXBwZW5kKGNoaWxkcmVuKTtcclxuXHJcbiAgICAgICAgLy9sZWdhY3lcclxuICAgICAgICBkb2MuYXBwZW5kKHRhcmdldCwgY2hpbGRyZW4pO1xyXG4qL1xyXG5cclxuZnVuY3Rpb24gYXBwZW5kKHRhcmdldCwgY2hpbGRyZW4pe1xyXG4gICAgdmFyIHRhcmdldCA9IGdldFRhcmdldCh0YXJnZXQpLFxyXG4gICAgICAgIGNoaWxkcmVuID0gZ2V0VGFyZ2V0KGNoaWxkcmVuKTtcclxuXHJcbiAgICBpZihpc0xpc3QodGFyZ2V0KSl7XHJcbiAgICAgICAgdGFyZ2V0ID0gdGFyZ2V0WzBdO1xyXG4gICAgfVxyXG5cclxuICAgIGlmKGlzTGlzdChjaGlsZHJlbikpe1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hpbGRyZW4ubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgYXBwZW5kKHRhcmdldCwgY2hpbGRyZW5baV0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdGFyZ2V0LmFwcGVuZENoaWxkKGNoaWxkcmVuKTtcclxufVxyXG5cclxuLyoqXHJcblxyXG4gICAgIyMgLnByZXBlbmRcclxuXHJcbiAgICBhZGRzIGVsZW1lbnRzIHRvIHRoZSBmcm9udCBvZiBhIHRhcmdldFxyXG5cclxuICAgICAgICAvL2ZsdWVudFxyXG4gICAgICAgIGRvYyh0YXJnZXQpLnByZXBlbmQoY2hpbGRyZW4pO1xyXG5cclxuICAgICAgICAvL2xlZ2FjeVxyXG4gICAgICAgIGRvYy5wcmVwZW5kKHRhcmdldCwgY2hpbGRyZW4pO1xyXG4qL1xyXG5cclxuZnVuY3Rpb24gcHJlcGVuZCh0YXJnZXQsIGNoaWxkcmVuKXtcclxuICAgIHZhciB0YXJnZXQgPSBnZXRUYXJnZXQodGFyZ2V0KSxcclxuICAgICAgICBjaGlsZHJlbiA9IGdldFRhcmdldChjaGlsZHJlbik7XHJcblxyXG4gICAgaWYoaXNMaXN0KHRhcmdldCkpe1xyXG4gICAgICAgIHRhcmdldCA9IHRhcmdldFswXTtcclxuICAgIH1cclxuXHJcbiAgICBpZihpc0xpc3QoY2hpbGRyZW4pKXtcclxuICAgICAgICAvL3JldmVyc2VkIGJlY2F1c2Ugb3RoZXJ3aXNlIHRoZSB3b3VsZCBnZXQgcHV0IGluIGluIHRoZSB3cm9uZyBvcmRlci5cclxuICAgICAgICBmb3IgKHZhciBpID0gY2hpbGRyZW4ubGVuZ3RoIC0xOyBpOyBpLS0pIHtcclxuICAgICAgICAgICAgcHJlcGVuZCh0YXJnZXQsIGNoaWxkcmVuW2ldKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHRhcmdldC5pbnNlcnRCZWZvcmUoY2hpbGRyZW4sIHRhcmdldC5maXJzdENoaWxkKTtcclxufVxyXG5cclxuLyoqXHJcblxyXG4gICAgIyMgLmlzVmlzaWJsZVxyXG5cclxuICAgIGNoZWNrcyBpZiBhbiBlbGVtZW50IG9yIGFueSBvZiBpdHMgcGFyZW50cyBkaXNwbGF5IHByb3BlcnRpZXMgYXJlIHNldCB0byAnbm9uZSdcclxuXHJcbiAgICAgICAgLy9mbHVlbnRcclxuICAgICAgICBkb2ModGFyZ2V0KS5pc1Zpc2libGUoKTtcclxuXHJcbiAgICAgICAgLy9sZWdhY3lcclxuICAgICAgICBkb2MuaXNWaXNpYmxlKHRhcmdldCk7XHJcbiovXHJcblxyXG5mdW5jdGlvbiBpc1Zpc2libGUodGFyZ2V0KXtcclxuICAgIHZhciB0YXJnZXQgPSBnZXRUYXJnZXQodGFyZ2V0KTtcclxuICAgIGlmKCF0YXJnZXQpe1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGlmKGlzTGlzdCh0YXJnZXQpKXtcclxuICAgICAgICB2YXIgaSA9IC0xO1xyXG5cclxuICAgICAgICB3aGlsZSAodGFyZ2V0W2krK10gJiYgaXNWaXNpYmxlKHRhcmdldFtpXSkpIHt9XHJcbiAgICAgICAgcmV0dXJuIHRhcmdldC5sZW5ndGggPj0gaTtcclxuICAgIH1cclxuICAgIHdoaWxlKHRhcmdldC5wYXJlbnROb2RlICYmIHRhcmdldC5zdHlsZS5kaXNwbGF5ICE9PSAnbm9uZScpe1xyXG4gICAgICAgIHRhcmdldCA9IHRhcmdldC5wYXJlbnROb2RlO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB0YXJnZXQgPT09IGRvYy5kb2N1bWVudDtcclxufVxyXG5cclxuLyoqXHJcblxyXG4gICAgIyMgLmluZGV4T2ZFbGVtZW50XHJcblxyXG4gICAgcmV0dXJucyB0aGUgaW5kZXggb2YgdGhlIGVsZW1lbnQgd2l0aGluIGl0J3MgcGFyZW50IGVsZW1lbnQuXHJcblxyXG4gICAgICAgIC8vZmx1ZW50XHJcbiAgICAgICAgZG9jKHRhcmdldCkuaW5kZXhPZkVsZW1lbnQoKTtcclxuXHJcbiAgICAgICAgLy9sZWdhY3lcclxuICAgICAgICBkb2MuaW5kZXhPZkVsZW1lbnQodGFyZ2V0KTtcclxuXHJcbiovXHJcblxyXG5mdW5jdGlvbiBpbmRleE9mRWxlbWVudCh0YXJnZXQpIHtcclxuICAgIHRhcmdldCA9IGdldFRhcmdldHModGFyZ2V0KTtcclxuICAgIGlmKCF0YXJnZXQpe1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZihpc0xpc3QodGFyZ2V0KSl7XHJcbiAgICAgICAgdGFyZ2V0ID0gdGFyZ2V0WzBdO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBpID0gLTE7XHJcblxyXG4gICAgdmFyIHBhcmVudCA9IHRhcmdldC5wYXJlbnRFbGVtZW50O1xyXG5cclxuICAgIGlmKCFwYXJlbnQpe1xyXG4gICAgICAgIHJldHVybiBpO1xyXG4gICAgfVxyXG5cclxuICAgIHdoaWxlKHBhcmVudC5jaGlsZHJlblsrK2ldICE9PSB0YXJnZXQpe31cclxuXHJcbiAgICByZXR1cm4gaTtcclxufVxyXG5cclxuXHJcbi8qKlxyXG5cclxuICAgICMjIC5yZWFkeVxyXG5cclxuICAgIGNhbGwgYSBjYWxsYmFjayB3aGVuIHRoZSBkb2N1bWVudCBpcyByZWFkeS5cclxuXHJcbiAgICByZXR1cm5zIC0xIGlmIHRoZXJlIGlzIG5vIHBhcmVudEVsZW1lbnQgb24gdGhlIHRhcmdldC5cclxuXHJcbiAgICAgICAgLy9mbHVlbnRcclxuICAgICAgICBkb2MoKS5yZWFkeShjYWxsYmFjayk7XHJcblxyXG4gICAgICAgIC8vbGVnYWN5XHJcbiAgICAgICAgZG9jLnJlYWR5KGNhbGxiYWNrKTtcclxuKi9cclxuXHJcbmZ1bmN0aW9uIHJlYWR5KGNhbGxiYWNrKXtcclxuICAgIGlmKGRvYy5kb2N1bWVudCAmJiAoZG9jLmRvY3VtZW50LnJlYWR5U3RhdGUgPT09ICdjb21wbGV0ZScgfHwgZG9jLmRvY3VtZW50LnJlYWR5U3RhdGUgPT09ICdpbnRlcmFjdGl2ZScpKXtcclxuICAgICAgICBjYWxsYmFjaygpO1xyXG4gICAgfWVsc2UgaWYod2luZG93LmF0dGFjaEV2ZW50KXtcclxuICAgICAgICBkb2N1bWVudC5hdHRhY2hFdmVudChcIm9ucmVhZHlzdGF0ZWNoYW5nZVwiLCBjYWxsYmFjayk7XHJcbiAgICAgICAgd2luZG93LmF0dGFjaEV2ZW50KFwib25Mb2FkXCIsY2FsbGJhY2spO1xyXG4gICAgfWVsc2UgaWYoZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcil7XHJcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcIkRPTUNvbnRlbnRMb2FkZWRcIixjYWxsYmFjayxmYWxzZSk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmRvYy5maW5kID0gZmluZDtcclxuZG9jLmZpbmRPbmUgPSBmaW5kT25lO1xyXG5kb2MuY2xvc2VzdCA9IGNsb3Nlc3Q7XHJcbmRvYy5pcyA9IGlzO1xyXG5kb2MuYWRkQ2xhc3MgPSBhZGRDbGFzcztcclxuZG9jLnJlbW92ZUNsYXNzID0gcmVtb3ZlQ2xhc3M7XHJcbmRvYy5vZmYgPSBvZmY7XHJcbmRvYy5vbiA9IG9uO1xyXG5kb2MuYXBwZW5kID0gYXBwZW5kO1xyXG5kb2MucHJlcGVuZCA9IHByZXBlbmQ7XHJcbmRvYy5pc1Zpc2libGUgPSBpc1Zpc2libGU7XHJcbmRvYy5yZWFkeSA9IHJlYWR5O1xyXG5kb2MuaW5kZXhPZkVsZW1lbnQgPSBpbmRleE9mRWxlbWVudDtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gZG9jOyIsInZhciBkb2MgPSByZXF1aXJlKCcuL2RvYycpLFxyXG4gICAgaXNMaXN0ID0gcmVxdWlyZSgnLi9pc0xpc3QnKSxcclxuICAgIGdldFRhcmdldHMgPSByZXF1aXJlKCcuL2dldFRhcmdldHMnKShkb2MuZG9jdW1lbnQpLFxyXG4gICAgZmxvY1Byb3RvID0gW107XHJcblxyXG5mdW5jdGlvbiBGbG9jKGl0ZW1zKXtcclxuICAgIHRoaXMucHVzaC5hcHBseSh0aGlzLCBpdGVtcyk7XHJcbn1cclxuRmxvYy5wcm90b3R5cGUgPSBmbG9jUHJvdG87XHJcbmZsb2NQcm90by5jb25zdHJ1Y3RvciA9IEZsb2M7XHJcblxyXG5mdW5jdGlvbiBmbG9jKHRhcmdldCl7XHJcbiAgICB2YXIgaW5zdGFuY2UgPSBnZXRUYXJnZXRzKHRhcmdldCk7XHJcblxyXG4gICAgaWYoIWlzTGlzdChpbnN0YW5jZSkpe1xyXG4gICAgICAgIGlmKGluc3RhbmNlKXtcclxuICAgICAgICAgICAgaW5zdGFuY2UgPSBbaW5zdGFuY2VdO1xyXG4gICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICBpbnN0YW5jZSA9IFtdO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBuZXcgRmxvYyhpbnN0YW5jZSk7XHJcbn1cclxuXHJcbnZhciByZXR1cm5zU2VsZiA9ICdhZGRDbGFzcyByZW1vdmVDbGFzcyBhcHBlbmQgcHJlcGVuZCcuc3BsaXQoJyAnKTtcclxuXHJcbmZvcih2YXIga2V5IGluIGRvYyl7XHJcbiAgICBpZih0eXBlb2YgZG9jW2tleV0gPT09ICdmdW5jdGlvbicpe1xyXG4gICAgICAgIGZsb2Nba2V5XSA9IGRvY1trZXldO1xyXG4gICAgICAgIGZsb2NQcm90b1trZXldID0gKGZ1bmN0aW9uKGtleSl7XHJcbiAgICAgICAgICAgIHZhciBpbnN0YW5jZSA9IHRoaXM7XHJcbiAgICAgICAgICAgIC8vIFRoaXMgaXMgYWxzbyBleHRyZW1lbHkgZG9kZ3kgYW5kIGZhc3RcclxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKGEsYixjLGQsZSxmKXtcclxuICAgICAgICAgICAgICAgIHZhciByZXN1bHQgPSBkb2Nba2V5XSh0aGlzLCBhLGIsYyxkLGUsZik7XHJcblxyXG4gICAgICAgICAgICAgICAgaWYocmVzdWx0ICE9PSBkb2MgJiYgaXNMaXN0KHJlc3VsdCkpe1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmbG9jKHJlc3VsdCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZihyZXR1cm5zU2VsZi5pbmRleE9mKGtleSkgPj0wKXtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gaW5zdGFuY2U7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0oa2V5KSk7XHJcbiAgICB9XHJcbn1cclxuZmxvY1Byb3RvLm9uID0gZnVuY3Rpb24oZXZlbnRzLCB0YXJnZXQsIGNhbGxiYWNrKXtcclxuICAgIHZhciBwcm94eSA9IHRoaXM7XHJcbiAgICBpZih0eXBlb2YgdGFyZ2V0ID09PSAnZnVuY3Rpb24nKXtcclxuICAgICAgICBjYWxsYmFjayA9IHRhcmdldDtcclxuICAgICAgICB0YXJnZXQgPSB0aGlzO1xyXG4gICAgICAgIHByb3h5ID0gbnVsbDtcclxuICAgIH1cclxuICAgIGRvYy5vbihldmVudHMsIHRhcmdldCwgY2FsbGJhY2ssIHByb3h5KTtcclxuICAgIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuZmxvY1Byb3RvLm9mZiA9IGZ1bmN0aW9uKGV2ZW50cywgdGFyZ2V0LCBjYWxsYmFjayl7XHJcbiAgICB2YXIgcmVmZXJlbmNlID0gdGhpcztcclxuICAgIGlmKHR5cGVvZiB0YXJnZXQgPT09ICdmdW5jdGlvbicpe1xyXG4gICAgICAgIGNhbGxiYWNrID0gdGFyZ2V0O1xyXG4gICAgICAgIHRhcmdldCA9IHRoaXM7XHJcbiAgICAgICAgcmVmZXJlbmNlID0gbnVsbDtcclxuICAgIH1cclxuICAgIGRvYy5vZmYoZXZlbnRzLCB0YXJnZXQsIGNhbGxiYWNrLCByZWZlcmVuY2UpO1xyXG4gICAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG5mbG9jUHJvdG8ucmVhZHkgPSBmdW5jdGlvbihjYWxsYmFjayl7XHJcbiAgICBkb2MucmVhZHkoY2FsbGJhY2spO1xyXG4gICAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG5mbG9jUHJvdG8uYWRkQ2xhc3MgPSBmdW5jdGlvbihjbGFzc05hbWUpe1xyXG4gICAgZG9jLmFkZENsYXNzKHRoaXMsIGNsYXNzTmFtZSk7XHJcbiAgICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbmZsb2NQcm90by5yZW1vdmVDbGFzcyA9IGZ1bmN0aW9uKGNsYXNzTmFtZSl7XHJcbiAgICBkb2MucmVtb3ZlQ2xhc3ModGhpcywgY2xhc3NOYW1lKTtcclxuICAgIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBmbG9jOyIsInZhciBzaW5nbGVJZCA9IC9eI1xcdyskLztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihkb2N1bWVudCl7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIGdldFRhcmdldCh0YXJnZXQpe1xuICAgICAgICBpZih0eXBlb2YgdGFyZ2V0ID09PSAnc3RyaW5nJyl7XG4gICAgICAgICAgICBpZihzaW5nbGVJZC5leGVjKHRhcmdldCkpe1xuICAgICAgICAgICAgICAgIHJldHVybiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCh0YXJnZXQuc2xpY2UoMSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IodGFyZ2V0KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0YXJnZXQ7XG4gICAgfTtcbn07IiwiXG52YXIgc2luZ2xlQ2xhc3MgPSAvXlxcLlxcdyskLyxcbiAgICBzaW5nbGVJZCA9IC9eI1xcdyskLyxcbiAgICBzaW5nbGVUYWcgPSAvXlxcdyskLztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihkb2N1bWVudCl7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIGdldFRhcmdldHModGFyZ2V0KXtcbiAgICAgICAgaWYodHlwZW9mIHRhcmdldCA9PT0gJ3N0cmluZycpe1xuICAgICAgICAgICAgaWYoc2luZ2xlSWQuZXhlYyh0YXJnZXQpKXtcbiAgICAgICAgICAgICAgICAvLyBJZiB5b3UgaGF2ZSBtb3JlIHRoYW4gMSBvZiB0aGUgc2FtZSBpZCBpbiB5b3VyIHBhZ2UsXG4gICAgICAgICAgICAgICAgLy8gdGhhdHMgeW91ciBvd24gc3R1cGlkIGZhdWx0LlxuICAgICAgICAgICAgICAgIHJldHVybiBbZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQodGFyZ2V0LnNsaWNlKDEpKV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihzaW5nbGVUYWcuZXhlYyh0YXJnZXQpKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUodGFyZ2V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKHNpbmdsZUNsYXNzLmV4ZWModGFyZ2V0KSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGRvY3VtZW50LmdldEVsZW1lbnRzQnlDbGFzc05hbWUodGFyZ2V0LnNsaWNlKDEpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKHRhcmdldCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGFyZ2V0O1xuICAgIH07XG59OyIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaXNMaXN0KG9iamVjdCl7XHJcbiAgICByZXR1cm4gb2JqZWN0ICE9IG51bGwgJiYgdHlwZW9mIG9iamVjdCA9PT0gJ29iamVjdCcgJiYgJ2xlbmd0aCcgaW4gb2JqZWN0ICYmICEoJ25vZGVUeXBlJyBpbiBvYmplY3QpICYmIG9iamVjdC5zZWxmICE9IG9iamVjdDsgLy8gaW4gSUU4LCB3aW5kb3cuc2VsZiBpcyB3aW5kb3csIGJ1dCBpdCBpcyBub3QgPT09IHdpbmRvdywgYnV0IGl0IGlzID09IHdpbmRvdy4uLi4uLi4uLiBXVEYhP1xyXG59IiwidmFyIGlzID0gcmVxdWlyZSgnLi9pcycpLFxuICAgIEdFTkVSSUMgPSAnX2dlbmVyaWMnLFxuICAgIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcixcbiAgICBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcblxuZnVuY3Rpb24gZmxhdHRlbihpdGVtKXtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShpdGVtKSA/IGl0ZW0ucmVkdWNlKGZ1bmN0aW9uKHJlc3VsdCwgZWxlbWVudCl7XG4gICAgICAgIGlmKGVsZW1lbnQgPT0gbnVsbCl7XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQuY29uY2F0KGZsYXR0ZW4oZWxlbWVudCkpO1xuICAgIH0sW10pIDogaXRlbTtcbn1cblxuZnVuY3Rpb24gYXR0YWNoUHJvcGVydGllcyhvYmplY3QsIGZpcm0pe1xuICAgIGZvcih2YXIga2V5IGluIHRoaXMuX3Byb3BlcnRpZXMpe1xuICAgICAgICB0aGlzLl9wcm9wZXJ0aWVzW2tleV0uYXR0YWNoKG9iamVjdCwgZmlybSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBvblJlbmRlcigpe1xuXG4gICAgLy8gRW5zdXJlIGFsbCBiaW5kaW5ncyBhcmUgc29tZXdoYXQgYXR0YWNoZWQganVzdCBiZWZvcmUgcmVuZGVyaW5nXG4gICAgdGhpcy5hdHRhY2godW5kZWZpbmVkLCAwKTtcblxuICAgIGZvcih2YXIga2V5IGluIHRoaXMuX3Byb3BlcnRpZXMpe1xuICAgICAgICB0aGlzLl9wcm9wZXJ0aWVzW2tleV0udXBkYXRlKCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBkZXRhY2hQcm9wZXJ0aWVzKGZpcm0pe1xuICAgIGZvcih2YXIga2V5IGluIHRoaXMuX3Byb3BlcnRpZXMpe1xuICAgICAgICB0aGlzLl9wcm9wZXJ0aWVzW2tleV0uZGV0YWNoKGZpcm0pO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZGVzdHJveVByb3BlcnRpZXMoKXtcbiAgICBmb3IodmFyIGtleSBpbiB0aGlzLl9wcm9wZXJ0aWVzKXtcbiAgICAgICAgdGhpcy5fcHJvcGVydGllc1trZXldLmRlc3Ryb3koKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNsb25lKCl7XG4gICAgcmV0dXJuIHRoaXMuZmFzdG4odGhpcy5jb21wb25lbnQuX3R5cGUsIHRoaXMuY29tcG9uZW50Ll9zZXR0aW5ncywgdGhpcy5jb21wb25lbnQuX2NoaWxkcmVuLmZpbHRlcihmdW5jdGlvbihjaGlsZCl7XG4gICAgICAgICAgICByZXR1cm4gIWNoaWxkLl90ZW1wbGF0ZWQ7XG4gICAgICAgIH0pLm1hcChmdW5jdGlvbihjaGlsZCl7XG4gICAgICAgICAgICByZXR1cm4gY2hpbGQuY2xvbmUoKTtcbiAgICAgICAgfSlcbiAgICApO1xufVxuXG5mdW5jdGlvbiBnZXRTZXRCaW5kaW5nKG5ld0JpbmRpbmcpe1xuICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuYmluZGluZztcbiAgICB9XG5cbiAgICBpZighaXMuYmluZGluZyhuZXdCaW5kaW5nKSl7XG4gICAgICAgIG5ld0JpbmRpbmcgPSB0aGlzLmZhc3RuLmJpbmRpbmcobmV3QmluZGluZyk7XG4gICAgfVxuXG4gICAgaWYodGhpcy5iaW5kaW5nICYmIHRoaXMuYmluZGluZyAhPT0gbmV3QmluZGluZyl7XG4gICAgICAgIHRoaXMuYmluZGluZy5yZW1vdmVMaXN0ZW5lcignY2hhbmdlJywgdGhpcy5lbWl0QXR0YWNoKTtcbiAgICAgICAgbmV3QmluZGluZy5hdHRhY2godGhpcy5iaW5kaW5nLl9tb2RlbCwgdGhpcy5iaW5kaW5nLl9maXJtKTtcbiAgICB9XG5cbiAgICB0aGlzLmJpbmRpbmcgPSBuZXdCaW5kaW5nO1xuXG4gICAgdGhpcy5iaW5kaW5nLm9uKCdjaGFuZ2UnLCB0aGlzLmVtaXRBdHRhY2gpO1xuICAgIHRoaXMuYmluZGluZy5vbignZGV0YWNoJywgdGhpcy5lbWl0RGV0YWNoKTtcblxuICAgIHRoaXMuZW1pdEF0dGFjaCgpO1xuXG4gICAgcmV0dXJuIHRoaXMuY29tcG9uZW50O1xufTtcblxuZnVuY3Rpb24gZW1pdEF0dGFjaCgpe1xuICAgIHZhciBuZXdCb3VuZCA9IHRoaXMuYmluZGluZygpO1xuICAgIGlmKG5ld0JvdW5kICE9PSB0aGlzLmxhc3RCb3VuZCl7XG4gICAgICAgIHRoaXMubGFzdEJvdW5kID0gbmV3Qm91bmQ7XG4gICAgICAgIHRoaXMuc2NvcGUuYXR0YWNoKHRoaXMubGFzdEJvdW5kKTtcbiAgICAgICAgdGhpcy5jb21wb25lbnQuZW1pdCgnYXR0YWNoJywgdGhpcy5zY29wZSwgMSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBlbWl0RGV0YWNoKCl7XG4gICAgdGhpcy5jb21wb25lbnQuZW1pdCgnZGV0YWNoJywgMSk7XG59XG5cbmZ1bmN0aW9uIGdldFNjb3BlKCl7XG4gICAgcmV0dXJuIHRoaXMuc2NvcGU7XG59XG5cbmZ1bmN0aW9uIGRlc3Ryb3koKXtcbiAgICBpZih0aGlzLmRlc3Ryb3llZCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5kZXN0cm95ZWQgPSB0cnVlO1xuXG4gICAgdGhpcy5jb21wb25lbnRcbiAgICAgICAgLnJlbW92ZUFsbExpc3RlbmVycygncmVuZGVyJylcbiAgICAgICAgLnJlbW92ZUFsbExpc3RlbmVycygnYXR0YWNoJyk7XG5cbiAgICB0aGlzLmNvbXBvbmVudC5lbWl0KCdkZXN0cm95Jyk7XG4gICAgdGhpcy5jb21wb25lbnQuZWxlbWVudCA9IG51bGw7XG4gICAgdGhpcy5zY29wZS5kZXN0cm95KCk7XG4gICAgdGhpcy5iaW5kaW5nLmRlc3Ryb3koKTtcblxuICAgIHJldHVybiB0aGlzLmNvbXBvbmVudDtcbn1cblxuZnVuY3Rpb24gYXR0YWNoQ29tcG9uZW50KG9iamVjdCwgZmlybSl7XG4gICAgdGhpcy5iaW5kaW5nLmF0dGFjaChvYmplY3QsIGZpcm0pO1xuICAgIHJldHVybiB0aGlzLmNvbXBvbmVudDtcbn1cblxuZnVuY3Rpb24gZGV0YWNoQ29tcG9uZW50KGZpcm0pe1xuICAgIHRoaXMuYmluZGluZy5kZXRhY2goZmlybSk7XG4gICAgcmV0dXJuIHRoaXMuY29tcG9uZW50O1xufVxuXG5mdW5jdGlvbiBpc0Rlc3Ryb3llZCgpe1xuICAgIHJldHVybiB0aGlzLmRlc3Ryb3llZDtcbn1cblxuZnVuY3Rpb24gc2V0UHJvcGVydHkoa2V5LCBwcm9wZXJ0eSl7XG5cbiAgICAvLyBBZGQgYSBkZWZhdWx0IHByb3BlcnR5IG9yIHVzZSB0aGUgb25lIGFscmVhZHkgdGhlcmVcbiAgICBpZighcHJvcGVydHkpe1xuICAgICAgICBwcm9wZXJ0eSA9IHRoaXMuY29tcG9uZW50W2tleV0gfHwgdGhpcy5mYXN0bi5wcm9wZXJ0eSgpO1xuICAgIH1cblxuICAgIHRoaXMuY29tcG9uZW50W2tleV0gPSBwcm9wZXJ0eTtcbiAgICB0aGlzLmNvbXBvbmVudC5fcHJvcGVydGllc1trZXldID0gcHJvcGVydHk7XG5cbiAgICByZXR1cm4gdGhpcy5jb21wb25lbnQ7XG59XG5cbmZ1bmN0aW9uIGV4dGVuZENvbXBvbmVudCh0eXBlLCBzZXR0aW5ncywgY2hpbGRyZW4pe1xuXG4gICAgaWYodHlwZSBpbiB0aGlzLnR5cGVzKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29tcG9uZW50O1xuICAgIH1cblxuICAgIGlmKCEodHlwZSBpbiB0aGlzLmZhc3RuLmNvbXBvbmVudHMpKXtcblxuICAgICAgICBpZighKEdFTkVSSUMgaW4gdGhpcy5mYXN0bi5jb21wb25lbnRzKSl7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIGNvbXBvbmVudCBvZiB0eXBlIFwiJyArIHR5cGUgKyAnXCIgaXMgbG9hZGVkJyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmZhc3RuLmNvbXBvbmVudHMuX2dlbmVyaWModGhpcy5mYXN0biwgdGhpcy5jb21wb25lbnQsIHR5cGUsIHNldHRpbmdzLCBjaGlsZHJlbik7XG5cbiAgICAgICAgdGhpcy50eXBlcy5fZ2VuZXJpYyA9IHRydWU7XG4gICAgfWVsc2V7XG5cbiAgICAgICAgdGhpcy5mYXN0bi5jb21wb25lbnRzW3R5cGVdKHRoaXMuZmFzdG4sIHRoaXMuY29tcG9uZW50LCB0eXBlLCBzZXR0aW5ncywgY2hpbGRyZW4pO1xuICAgIH1cblxuICAgIHRoaXMudHlwZXNbdHlwZV0gPSB0cnVlO1xuXG4gICAgcmV0dXJuIHRoaXMuY29tcG9uZW50O1xufTtcblxuZnVuY3Rpb24gaXNUeXBlKHR5cGUpe1xuICAgIHJldHVybiB0eXBlIGluIHRoaXMudHlwZXM7XG59XG5cbmZ1bmN0aW9uIEZhc3RuQ29tcG9uZW50KGZhc3RuLCB0eXBlLCBzZXR0aW5ncywgY2hpbGRyZW4pe1xuICAgIHZhciBjb21wb25lbnQgPSB0aGlzO1xuXG4gICAgdmFyIGNvbXBvbmVudFNjb3BlID0ge1xuICAgICAgICB0eXBlczoge30sXG4gICAgICAgIGZhc3RuOiBmYXN0bixcbiAgICAgICAgY29tcG9uZW50OiBjb21wb25lbnQsXG4gICAgICAgIGJpbmRpbmc6IGZhc3RuLmJpbmRpbmcoJy4nKSxcbiAgICAgICAgZGVzdHJveWVkOiBmYWxzZSxcbiAgICAgICAgc2NvcGU6IG5ldyBmYXN0bi5Nb2RlbChmYWxzZSksXG4gICAgICAgIGxhc3RCb3VuZDogbnVsbFxuICAgIH07XG5cbiAgICBjb21wb25lbnRTY29wZS5lbWl0QXR0YWNoID0gZW1pdEF0dGFjaC5iaW5kKGNvbXBvbmVudFNjb3BlKTtcbiAgICBjb21wb25lbnRTY29wZS5lbWl0RGV0YWNoID0gZW1pdERldGFjaC5iaW5kKGNvbXBvbmVudFNjb3BlKTtcbiAgICBjb21wb25lbnRTY29wZS5iaW5kaW5nLl9kZWZhdWx0X2JpbmRpbmcgPSB0cnVlO1xuXG4gICAgY29tcG9uZW50Ll90eXBlID0gdHlwZTtcbiAgICBjb21wb25lbnQuX3Byb3BlcnRpZXMgPSB7fTtcbiAgICBjb21wb25lbnQuX3NldHRpbmdzID0gc2V0dGluZ3MgfHwge307XG4gICAgY29tcG9uZW50Ll9jaGlsZHJlbiA9IGNoaWxkcmVuID8gZmxhdHRlbihjaGlsZHJlbikgOiBbXTtcblxuICAgIGNvbXBvbmVudC5hdHRhY2ggPSBhdHRhY2hDb21wb25lbnQuYmluZChjb21wb25lbnRTY29wZSk7XG4gICAgY29tcG9uZW50LmRldGFjaCA9IGRldGFjaENvbXBvbmVudC5iaW5kKGNvbXBvbmVudFNjb3BlKTtcbiAgICBjb21wb25lbnQuc2NvcGUgPSBnZXRTY29wZS5iaW5kKGNvbXBvbmVudFNjb3BlKTtcbiAgICBjb21wb25lbnQuZGVzdHJveSA9IGRlc3Ryb3kuYmluZChjb21wb25lbnRTY29wZSk7XG4gICAgY29tcG9uZW50LmRlc3Ryb3llZCA9IGlzRGVzdHJveWVkLmJpbmQoY29tcG9uZW50U2NvcGUpO1xuICAgIGNvbXBvbmVudC5iaW5kaW5nID0gZ2V0U2V0QmluZGluZy5iaW5kKGNvbXBvbmVudFNjb3BlKTtcbiAgICBjb21wb25lbnQuc2V0UHJvcGVydHkgPSBzZXRQcm9wZXJ0eS5iaW5kKGNvbXBvbmVudFNjb3BlKTtcbiAgICBjb21wb25lbnQuY2xvbmUgPSBjbG9uZS5iaW5kKGNvbXBvbmVudFNjb3BlKTtcbiAgICBjb21wb25lbnQuY2hpbGRyZW4gPSBzbGljZS5iaW5kKGNvbXBvbmVudC5fY2hpbGRyZW4pO1xuICAgIGNvbXBvbmVudC5leHRlbmQgPSBleHRlbmRDb21wb25lbnQuYmluZChjb21wb25lbnRTY29wZSk7XG4gICAgY29tcG9uZW50LmlzID0gaXNUeXBlLmJpbmQoY29tcG9uZW50U2NvcGUpO1xuXG4gICAgY29tcG9uZW50LmJpbmRpbmcoY29tcG9uZW50U2NvcGUuYmluZGluZyk7XG5cbiAgICBjb21wb25lbnQub24oJ2F0dGFjaCcsIGF0dGFjaFByb3BlcnRpZXMuYmluZCh0aGlzKSk7XG4gICAgY29tcG9uZW50Lm9uKCdyZW5kZXInLCBvblJlbmRlci5iaW5kKHRoaXMpKTtcbiAgICBjb21wb25lbnQub24oJ2RldGFjaCcsIGRldGFjaFByb3BlcnRpZXMuYmluZCh0aGlzKSk7XG4gICAgY29tcG9uZW50Lm9uKCdkZXN0cm95JywgZGVzdHJveVByb3BlcnRpZXMuYmluZCh0aGlzKSk7XG5cbiAgICBpZihmYXN0bi5kZWJ1Zyl7XG4gICAgICAgIGNvbXBvbmVudC5vbigncmVuZGVyJywgZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIGlmKGNvbXBvbmVudC5lbGVtZW50ICYmIHR5cGVvZiBjb21wb25lbnQuZWxlbWVudCA9PT0gJ29iamVjdCcpe1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudC5lbGVtZW50Ll9jb21wb25lbnQgPSBjb21wb25lbnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cbn1cbkZhc3RuQ29tcG9uZW50LnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRXZlbnRFbWl0dGVyLnByb3RvdHlwZSk7XG5GYXN0bkNvbXBvbmVudC5wcm90b3R5cGUuY29uc3RydWN0b3IgPSBGYXN0bkNvbXBvbmVudDtcbkZhc3RuQ29tcG9uZW50LnByb3RvdHlwZS5fZmFzdG5fY29tcG9uZW50ID0gdHJ1ZTtcblxubW9kdWxlLmV4cG9ydHMgPSBGYXN0bkNvbXBvbmVudDsiLCJ2YXIgRW50aSA9IHJlcXVpcmUoJ2VudGknKSxcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKSxcbiAgICBmaXJtZXIgPSByZXF1aXJlKCcuL2Zpcm1lcicpLFxuICAgIGZ1bmN0aW9uRW1pdHRlciA9IHJlcXVpcmUoJy4vZnVuY3Rpb25FbWl0dGVyJyksXG4gICAgc2V0UHJvdG90eXBlT2YgPSByZXF1aXJlKCdzZXRwcm90b3R5cGVvZicpLFxuICAgIHNhbWUgPSByZXF1aXJlKCdzYW1lLXZhbHVlJyk7XG5cbmZ1bmN0aW9uIGZ1c2VCaW5kaW5nKCl7XG4gICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xuXG4gICAgdmFyIGJpbmRpbmdzID0gYXJncy5zbGljZSgpLFxuICAgICAgICB0cmFuc2Zvcm0gPSBiaW5kaW5ncy5wb3AoKSxcbiAgICAgICAgdXBkYXRlVHJhbnNmb3JtLFxuICAgICAgICByZXN1bHRCaW5kaW5nID0gY3JlYXRlQmluZGluZygncmVzdWx0JyksXG4gICAgICAgIHNlbGZDaGFuZ2luZztcblxuICAgIHJlc3VsdEJpbmRpbmcuX2FyZ3VtZW50cyA9IGFyZ3M7XG5cbiAgICBpZih0eXBlb2YgYmluZGluZ3NbYmluZGluZ3MubGVuZ3RoLTFdID09PSAnZnVuY3Rpb24nICYmICFpcy5iaW5kaW5nKGJpbmRpbmdzW2JpbmRpbmdzLmxlbmd0aC0xXSkpe1xuICAgICAgICB1cGRhdGVUcmFuc2Zvcm0gPSB0cmFuc2Zvcm07XG4gICAgICAgIHRyYW5zZm9ybSA9IGJpbmRpbmdzLnBvcCgpO1xuICAgIH1cblxuICAgIHJlc3VsdEJpbmRpbmcuX21vZGVsLnJlbW92ZUFsbExpc3RlbmVycygpO1xuICAgIHJlc3VsdEJpbmRpbmcuX3NldCA9IGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgaWYodXBkYXRlVHJhbnNmb3JtKXtcbiAgICAgICAgICAgIHNlbGZDaGFuZ2luZyA9IHRydWU7XG4gICAgICAgICAgICB2YXIgbmV3VmFsdWUgPSB1cGRhdGVUcmFuc2Zvcm0odmFsdWUpO1xuICAgICAgICAgICAgaWYoIXNhbWUobmV3VmFsdWUsIGJpbmRpbmdzWzBdKCkpKXtcbiAgICAgICAgICAgICAgICBiaW5kaW5nc1swXShuZXdWYWx1ZSk7XG4gICAgICAgICAgICAgICAgcmVzdWx0QmluZGluZy5fY2hhbmdlKG5ld1ZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNlbGZDaGFuZ2luZyA9IGZhbHNlO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHJlc3VsdEJpbmRpbmcuX2NoYW5nZSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gY2hhbmdlKCl7XG4gICAgICAgIGlmKHNlbGZDaGFuZ2luZyl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgcmVzdWx0QmluZGluZyh0cmFuc2Zvcm0uYXBwbHkobnVsbCwgYmluZGluZ3MubWFwKGZ1bmN0aW9uKGJpbmRpbmcpe1xuICAgICAgICAgICAgcmV0dXJuIGJpbmRpbmcoKTtcbiAgICAgICAgfSkpKTtcbiAgICB9XG5cbiAgICBiaW5kaW5ncy5mb3JFYWNoKGZ1bmN0aW9uKGJpbmRpbmcsIGluZGV4KXtcbiAgICAgICAgaWYoIWlzLmJpbmRpbmcoYmluZGluZykpe1xuICAgICAgICAgICAgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoYmluZGluZyk7XG4gICAgICAgICAgICBiaW5kaW5ncy5zcGxpY2UoaW5kZXgsMSxiaW5kaW5nKTtcbiAgICAgICAgfVxuICAgICAgICBiaW5kaW5nLm9uKCdjaGFuZ2UnLCBjaGFuZ2UpO1xuICAgICAgICByZXN1bHRCaW5kaW5nLm9uKCdkZXRhY2gnLCBiaW5kaW5nLmRldGFjaCk7XG4gICAgfSk7XG5cbiAgICB2YXIgbGFzdEF0dGFjaGVkO1xuICAgIHJlc3VsdEJpbmRpbmcub24oJ2F0dGFjaCcsIGZ1bmN0aW9uKG9iamVjdCl7XG4gICAgICAgIHNlbGZDaGFuZ2luZyA9IHRydWU7XG4gICAgICAgIGJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZyl7XG4gICAgICAgICAgICBiaW5kaW5nLmF0dGFjaChvYmplY3QsIDEpO1xuICAgICAgICB9KTtcbiAgICAgICAgc2VsZkNoYW5naW5nID0gZmFsc2U7XG4gICAgICAgIGlmKGxhc3RBdHRhY2hlZCAhPT0gb2JqZWN0KXtcbiAgICAgICAgICAgIGNoYW5nZSgpO1xuICAgICAgICB9XG4gICAgICAgIGxhc3RBdHRhY2hlZCA9IG9iamVjdDtcbiAgICB9KTtcblxuICAgIHJldHVybiByZXN1bHRCaW5kaW5nO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVWYWx1ZUJpbmRpbmcoKXtcbiAgICB2YXIgdmFsdWVCaW5kaW5nID0gY3JlYXRlQmluZGluZygndmFsdWUnKTtcbiAgICB2YWx1ZUJpbmRpbmcuYXR0YWNoID0gZnVuY3Rpb24oKXtyZXR1cm4gdmFsdWVCaW5kaW5nO307XG4gICAgdmFsdWVCaW5kaW5nLmRldGFjaCA9IGZ1bmN0aW9uKCl7cmV0dXJuIHZhbHVlQmluZGluZzt9O1xuICAgIHJldHVybiB2YWx1ZUJpbmRpbmc7XG59XG5cbmZ1bmN0aW9uIGJpbmRpbmdUZW1wbGF0ZShuZXdWYWx1ZSl7XG4gICAgaWYoIWFyZ3VtZW50cy5sZW5ndGgpe1xuICAgICAgICByZXR1cm4gdGhpcy52YWx1ZTtcbiAgICB9XG5cbiAgICBpZih0aGlzLmJpbmRpbmcuX2Zhc3RuX2JpbmRpbmcgPT09ICcuJyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmJpbmRpbmcuX3NldChuZXdWYWx1ZSk7XG4gICAgcmV0dXJuIHRoaXMuYmluZGluZztcbn1cblxuZnVuY3Rpb24gY3JlYXRlQmluZGluZyhwYXRoLCBtb3JlKXtcblxuICAgIGlmKG1vcmUpeyAvLyB1c2VkIGluc3RlYWQgb2YgYXJndW1lbnRzLmxlbmd0aCBmb3IgcGVyZm9ybWFuY2VcbiAgICAgICAgcmV0dXJuIGZ1c2VCaW5kaW5nLmFwcGx5KG51bGwsIGFyZ3VtZW50cyk7XG4gICAgfVxuXG4gICAgaWYocGF0aCA9PSBudWxsKXtcbiAgICAgICAgcmV0dXJuIGNyZWF0ZVZhbHVlQmluZGluZygpO1xuICAgIH1cblxuICAgIHZhciBiaW5kaW5nU2NvcGUgPSB7fSxcbiAgICAgICAgYmluZGluZyA9IGJpbmRpbmdTY29wZS5iaW5kaW5nID0gYmluZGluZ1RlbXBsYXRlLmJpbmQoYmluZGluZ1Njb3BlKSxcbiAgICAgICAgZGVzdHJveWVkO1xuXG4gICAgc2V0UHJvdG90eXBlT2YoYmluZGluZywgZnVuY3Rpb25FbWl0dGVyKTtcbiAgICBiaW5kaW5nLnNldE1heExpc3RlbmVycygxMDAwMCk7XG4gICAgYmluZGluZy5fYXJndW1lbnRzID0gW3BhdGhdO1xuICAgIGJpbmRpbmcuX21vZGVsID0gbmV3IEVudGkoZmFsc2UpO1xuICAgIGJpbmRpbmcuX2Zhc3RuX2JpbmRpbmcgPSBwYXRoO1xuICAgIGJpbmRpbmcuX2Zpcm0gPSAtSW5maW5pdHk7XG5cbiAgICBmdW5jdGlvbiBtb2RlbEF0dGFjaEhhbmRsZXIoZGF0YSl7XG4gICAgICAgIGJpbmRpbmcuX21vZGVsLmF0dGFjaChkYXRhKTtcbiAgICAgICAgYmluZGluZy5fY2hhbmdlKGJpbmRpbmcuX21vZGVsLmdldChwYXRoKSk7XG4gICAgICAgIGJpbmRpbmcuZW1pdCgnYXR0YWNoJywgZGF0YSwgMSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbW9kZWxEZXRhY2hIYW5kbGVyKCl7XG4gICAgICAgIGJpbmRpbmcuX21vZGVsLmRldGFjaCgpO1xuICAgIH1cblxuICAgIGJpbmRpbmcuYXR0YWNoID0gZnVuY3Rpb24ob2JqZWN0LCBmaXJtKXtcblxuICAgICAgICAvLyBJZiB0aGUgYmluZGluZyBpcyBiZWluZyBhc2tlZCB0byBhdHRhY2ggbG9vc2x5IHRvIGFuIG9iamVjdCxcbiAgICAgICAgLy8gYnV0IGl0IGhhcyBhbHJlYWR5IGJlZW4gZGVmaW5lZCBhcyBiZWluZyBmaXJtbHkgYXR0YWNoZWQsIGRvIG5vdCBhdHRhY2guXG4gICAgICAgIGlmKGZpcm1lcihiaW5kaW5nLCBmaXJtKSl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICAgICAgfVxuXG4gICAgICAgIGJpbmRpbmcuX2Zpcm0gPSBmaXJtO1xuXG4gICAgICAgIHZhciBpc0VudGkgPSBFbnRpLmlzRW50aShvYmplY3QpO1xuXG4gICAgICAgIGlmKGlzRW50aSAmJiBiaW5kaW5nU2NvcGUuYXR0YWNoZWRNb2RlbCA9PT0gb2JqZWN0KXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYmluZGluZ1Njb3BlLmF0dGFjaGVkTW9kZWwpe1xuICAgICAgICAgICAgYmluZGluZ1Njb3BlLmF0dGFjaGVkTW9kZWwucmVtb3ZlTGlzdGVuZXIoJ2F0dGFjaCcsIG1vZGVsQXR0YWNoSGFuZGxlcik7XG4gICAgICAgICAgICBiaW5kaW5nU2NvcGUuYXR0YWNoZWRNb2RlbC5yZW1vdmVMaXN0ZW5lcignZGV0YWNoJywgbW9kZWxEZXRhY2hIYW5kbGVyKTtcbiAgICAgICAgICAgIGJpbmRpbmdTY29wZS5hdHRhY2hlZE1vZGVsID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGlzRW50aSl7XG4gICAgICAgICAgICBiaW5kaW5nU2NvcGUuYXR0YWNoZWRNb2RlbCA9IG9iamVjdDtcbiAgICAgICAgICAgIGJpbmRpbmdTY29wZS5hdHRhY2hlZE1vZGVsLm9uKCdhdHRhY2gnLCBtb2RlbEF0dGFjaEhhbmRsZXIpO1xuICAgICAgICAgICAgYmluZGluZ1Njb3BlLmF0dGFjaGVkTW9kZWwub24oJ2RldGFjaCcsIG1vZGVsRGV0YWNoSGFuZGxlcik7XG4gICAgICAgICAgICBvYmplY3QgPSBvYmplY3QuX21vZGVsO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIShvYmplY3QgaW5zdGFuY2VvZiBPYmplY3QpKXtcbiAgICAgICAgICAgIG9iamVjdCA9IHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYmluZGluZy5fbW9kZWwuX21vZGVsID09PSBvYmplY3Qpe1xuICAgICAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgICAgIH1cblxuICAgICAgICBtb2RlbEF0dGFjaEhhbmRsZXIob2JqZWN0KTtcblxuICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICB9O1xuXG4gICAgYmluZGluZy5kZXRhY2ggPSBmdW5jdGlvbihmaXJtKXtcbiAgICAgICAgaWYoZmlybWVyKGJpbmRpbmcsIGZpcm0pKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZ1Njb3BlLnZhbHVlID0gdW5kZWZpbmVkO1xuICAgICAgICBpZihiaW5kaW5nLl9tb2RlbC5pc0F0dGFjaGVkKCkpe1xuICAgICAgICAgICAgYmluZGluZy5fbW9kZWwuZGV0YWNoKCk7XG4gICAgICAgIH1cbiAgICAgICAgYmluZGluZy5lbWl0KCdkZXRhY2gnLCAxKTtcbiAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgfTtcbiAgICBiaW5kaW5nLl9zZXQgPSBmdW5jdGlvbihuZXdWYWx1ZSl7XG4gICAgICAgIGlmKHNhbWUoYmluZGluZy5fbW9kZWwuZ2V0KHBhdGgpLCBuZXdWYWx1ZSkpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmKCFiaW5kaW5nLl9tb2RlbC5pc0F0dGFjaGVkKCkpe1xuICAgICAgICAgICAgYmluZGluZy5fbW9kZWwuYXR0YWNoKGJpbmRpbmcuX21vZGVsLmdldCgnLicpKTtcbiAgICAgICAgfVxuICAgICAgICBiaW5kaW5nLl9tb2RlbC5zZXQocGF0aCwgbmV3VmFsdWUpO1xuICAgIH07XG4gICAgYmluZGluZy5fY2hhbmdlID0gZnVuY3Rpb24obmV3VmFsdWUpe1xuICAgICAgICBiaW5kaW5nU2NvcGUudmFsdWUgPSBuZXdWYWx1ZTtcbiAgICAgICAgYmluZGluZy5lbWl0KCdjaGFuZ2UnLCBiaW5kaW5nKCkpO1xuICAgIH07XG4gICAgYmluZGluZy5jbG9uZSA9IGZ1bmN0aW9uKGtlZXBBdHRhY2htZW50KXtcbiAgICAgICAgdmFyIG5ld0JpbmRpbmcgPSBjcmVhdGVCaW5kaW5nLmFwcGx5KG51bGwsIGJpbmRpbmcuX2FyZ3VtZW50cyk7XG5cbiAgICAgICAgaWYoa2VlcEF0dGFjaG1lbnQpe1xuICAgICAgICAgICAgbmV3QmluZGluZy5hdHRhY2goYmluZGluZ1Njb3BlLmF0dGFjaGVkTW9kZWwgfHwgYmluZGluZy5fbW9kZWwuX21vZGVsLCBiaW5kaW5nLl9maXJtKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBuZXdCaW5kaW5nO1xuICAgIH07XG4gICAgYmluZGluZy5kZXN0cm95ID0gZnVuY3Rpb24oc29mdCl7XG4gICAgICAgIGlmKGRlc3Ryb3llZCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYoc29mdCAmJiBiaW5kaW5nLmxpc3RlbmVycygnY2hhbmdlJykubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBkZXN0cm95ZWQgPSB0cnVlO1xuICAgICAgICBiaW5kaW5nLmVtaXQoJ2Rlc3Ryb3knKTtcbiAgICAgICAgYmluZGluZy5kZXRhY2goKTtcbiAgICAgICAgYmluZGluZy5fbW9kZWwuZGVzdHJveSgpO1xuICAgIH07XG5cbiAgICBiaW5kaW5nLmRlc3Ryb3llZCA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHJldHVybiBkZXN0cm95ZWQ7XG4gICAgfTtcblxuICAgIGlmKHBhdGggIT09ICcuJyl7XG4gICAgICAgIGJpbmRpbmcuX21vZGVsLm9uKHBhdGgsIGJpbmRpbmcuX2NoYW5nZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGJpbmRpbmc7XG59XG5cbmZ1bmN0aW9uIGZyb20odmFsdWVPckJpbmRpbmcpe1xuICAgIGlmKGlzLmJpbmRpbmcodmFsdWVPckJpbmRpbmcpKXtcbiAgICAgICAgcmV0dXJuIHZhbHVlT3JCaW5kaW5nO1xuICAgIH1cblxuICAgIHJldHVybiBjcmVhdGVCaW5kaW5nKCkodmFsdWVPckJpbmRpbmcpO1xufVxuXG5jcmVhdGVCaW5kaW5nLmZyb20gPSBmcm9tO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGNyZWF0ZUJpbmRpbmc7IiwiZnVuY3Rpb24gaW5zZXJ0Q2hpbGQoZmFzdG4sIGNvbnRhaW5lciwgY2hpbGQsIGluZGV4KXtcbiAgICB2YXIgY3VycmVudEluZGV4ID0gY29udGFpbmVyLl9jaGlsZHJlbi5pbmRleE9mKGNoaWxkKSxcbiAgICAgICAgbmV3Q29tcG9uZW50ID0gZmFzdG4udG9Db21wb25lbnQoY2hpbGQpO1xuXG4gICAgaWYobmV3Q29tcG9uZW50ICE9PSBjaGlsZCl7XG4gICAgICAgIGNvbnRhaW5lci5fY2hpbGRyZW4uc3BsaWNlKGN1cnJlbnRJbmRleCwgMSwgbmV3Q29tcG9uZW50KTtcbiAgICB9XG5cbiAgICBpZighfmN1cnJlbnRJbmRleCB8fCBuZXdDb21wb25lbnQgIT09IGNoaWxkKXtcbiAgICAgICAgbmV3Q29tcG9uZW50LmF0dGFjaChjb250YWluZXIuc2NvcGUoKSwgMSk7XG4gICAgfVxuXG4gICAgaWYoY3VycmVudEluZGV4ICE9PSBpbmRleCl7XG4gICAgICAgIGlmKH5jdXJyZW50SW5kZXgpe1xuICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbi5zcGxpY2UoY3VycmVudEluZGV4LCAxKTtcbiAgICAgICAgfVxuICAgICAgICBjb250YWluZXIuX2NoaWxkcmVuLnNwbGljZShpbmRleCwgMCwgbmV3Q29tcG9uZW50KTtcbiAgICB9XG5cbiAgICBpZihjb250YWluZXIuZWxlbWVudCl7XG4gICAgICAgIGlmKCFuZXdDb21wb25lbnQuZWxlbWVudCl7XG4gICAgICAgICAgICBuZXdDb21wb25lbnQucmVuZGVyKCk7XG4gICAgICAgIH1cbiAgICAgICAgY29udGFpbmVyLl9pbnNlcnQobmV3Q29tcG9uZW50LmVsZW1lbnQsIGluZGV4KTtcbiAgICAgICAgbmV3Q29tcG9uZW50LmVtaXQoJ2luc2VydCcsIGNvbnRhaW5lcik7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBnZXRDb250YWluZXJFbGVtZW50KCl7XG4gICAgcmV0dXJuIHRoaXMuY29udGFpbmVyRWxlbWVudCB8fCB0aGlzLmVsZW1lbnQ7XG59XG5cbmZ1bmN0aW9uIGluc2VydChjaGlsZCwgaW5kZXgpe1xuICAgIHZhciBjaGlsZENvbXBvbmVudCA9IGNoaWxkLFxuICAgICAgICBjb250YWluZXIgPSB0aGlzLmNvbnRhaW5lcixcbiAgICAgICAgZmFzdG4gPSB0aGlzLmZhc3RuO1xuXG4gICAgaWYoaW5kZXggJiYgdHlwZW9mIGluZGV4ID09PSAnb2JqZWN0Jyl7XG4gICAgICAgIGNoaWxkQ29tcG9uZW50ID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKTtcbiAgICB9XG5cbiAgICBpZihpc05hTihpbmRleCkpe1xuICAgICAgICBpbmRleCA9IGNvbnRhaW5lci5fY2hpbGRyZW4ubGVuZ3RoO1xuICAgIH1cblxuICAgIGlmKEFycmF5LmlzQXJyYXkoY2hpbGRDb21wb25lbnQpKXtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGlsZENvbXBvbmVudC5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY29udGFpbmVyLmluc2VydChjaGlsZENvbXBvbmVudFtpXSwgaSArIGluZGV4KTtcbiAgICAgICAgfVxuICAgIH1lbHNle1xuICAgICAgICBpbnNlcnRDaGlsZChmYXN0biwgY29udGFpbmVyLCBjaGlsZENvbXBvbmVudCwgaW5kZXgpO1xuICAgIH1cblxuICAgIHJldHVybiBjb250YWluZXI7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZmFzdG4sIGNvbXBvbmVudCwgdHlwZSwgc2V0dGluZ3MsIGNoaWxkcmVuKXtcbiAgICBjb21wb25lbnQuaW5zZXJ0ID0gaW5zZXJ0LmJpbmQoe1xuICAgICAgICBjb250YWluZXI6IGNvbXBvbmVudCxcbiAgICAgICAgZmFzdG46IGZhc3RuXG4gICAgfSk7XG5cbiAgICBjb21wb25lbnQuX2luc2VydCA9IGZ1bmN0aW9uKGVsZW1lbnQsIGluZGV4KXtcbiAgICAgICAgdmFyIGNvbnRhaW5lckVsZW1lbnQgPSBjb21wb25lbnQuZ2V0Q29udGFpbmVyRWxlbWVudCgpO1xuICAgICAgICBpZighY29udGFpbmVyRWxlbWVudCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZihjb250YWluZXJFbGVtZW50LmNoaWxkTm9kZXNbaW5kZXhdID09PSBlbGVtZW50KXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnRhaW5lckVsZW1lbnQuaW5zZXJ0QmVmb3JlKGVsZW1lbnQsIGNvbnRhaW5lckVsZW1lbnQuY2hpbGROb2Rlc1tpbmRleF0pO1xuICAgIH07XG5cbiAgICBjb21wb25lbnQucmVtb3ZlID0gZnVuY3Rpb24oY2hpbGRDb21wb25lbnQpe1xuICAgICAgICB2YXIgaW5kZXggPSBjb21wb25lbnQuX2NoaWxkcmVuLmluZGV4T2YoY2hpbGRDb21wb25lbnQpO1xuICAgICAgICBpZih+aW5kZXgpe1xuICAgICAgICAgICAgY29tcG9uZW50Ll9jaGlsZHJlbi5zcGxpY2UoaW5kZXgsMSk7XG4gICAgICAgIH1cblxuICAgICAgICBjaGlsZENvbXBvbmVudC5kZXRhY2goMSk7XG5cbiAgICAgICAgaWYoY2hpbGRDb21wb25lbnQuZWxlbWVudCl7XG4gICAgICAgICAgICBjb21wb25lbnQuX3JlbW92ZShjaGlsZENvbXBvbmVudC5lbGVtZW50KTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBjb21wb25lbnQuX3JlbW92ZSA9IGZ1bmN0aW9uKGVsZW1lbnQpe1xuICAgICAgICB2YXIgY29udGFpbmVyRWxlbWVudCA9IGNvbXBvbmVudC5nZXRDb250YWluZXJFbGVtZW50KCk7XG5cbiAgICAgICAgaWYoIWVsZW1lbnQgfHwgIWNvbnRhaW5lckVsZW1lbnQgfHwgZWxlbWVudC5wYXJlbnROb2RlICE9PSBjb250YWluZXJFbGVtZW50KXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnRhaW5lckVsZW1lbnQucmVtb3ZlQ2hpbGQoZWxlbWVudCk7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5lbXB0eSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHdoaWxlKGNvbXBvbmVudC5fY2hpbGRyZW4ubGVuZ3RoKXtcbiAgICAgICAgICAgIGNvbXBvbmVudC5yZW1vdmUoY29tcG9uZW50Ll9jaGlsZHJlbi5wb3AoKSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgY29tcG9uZW50LnJlcGxhY2VDaGlsZCA9IGZ1bmN0aW9uKG9sZENoaWxkLCBuZXdDaGlsZCl7XG4gICAgICAgIHZhciBpbmRleCA9IGNvbXBvbmVudC5fY2hpbGRyZW4uaW5kZXhPZihvbGRDaGlsZCk7XG5cbiAgICAgICAgaWYoIX5pbmRleCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb21wb25lbnQucmVtb3ZlKG9sZENoaWxkKTtcbiAgICAgICAgY29tcG9uZW50Lmluc2VydChuZXdDaGlsZCwgaW5kZXgpO1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuZ2V0Q29udGFpbmVyRWxlbWVudCA9IGdldENvbnRhaW5lckVsZW1lbnQuYmluZChjb21wb25lbnQpO1xuXG4gICAgY29tcG9uZW50Lm9uKCdyZW5kZXInLCBjb21wb25lbnQuaW5zZXJ0LmJpbmQobnVsbCwgY29tcG9uZW50Ll9jaGlsZHJlbiwgMCkpO1xuXG4gICAgY29tcG9uZW50Lm9uKCdhdHRhY2gnLCBmdW5jdGlvbihtb2RlbCwgZmlybSl7XG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBjb21wb25lbnQuX2NoaWxkcmVuLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIGlmKGZhc3RuLmlzQ29tcG9uZW50KGNvbXBvbmVudC5fY2hpbGRyZW5baV0pKXtcbiAgICAgICAgICAgICAgICBjb21wb25lbnQuX2NoaWxkcmVuW2ldLmF0dGFjaChtb2RlbCwgZmlybSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbXBvbmVudC5vbignZGVzdHJveScsIGZ1bmN0aW9uKGRhdGEsIGZpcm0pe1xuICAgICAgICBmb3IodmFyIGkgPSAwOyBpIDwgY29tcG9uZW50Ll9jaGlsZHJlbi5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudChjb21wb25lbnQuX2NoaWxkcmVuW2ldKSl7XG4gICAgICAgICAgICAgICAgY29tcG9uZW50Ll9jaGlsZHJlbltpXS5kZXN0cm95KGZpcm0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gY29tcG9uZW50O1xufTsiLCJ2YXIgc2V0aWZ5ID0gcmVxdWlyZSgnc2V0aWZ5JyksXG4gICAgY2xhc3Npc3QgPSByZXF1aXJlKCdjbGFzc2lzdCcpO1xuXG5mdW5jdGlvbiB1cGRhdGVUZXh0UHJvcGVydHkoZ2VuZXJpYywgZWxlbWVudCwgdmFsdWUpe1xuICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICByZXR1cm4gZWxlbWVudC50ZXh0Q29udGVudDtcbiAgICB9XG4gICAgZWxlbWVudC50ZXh0Q29udGVudCA9ICh2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGNsYXNzOiBmdW5jdGlvbihnZW5lcmljLCBlbGVtZW50LCB2YWx1ZSl7XG4gICAgICAgIGlmKCFnZW5lcmljLl9jbGFzc2lzdCl7XG4gICAgICAgICAgICBnZW5lcmljLl9jbGFzc2lzdCA9IGNsYXNzaXN0KGVsZW1lbnQpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA8IDMpe1xuICAgICAgICAgICAgcmV0dXJuIGdlbmVyaWMuX2NsYXNzaXN0KCk7XG4gICAgICAgIH1cblxuICAgICAgICBnZW5lcmljLl9jbGFzc2lzdCh2YWx1ZSk7XG4gICAgfSxcbiAgICBkaXNwbGF5OiBmdW5jdGlvbihnZW5lcmljLCBlbGVtZW50LCB2YWx1ZSl7XG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQuc3R5bGUuZGlzcGxheSAhPT0gJ25vbmUnO1xuICAgICAgICB9XG4gICAgICAgIGVsZW1lbnQuc3R5bGUuZGlzcGxheSA9IHZhbHVlID8gbnVsbCA6ICdub25lJztcbiAgICB9LFxuICAgIGRpc2FibGVkOiBmdW5jdGlvbihnZW5lcmljLCBlbGVtZW50LCB2YWx1ZSl7XG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQuaGFzQXR0cmlidXRlKCdkaXNhYmxlZCcpO1xuICAgICAgICB9XG4gICAgICAgIGlmKHZhbHVlKXtcbiAgICAgICAgICAgIGVsZW1lbnQuc2V0QXR0cmlidXRlKCdkaXNhYmxlZCcsICdkaXNhYmxlZCcpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIGVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKCdkaXNhYmxlZCcpO1xuICAgICAgICB9XG4gICAgfSxcbiAgICB0ZXh0Q29udGVudDogdXBkYXRlVGV4dFByb3BlcnR5LFxuICAgIGlubmVyVGV4dDogdXBkYXRlVGV4dFByb3BlcnR5LFxuICAgIGlubmVySFRNTDogdXBkYXRlVGV4dFByb3BlcnR5LFxuICAgIHZhbHVlOiBmdW5jdGlvbihnZW5lcmljLCBlbGVtZW50LCB2YWx1ZSl7XG4gICAgICAgIHZhciBpbnB1dFR5cGUgPSBlbGVtZW50LnR5cGU7XG5cbiAgICAgICAgaWYoZWxlbWVudC5ub2RlTmFtZSA9PT0gJ0lOUFVUJyAmJiBpbnB1dFR5cGUgPT09ICdkYXRlJyl7XG4gICAgICAgICAgICBpZihhcmd1bWVudHMubGVuZ3RoID09PSAyKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZWxlbWVudC52YWx1ZSA/IG5ldyBEYXRlKGVsZW1lbnQudmFsdWUucmVwbGFjZSgvLS9nLCcvJykucmVwbGFjZSgnVCcsJyAnKSkgOiBudWxsO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YWx1ZSA9IHZhbHVlICE9IG51bGwgPyBuZXcgRGF0ZSh2YWx1ZSkgOiBudWxsO1xuXG4gICAgICAgICAgICBpZighdmFsdWUgfHwgaXNOYU4odmFsdWUpKXtcbiAgICAgICAgICAgICAgICBlbGVtZW50LnZhbHVlID0gbnVsbDtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGVsZW1lbnQudmFsdWUgPSBbXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlLmdldEZ1bGxZZWFyKCksXG4gICAgICAgICAgICAgICAgICAgICgnMCcgKyAodmFsdWUuZ2V0TW9udGgoKSArIDEpKS5zbGljZSgtMiksXG4gICAgICAgICAgICAgICAgICAgICgnMCcgKyB2YWx1ZS5nZXREYXRlKCkpLnNsaWNlKC0yKVxuICAgICAgICAgICAgICAgIF0uam9pbignLScpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA9PT0gMil7XG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudC52YWx1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZih2YWx1ZSA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHZhbHVlID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIHNldGlmeShlbGVtZW50LCB2YWx1ZSk7XG4gICAgfSxcbiAgICBzdHlsZTogZnVuY3Rpb24oZ2VuZXJpYywgZWxlbWVudCwgdmFsdWUpe1xuICAgICAgICBpZihhcmd1bWVudHMubGVuZ3RoID09PSAyKXtcbiAgICAgICAgICAgIHJldHVybiBlbGVtZW50LnN0eWxlO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yKHZhciBrZXkgaW4gdmFsdWUpe1xuICAgICAgICAgICAgZWxlbWVudC5zdHlsZVtrZXldID0gdmFsdWVba2V5XTtcbiAgICAgICAgfVxuICAgIH1cbn07IiwiLy8gSXMgdGhlIGVudGl0eSBmaXJtZXIgdGhhbiB0aGUgbmV3IGZpcm1uZXNzXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGVudGl0eSwgZmlybSl7XG4gICAgaWYoZmlybSAhPSBudWxsICYmIChlbnRpdHkuX2Zpcm0gPT09IHVuZGVmaW5lZCB8fCBmaXJtIDwgZW50aXR5Ll9maXJtKSl7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn07IiwidmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcixcbiAgICBmdW5jdGlvbkVtaXR0ZXJQcm90b3R5cGUgPSBmdW5jdGlvbigpe307XG5cbmZvcih2YXIga2V5IGluIEV2ZW50RW1pdHRlci5wcm90b3R5cGUpe1xuICAgIGZ1bmN0aW9uRW1pdHRlclByb3RvdHlwZVtrZXldID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZVtrZXldO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uRW1pdHRlclByb3RvdHlwZTsiLCJ2YXIgY29udGFpbmVyQ29tcG9uZW50ID0gcmVxdWlyZSgnLi9jb250YWluZXJDb21wb25lbnQnKSxcbiAgICBzY2hlZHVsZSA9IHJlcXVpcmUoJy4vc2NoZWR1bGUnKSxcbiAgICBmYW5jeVByb3BzID0gcmVxdWlyZSgnLi9mYW5jeVByb3BzJyksXG4gICAgbWF0Y2hEb21IYW5kbGVyTmFtZSA9IC9eKCg/OmVsXFwuKT8pKFteLiBdKykoPzpcXC4oY2FwdHVyZSkpPyQvLFxuICAgIEdFTkVSSUMgPSAnX2dlbmVyaWMnO1xuXG5mdW5jdGlvbiBjcmVhdGVQcm9wZXJ0aWVzKGZhc3RuLCBjb21wb25lbnQsIHNldHRpbmdzKXtcbiAgICBmb3IodmFyIGtleSBpbiBzZXR0aW5ncyl7XG4gICAgICAgIHZhciBzZXR0aW5nID0gc2V0dGluZ3Nba2V5XTtcblxuICAgICAgICBpZih0eXBlb2Ygc2V0dGluZyA9PT0gJ2Z1bmN0aW9uJyAmJiAhZmFzdG4uaXNQcm9wZXJ0eShzZXR0aW5nKSAmJiAhZmFzdG4uaXNCaW5kaW5nKHNldHRpbmcpKXtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29tcG9uZW50LmFkZERvbVByb3BlcnR5KGtleSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBhZGREb21IYW5kbGVyKGNvbXBvbmVudCwgZWxlbWVudCwgaGFuZGxlck5hbWUsIGV2ZW50TmFtZSwgY2FwdHVyZSl7XG4gICAgdmFyIGV2ZW50UGFydHMgPSBoYW5kbGVyTmFtZS5zcGxpdCgnLicpO1xuXG4gICAgaWYoZXZlbnRQYXJ0c1swXSA9PT0gJ29uJyl7XG4gICAgICAgIGV2ZW50UGFydHMuc2hpZnQoKTtcbiAgICB9XG5cbiAgICB2YXIgaGFuZGxlciA9IGZ1bmN0aW9uKGV2ZW50KXtcbiAgICAgICAgICAgIGNvbXBvbmVudC5lbWl0KGhhbmRsZXJOYW1lLCBldmVudCwgY29tcG9uZW50LnNjb3BlKCkpO1xuICAgICAgICB9O1xuXG4gICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlciwgY2FwdHVyZSk7XG5cbiAgICBjb21wb25lbnQub24oJ2Rlc3Ryb3knLCBmdW5jdGlvbigpe1xuICAgICAgICBlbGVtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBoYW5kbGVyLCBjYXB0dXJlKTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gYWRkRG9tSGFuZGxlcnMoY29tcG9uZW50LCBlbGVtZW50LCBldmVudE5hbWVzKXtcbiAgICB2YXIgZXZlbnRzID0gZXZlbnROYW1lcy5zcGxpdCgnICcpO1xuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGV2ZW50cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHZhciBldmVudE5hbWUgPSBldmVudHNbaV0sXG4gICAgICAgICAgICBtYXRjaCA9IGV2ZW50TmFtZS5tYXRjaChtYXRjaERvbUhhbmRsZXJOYW1lKTtcblxuICAgICAgICBpZighbWF0Y2gpe1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBpZihtYXRjaFsxXSB8fCAnb24nICsgbWF0Y2hbMl0gaW4gZWxlbWVudCl7XG4gICAgICAgICAgICBhZGREb21IYW5kbGVyKGNvbXBvbmVudCwgZWxlbWVudCwgZXZlbnROYW1lcywgbWF0Y2hbMl0sIG1hdGNoWzNdKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gYWRkQXV0b0hhbmRsZXIoY29tcG9uZW50LCBlbGVtZW50LCBrZXksIHNldHRpbmdzKXtcbiAgICBpZighc2V0dGluZ3Nba2V5XSl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgYXV0b0V2ZW50ID0gc2V0dGluZ3Nba2V5XS5zcGxpdCgnOicpLFxuICAgICAgICBldmVudE5hbWUgPSBrZXkuc2xpY2UoMik7XG5cbiAgICBkZWxldGUgc2V0dGluZ3Nba2V5XTtcblxuICAgIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICB2YXIgZmFuY3lQcm9wID0gZmFuY3lQcm9wc1thdXRvRXZlbnRbMV1dLFxuICAgICAgICAgICAgdmFsdWUgPSBmYW5jeVByb3AgPyBmYW5jeVByb3AoY29tcG9uZW50LCBlbGVtZW50KSA6IGVsZW1lbnRbYXV0b0V2ZW50WzFdXTtcblxuICAgICAgICBjb21wb25lbnRbYXV0b0V2ZW50WzBdXSh2YWx1ZSk7XG4gICAgfTtcblxuICAgIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGhhbmRsZXIpO1xuXG4gICAgY29tcG9uZW50Lm9uKCdkZXN0cm95JywgZnVuY3Rpb24oKXtcbiAgICAgICAgZWxlbWVudC5yZW1vdmVFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlcik7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIGFkZERvbVByb3BlcnR5KGZhc3RuLCBrZXksIHByb3BlcnR5KXtcbiAgICB2YXIgY29tcG9uZW50ID0gdGhpcztcblxuICAgIHByb3BlcnR5ID0gcHJvcGVydHkgfHwgY29tcG9uZW50W2tleV0gfHwgZmFzdG4ucHJvcGVydHkoKTtcbiAgICBjb21wb25lbnQuc2V0UHJvcGVydHkoa2V5LCBwcm9wZXJ0eSk7XG5cbiAgICBmdW5jdGlvbiB1cGRhdGUoKXtcbiAgICAgICAgdmFyIGVsZW1lbnQgPSBjb21wb25lbnQuZ2V0UHJvcGVydHlFbGVtZW50KGtleSksXG4gICAgICAgICAgICB2YWx1ZSA9IHByb3BlcnR5KCk7XG5cbiAgICAgICAgaWYoIWVsZW1lbnQgfHwgY29tcG9uZW50LmRlc3Ryb3llZCgpKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBpc1Byb3BlcnR5ID0ga2V5IGluIGVsZW1lbnQsXG4gICAgICAgICAgICBmYW5jeVByb3AgPSBmYW5jeVByb3BzW2tleV0sXG4gICAgICAgICAgICBwcmV2aW91cyA9IGZhbmN5UHJvcCA/IGZhbmN5UHJvcChjb21wb25lbnQsIGVsZW1lbnQpIDogaXNQcm9wZXJ0eSA/IGVsZW1lbnRba2V5XSA6IGVsZW1lbnQuZ2V0QXR0cmlidXRlKGtleSk7XG5cbiAgICAgICAgaWYoIWZhbmN5UHJvcCAmJiAhaXNQcm9wZXJ0eSAmJiB2YWx1ZSA9PSBudWxsKXtcbiAgICAgICAgICAgIHZhbHVlID0gJyc7XG4gICAgICAgIH1cblxuICAgICAgICBpZih2YWx1ZSAhPT0gcHJldmlvdXMpe1xuICAgICAgICAgICAgaWYoZmFuY3lQcm9wKXtcbiAgICAgICAgICAgICAgICBmYW5jeVByb3AoY29tcG9uZW50LCBlbGVtZW50LCB2YWx1ZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihpc1Byb3BlcnR5KXtcbiAgICAgICAgICAgICAgICBlbGVtZW50W2tleV0gPSB2YWx1ZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKHR5cGVvZiB2YWx1ZSAhPT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgICAgICAgICBlbGVtZW50LnNldEF0dHJpYnV0ZShrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByb3BlcnR5LnVwZGF0ZXIodXBkYXRlKTtcbn1cblxuZnVuY3Rpb24gb25SZW5kZXIoKXtcbiAgICB2YXIgY29tcG9uZW50ID0gdGhpcyxcbiAgICAgICAgZWxlbWVudDtcblxuICAgIGZvcih2YXIga2V5IGluIGNvbXBvbmVudC5fc2V0dGluZ3Mpe1xuICAgICAgICBlbGVtZW50ID0gY29tcG9uZW50LmdldEV2ZW50RWxlbWVudChrZXkpO1xuICAgICAgICBpZihrZXkuc2xpY2UoMCwyKSA9PT0gJ29uJyAmJiBrZXkgaW4gZWxlbWVudCl7XG4gICAgICAgICAgICBhZGRBdXRvSGFuZGxlcihjb21wb25lbnQsIGVsZW1lbnQsIGtleSwgY29tcG9uZW50Ll9zZXR0aW5ncyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IodmFyIGV2ZW50S2V5IGluIGNvbXBvbmVudC5fZXZlbnRzKXtcbiAgICAgICAgZWxlbWVudCA9IGNvbXBvbmVudC5nZXRFdmVudEVsZW1lbnQoa2V5KTtcbiAgICAgICAgYWRkRG9tSGFuZGxlcnMoY29tcG9uZW50LCBlbGVtZW50LCBldmVudEtleSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiByZW5kZXIoKXtcbiAgICB0aGlzLmVsZW1lbnQgPSB0aGlzLmNyZWF0ZUVsZW1lbnQodGhpcy5fc2V0dGluZ3MudGFnTmFtZSB8fCB0aGlzLl90YWdOYW1lKTtcblxuICAgIHRoaXMuZW1pdCgncmVuZGVyJyk7XG5cbiAgICByZXR1cm4gdGhpcztcbn07XG5cbmZ1bmN0aW9uIGdlbmVyaWNDb21wb25lbnQoZmFzdG4sIGNvbXBvbmVudCwgdHlwZSwgc2V0dGluZ3MsIGNoaWxkcmVuKXtcbiAgICBpZihjb21wb25lbnQuaXModHlwZSkpe1xuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH1cblxuICAgIGlmKHR5cGUgPT09IEdFTkVSSUMpe1xuICAgICAgICBjb21wb25lbnQuX3RhZ05hbWUgPSBjb21wb25lbnQuX3RhZ05hbWUgfHwgJ2Rpdic7XG4gICAgfWVsc2V7XG4gICAgICAgIGNvbXBvbmVudC5fdGFnTmFtZSA9IHR5cGU7XG4gICAgfVxuXG4gICAgaWYoY29tcG9uZW50LmlzKEdFTkVSSUMpKXtcbiAgICAgICAgcmV0dXJuIGNvbXBvbmVudDtcbiAgICB9XG5cbiAgICBjb21wb25lbnQuZXh0ZW5kKCdfY29udGFpbmVyJywgc2V0dGluZ3MsIGNoaWxkcmVuKTtcblxuICAgIGNvbXBvbmVudC5hZGREb21Qcm9wZXJ0eSA9IGFkZERvbVByb3BlcnR5LmJpbmQoY29tcG9uZW50LCBmYXN0bik7XG4gICAgY29tcG9uZW50LmdldEV2ZW50RWxlbWVudCA9IGNvbXBvbmVudC5nZXRDb250YWluZXJFbGVtZW50O1xuICAgIGNvbXBvbmVudC5nZXRQcm9wZXJ0eUVsZW1lbnQgPSBjb21wb25lbnQuZ2V0Q29udGFpbmVyRWxlbWVudDtcbiAgICBjb21wb25lbnQudXBkYXRlUHJvcGVydHkgPSBnZW5lcmljQ29tcG9uZW50LnVwZGF0ZVByb3BlcnR5O1xuICAgIGNvbXBvbmVudC5jcmVhdGVFbGVtZW50ID0gZ2VuZXJpY0NvbXBvbmVudC5jcmVhdGVFbGVtZW50O1xuXG4gICAgY3JlYXRlUHJvcGVydGllcyhmYXN0biwgY29tcG9uZW50LCBzZXR0aW5ncyk7XG5cbiAgICBjb21wb25lbnQucmVuZGVyID0gcmVuZGVyLmJpbmQoY29tcG9uZW50KTtcblxuICAgIGNvbXBvbmVudC5vbigncmVuZGVyJywgb25SZW5kZXIpO1xuXG4gICAgcmV0dXJuIGNvbXBvbmVudDtcbn1cblxuZ2VuZXJpY0NvbXBvbmVudC51cGRhdGVQcm9wZXJ0eSA9IGZ1bmN0aW9uKGNvbXBvbmVudCwgcHJvcGVydHksIHVwZGF0ZSl7XG4gICAgaWYodHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyAmJiBkb2N1bWVudC5jb250YWlucyhjb21wb25lbnQuZWxlbWVudCkpe1xuICAgICAgICBzY2hlZHVsZShwcm9wZXJ0eSwgdXBkYXRlKTtcbiAgICB9ZWxzZXtcbiAgICAgICAgdXBkYXRlKCk7XG4gICAgfVxufTtcblxuZ2VuZXJpY0NvbXBvbmVudC5jcmVhdGVFbGVtZW50ID0gZnVuY3Rpb24odGFnTmFtZSl7XG4gICAgaWYodGFnTmFtZSBpbnN0YW5jZW9mIE5vZGUpe1xuICAgICAgICByZXR1cm4gdGFnTmFtZTtcbiAgICB9XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQodGFnTmFtZSk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGdlbmVyaWNDb21wb25lbnQ7IiwidmFyIGNyZWF0ZVByb3BlcnR5ID0gcmVxdWlyZSgnLi9wcm9wZXJ0eScpLFxuICAgIGNyZWF0ZUJpbmRpbmcgPSByZXF1aXJlKCcuL2JpbmRpbmcnKSxcbiAgICBCYXNlQ29tcG9uZW50ID0gcmVxdWlyZSgnLi9iYXNlQ29tcG9uZW50JyksXG4gICAgY3JlbCA9IHJlcXVpcmUoJ2NyZWwnKSxcbiAgICBFbnRpID0gcmVxdWlyZSgnZW50aScpLFxuICAgIG9iamVjdEFzc2lnbiA9IHJlcXVpcmUoJ29iamVjdC1hc3NpZ24nKSxcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKTtcblxuZnVuY3Rpb24gaW5mbGF0ZVByb3BlcnRpZXMoY29tcG9uZW50LCBzZXR0aW5ncyl7XG4gICAgZm9yKHZhciBrZXkgaW4gc2V0dGluZ3Mpe1xuICAgICAgICB2YXIgc2V0dGluZyA9IHNldHRpbmdzW2tleV0sXG4gICAgICAgICAgICBwcm9wZXJ0eSA9IGNvbXBvbmVudFtrZXldO1xuXG4gICAgICAgIGlmKGlzLnByb3BlcnR5KHNldHRpbmdzW2tleV0pKXtcblxuICAgICAgICAgICAgaWYoaXMucHJvcGVydHkocHJvcGVydHkpKXtcbiAgICAgICAgICAgICAgICBwcm9wZXJ0eS5kZXN0cm95KCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHNldHRpbmcuYWRkVG8oY29tcG9uZW50LCBrZXkpO1xuXG4gICAgICAgIH1lbHNlIGlmKGlzLnByb3BlcnR5KHByb3BlcnR5KSl7XG5cbiAgICAgICAgICAgIGlmKGlzLmJpbmRpbmcoc2V0dGluZykpe1xuICAgICAgICAgICAgICAgIHByb3BlcnR5LmJpbmRpbmcoc2V0dGluZyk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBwcm9wZXJ0eShzZXR0aW5nKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcHJvcGVydHkuYWRkVG8oY29tcG9uZW50LCBrZXkpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZUV4cGVjdGVkQ29tcG9uZW50cyhjb21wb25lbnRzLCBjb21wb25lbnROYW1lLCBleHBlY3RlZENvbXBvbmVudHMpe1xuICAgIGV4cGVjdGVkQ29tcG9uZW50cyA9IGV4cGVjdGVkQ29tcG9uZW50cy5maWx0ZXIoZnVuY3Rpb24oY29tcG9uZW50TmFtZSl7XG4gICAgICAgIHJldHVybiAhKGNvbXBvbmVudE5hbWUgaW4gY29tcG9uZW50cyk7XG4gICAgfSk7XG5cbiAgICBpZihleHBlY3RlZENvbXBvbmVudHMubGVuZ3RoKXtcbiAgICAgICAgY29uc29sZS53YXJuKFtcbiAgICAgICAgICAgICdmYXN0bihcIicgKyBjb21wb25lbnROYW1lICsgJ1wiKSB1c2VzIHNvbWUgY29tcG9uZW50cyB0aGF0IGhhdmUgbm90IGJlZW4gcmVnaXN0ZXJlZCB3aXRoIGZhc3RuJyxcbiAgICAgICAgICAgICdFeHBlY3RlZCBjb25wb25lbnQgY29uc3RydWN0b3JzOiAnICsgZXhwZWN0ZWRDb21wb25lbnRzLmpvaW4oJywgJylcbiAgICAgICAgXS5qb2luKCdcXG5cXG4nKSk7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGNvbXBvbmVudHMsIGRlYnVnKXtcblxuICAgIGlmKCFjb21wb25lbnRzIHx8IHR5cGVvZiBjb21wb25lbnRzICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignZmFzdG4gbXVzdCBiZSBpbml0aWFsaXNlZCB3aXRoIGEgY29tcG9uZW50cyBvYmplY3QnKTtcbiAgICB9XG5cbiAgICBjb21wb25lbnRzLl9jb250YWluZXIgPSBjb21wb25lbnRzLl9jb250YWluZXIgfHwgcmVxdWlyZSgnLi9jb250YWluZXJDb21wb25lbnQnKTtcblxuICAgIGZ1bmN0aW9uIGZhc3RuKHR5cGUpe1xuXG4gICAgICAgIHZhciBhcmdzID0gW107XG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgYXJnc1tpXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBzZXR0aW5ncyA9IGFyZ3NbMV0sXG4gICAgICAgICAgICBjaGlsZHJlbkluZGV4ID0gMixcbiAgICAgICAgICAgIHNldHRpbmdzQ2hpbGQgPSBmYXN0bi50b0NvbXBvbmVudChhcmdzWzFdKTtcblxuICAgICAgICBpZihBcnJheS5pc0FycmF5KGFyZ3NbMV0pIHx8IHNldHRpbmdzQ2hpbGQgfHwgIWFyZ3NbMV0pe1xuICAgICAgICAgICAgYXJnc1sxXSA9IHNldHRpbmdzQ2hpbGQgfHwgYXJnc1sxXTtcbiAgICAgICAgICAgIGNoaWxkcmVuSW5kZXgtLTtcbiAgICAgICAgICAgIHNldHRpbmdzID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIHNldHRpbmdzID0gb2JqZWN0QXNzaWduKHt9LCBzZXR0aW5ncyB8fCB7fSk7XG5cbiAgICAgICAgdmFyIHR5cGVzID0gdHlwZW9mIHR5cGUgPT09ICdzdHJpbmcnID8gdHlwZS5zcGxpdCgnOicpIDogQXJyYXkuaXNBcnJheSh0eXBlKSA/IHR5cGUgOiBbdHlwZV0sXG4gICAgICAgICAgICBiYXNlVHlwZSxcbiAgICAgICAgICAgIGNoaWxkcmVuID0gYXJncy5zbGljZShjaGlsZHJlbkluZGV4KSxcbiAgICAgICAgICAgIGNvbXBvbmVudCA9IGZhc3RuLmJhc2UodHlwZSwgc2V0dGluZ3MsIGNoaWxkcmVuKTtcblxuICAgICAgICB3aGlsZShiYXNlVHlwZSA9IHR5cGVzLnNoaWZ0KCkpe1xuICAgICAgICAgICAgY29tcG9uZW50LmV4dGVuZChiYXNlVHlwZSwgc2V0dGluZ3MsIGNoaWxkcmVuKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbXBvbmVudC5fcHJvcGVydGllcyA9IHt9O1xuXG4gICAgICAgIGluZmxhdGVQcm9wZXJ0aWVzKGNvbXBvbmVudCwgc2V0dGluZ3MpO1xuXG4gICAgICAgIHJldHVybiBjb21wb25lbnQ7XG4gICAgfVxuXG4gICAgZmFzdG4udG9Db21wb25lbnQgPSBmdW5jdGlvbihjb21wb25lbnQpe1xuICAgICAgICBpZihjb21wb25lbnQgPT0gbnVsbCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYoaXMuY29tcG9uZW50KGNvbXBvbmVudCkpe1xuICAgICAgICAgICAgcmV0dXJuIGNvbXBvbmVudDtcbiAgICAgICAgfVxuICAgICAgICBpZih0eXBlb2YgY29tcG9uZW50ICE9PSAnb2JqZWN0JyB8fCBjb21wb25lbnQgaW5zdGFuY2VvZiBEYXRlKXtcbiAgICAgICAgICAgIHJldHVybiBmYXN0bigndGV4dCcsIHthdXRvOiB0cnVlfSwgY29tcG9uZW50KTtcbiAgICAgICAgfVxuICAgICAgICBpZihjcmVsLmlzRWxlbWVudChjb21wb25lbnQpKXtcbiAgICAgICAgICAgIHJldHVybiBmYXN0bihjb21wb25lbnQpO1xuICAgICAgICB9XG4gICAgICAgIGlmKGNyZWwuaXNOb2RlKGNvbXBvbmVudCkpe1xuICAgICAgICAgICAgcmV0dXJuIGZhc3RuKCd0ZXh0Jywge2F1dG86IHRydWV9LCBjb21wb25lbnQudGV4dENvbnRlbnQpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIGZhc3RuLmRlYnVnID0gZGVidWc7XG4gICAgZmFzdG4ucHJvcGVydHkgPSBjcmVhdGVQcm9wZXJ0eTtcbiAgICBmYXN0bi5iaW5kaW5nID0gY3JlYXRlQmluZGluZztcbiAgICBmYXN0bi5pc0NvbXBvbmVudCA9IGlzLmNvbXBvbmVudDtcbiAgICBmYXN0bi5pc0JpbmRpbmcgPSBpcy5iaW5kaW5nO1xuICAgIGZhc3RuLmlzRGVmYXVsdEJpbmRpbmcgPSBpcy5kZWZhdWx0QmluZGluZztcbiAgICBmYXN0bi5pc0JpbmRpbmdPYmplY3QgPSBpcy5iaW5kaW5nT2JqZWN0O1xuICAgIGZhc3RuLmlzUHJvcGVydHkgPSBpcy5wcm9wZXJ0eTtcbiAgICBmYXN0bi5jb21wb25lbnRzID0gY29tcG9uZW50cztcbiAgICBmYXN0bi5Nb2RlbCA9IEVudGk7XG5cbiAgICBmYXN0bi5iYXNlID0gZnVuY3Rpb24odHlwZSwgc2V0dGluZ3MsIGNoaWxkcmVuKXtcbiAgICAgICAgcmV0dXJuIG5ldyBCYXNlQ29tcG9uZW50KGZhc3RuLCB0eXBlLCBzZXR0aW5ncywgY2hpbGRyZW4pO1xuICAgIH07XG5cbiAgICBmb3IodmFyIGtleSBpbiBjb21wb25lbnRzKXtcbiAgICAgICAgdmFyIGNvbXBvbmVudENvbnN0cnVjdG9yID0gY29tcG9uZW50c1trZXldO1xuXG4gICAgICAgIGlmKGNvbXBvbmVudENvbnN0cnVjdG9yLmV4cGVjdGVkQ29tcG9uZW50cyl7XG4gICAgICAgICAgICB2YWxpZGF0ZUV4cGVjdGVkQ29tcG9uZW50cyhjb21wb25lbnRzLCBrZXksIGNvbXBvbmVudENvbnN0cnVjdG9yLmV4cGVjdGVkQ29tcG9uZW50cyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFzdG47XG59OyIsInZhciBGVU5DVElPTiA9ICdmdW5jdGlvbicsXG4gICAgT0JKRUNUID0gJ29iamVjdCcsXG4gICAgRkFTVE5CSU5ESU5HID0gJ19mYXN0bl9iaW5kaW5nJyxcbiAgICBGQVNUTlBST1BFUlRZID0gJ19mYXN0bl9wcm9wZXJ0eScsXG4gICAgRkFTVE5DT01QT05FTlQgPSAnX2Zhc3RuX2NvbXBvbmVudCcsXG4gICAgREVGQVVMVEJJTkRJTkcgPSAnX2RlZmF1bHRfYmluZGluZyc7XG5cbmZ1bmN0aW9uIGlzQ29tcG9uZW50KHRoaW5nKXtcbiAgICByZXR1cm4gdGhpbmcgJiYgdHlwZW9mIHRoaW5nID09PSBPQkpFQ1QgJiYgRkFTVE5DT01QT05FTlQgaW4gdGhpbmc7XG59XG5cbmZ1bmN0aW9uIGlzQmluZGluZ09iamVjdCh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gT0JKRUNUICYmIEZBU1ROQklORElORyBpbiB0aGluZztcbn1cblxuZnVuY3Rpb24gaXNCaW5kaW5nKHRoaW5nKXtcbiAgICByZXR1cm4gdHlwZW9mIHRoaW5nID09PSBGVU5DVElPTiAmJiBGQVNUTkJJTkRJTkcgaW4gdGhpbmc7XG59XG5cbmZ1bmN0aW9uIGlzUHJvcGVydHkodGhpbmcpe1xuICAgIHJldHVybiB0eXBlb2YgdGhpbmcgPT09IEZVTkNUSU9OICYmIEZBU1ROUFJPUEVSVFkgaW4gdGhpbmc7XG59XG5cbmZ1bmN0aW9uIGlzRGVmYXVsdEJpbmRpbmcodGhpbmcpe1xuICAgIHJldHVybiB0eXBlb2YgdGhpbmcgPT09IEZVTkNUSU9OICYmIEZBU1ROQklORElORyBpbiB0aGluZyAmJiBERUZBVUxUQklORElORyBpbiB0aGluZztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgY29tcG9uZW50OiBpc0NvbXBvbmVudCxcbiAgICBiaW5kaW5nT2JqZWN0OiBpc0JpbmRpbmdPYmplY3QsXG4gICAgYmluZGluZzogaXNCaW5kaW5nLFxuICAgIGRlZmF1bHRCaW5kaW5nOiBpc0RlZmF1bHRCaW5kaW5nLFxuICAgIHByb3BlcnR5OiBpc1Byb3BlcnR5XG59OyIsInZhciBNdWx0aU1hcCA9IHJlcXVpcmUoJ211bHRpbWFwJyksXG4gICAgbWVyZ2UgPSByZXF1aXJlKCdmbGF0LW1lcmdlJyk7XG5cbk11bHRpTWFwLk1hcCA9IE1hcDtcblxuZnVuY3Rpb24gZWFjaCh2YWx1ZSwgZm4pe1xuICAgIGlmKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmKEFycmF5LmlzQXJyYXkodmFsdWUpKXtcbiAgICAgICAgZm9yKHZhciBpID0gMDsgaSA8IHZhbHVlLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIGZuKHZhbHVlW2ldLCBpKVxuICAgICAgICB9XG4gICAgfWVsc2V7XG4gICAgICAgIGZvcih2YXIga2V5IGluIHZhbHVlKXtcbiAgICAgICAgICAgIGZuKHZhbHVlW2tleV0sIGtleSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGtleUZvcihvYmplY3QsIHZhbHVlKXtcbiAgICBpZighb2JqZWN0IHx8IHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGlmKEFycmF5LmlzQXJyYXkob2JqZWN0KSl7XG4gICAgICAgIHZhciBpbmRleCA9IG9iamVjdC5pbmRleE9mKHZhbHVlKTtcbiAgICAgICAgcmV0dXJuIGluZGV4ID49MCA/IGluZGV4IDogZmFsc2U7XG4gICAgfVxuXG4gICAgZm9yKHZhciBrZXkgaW4gb2JqZWN0KXtcbiAgICAgICAgaWYob2JqZWN0W2tleV0gPT09IHZhbHVlKXtcbiAgICAgICAgICAgIHJldHVybiBrZXk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZmFzdG4sIGNvbXBvbmVudCwgdHlwZSwgc2V0dGluZ3MsIGNoaWxkcmVuKXtcblxuICAgIGlmKGZhc3RuLmNvbXBvbmVudHMuX2dlbmVyaWMpe1xuICAgICAgICBjb21wb25lbnQuZXh0ZW5kKCdfZ2VuZXJpYycsIHNldHRpbmdzLCBjaGlsZHJlbik7XG4gICAgfWVsc2V7XG4gICAgICAgIGNvbXBvbmVudC5leHRlbmQoJ19jb250YWluZXInLCBzZXR0aW5ncywgY2hpbGRyZW4pO1xuICAgIH1cblxuICAgIHZhciBpdGVtc01hcCA9IG5ldyBNdWx0aU1hcCgpLFxuICAgICAgICBkYXRhTWFwID0gbmV3IFdlYWtNYXAoKSxcbiAgICAgICAgbGFzdFRlbXBsYXRlLFxuICAgICAgICBleGlzdGluZ0l0ZW0gPSB7fTtcblxuICAgIGZ1bmN0aW9uIHVwZGF0ZUl0ZW1zKCl7XG4gICAgICAgIHZhciB2YWx1ZSA9IGNvbXBvbmVudC5pdGVtcygpLFxuICAgICAgICAgICAgdGVtcGxhdGUgPSBjb21wb25lbnQudGVtcGxhdGUoKSxcbiAgICAgICAgICAgIGVtcHR5VGVtcGxhdGUgPSBjb21wb25lbnQuZW1wdHlUZW1wbGF0ZSgpLFxuICAgICAgICAgICAgbmV3VGVtcGxhdGUgPSBsYXN0VGVtcGxhdGUgIT09IHRlbXBsYXRlO1xuXG4gICAgICAgIHZhciBjdXJyZW50SXRlbXMgPSBtZXJnZSh0ZW1wbGF0ZSA/IHZhbHVlIDogW10pO1xuXG4gICAgICAgIGl0ZW1zTWFwLmZvckVhY2goZnVuY3Rpb24oY2hpbGRDb21wb25lbnQsIGl0ZW0pe1xuICAgICAgICAgICAgdmFyIGN1cnJlbnRLZXkgPSBrZXlGb3IoY3VycmVudEl0ZW1zLCBpdGVtKTtcblxuICAgICAgICAgICAgaWYoIW5ld1RlbXBsYXRlICYmIGN1cnJlbnRLZXkgIT09IGZhbHNlKXtcbiAgICAgICAgICAgICAgICBjdXJyZW50SXRlbXNbY3VycmVudEtleV0gPSBbZXhpc3RpbmdJdGVtLCBpdGVtLCBjaGlsZENvbXBvbmVudF07XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICByZW1vdmVDb21wb25lbnQoY2hpbGRDb21wb25lbnQpO1xuICAgICAgICAgICAgICAgIGl0ZW1zTWFwLmRlbGV0ZShpdGVtKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgdmFyIGluZGV4ID0gMDtcblxuICAgICAgICBmdW5jdGlvbiB1cGRhdGVJdGVtKGl0ZW0sIGtleSl7XG4gICAgICAgICAgICB2YXIgY2hpbGQsXG4gICAgICAgICAgICAgICAgZXhpc3Rpbmc7XG5cbiAgICAgICAgICAgIHdoaWxlKGluZGV4IDwgY29tcG9uZW50Ll9jaGlsZHJlbi5sZW5ndGggJiYgIWNvbXBvbmVudC5fY2hpbGRyZW5baW5kZXhdLl90ZW1wbGF0ZWQpe1xuICAgICAgICAgICAgICAgIGluZGV4Kys7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKEFycmF5LmlzQXJyYXkoaXRlbSkgJiYgaXRlbVswXSA9PT0gZXhpc3RpbmdJdGVtKXtcbiAgICAgICAgICAgICAgICBleGlzdGluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgY2hpbGQgPSBpdGVtWzJdO1xuICAgICAgICAgICAgICAgIGl0ZW0gPSBpdGVtWzFdO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgY2hpbGRNb2RlbDtcblxuICAgICAgICAgICAgaWYoIWV4aXN0aW5nKXtcbiAgICAgICAgICAgICAgICBjaGlsZE1vZGVsID0gbmV3IGZhc3RuLk1vZGVsKHtcbiAgICAgICAgICAgICAgICAgICAgaXRlbTogaXRlbSxcbiAgICAgICAgICAgICAgICAgICAga2V5OiBrZXlcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGNoaWxkID0gZmFzdG4udG9Db21wb25lbnQodGVtcGxhdGUoY2hpbGRNb2RlbCwgY29tcG9uZW50LnNjb3BlKCkpKTtcbiAgICAgICAgICAgICAgICBpZighY2hpbGQpe1xuICAgICAgICAgICAgICAgICAgICBjaGlsZCA9IGZhc3RuKCd0ZW1wbGF0ZScpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjaGlsZC5fbGlzdEl0ZW0gPSBpdGVtO1xuICAgICAgICAgICAgICAgIGNoaWxkLl90ZW1wbGF0ZWQgPSB0cnVlO1xuXG4gICAgICAgICAgICAgICAgZGF0YU1hcC5zZXQoY2hpbGQsIGNoaWxkTW9kZWwpO1xuICAgICAgICAgICAgICAgIGl0ZW1zTWFwLnNldChpdGVtLCBjaGlsZCk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBjaGlsZE1vZGVsID0gZGF0YU1hcC5nZXQoY2hpbGQpO1xuICAgICAgICAgICAgICAgIGNoaWxkTW9kZWwuc2V0KCdrZXknLCBrZXkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudChjaGlsZCkgJiYgY29tcG9uZW50Ll9zZXR0aW5ncy5hdHRhY2hUZW1wbGF0ZXMgIT09IGZhbHNlKXtcbiAgICAgICAgICAgICAgICBjaGlsZC5hdHRhY2goY2hpbGRNb2RlbCwgMik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbXBvbmVudC5pbnNlcnQoY2hpbGQsIGluZGV4KTtcbiAgICAgICAgICAgIGluZGV4Kys7XG4gICAgICAgIH1cblxuICAgICAgICBlYWNoKGN1cnJlbnRJdGVtcywgdXBkYXRlSXRlbSk7XG5cbiAgICAgICAgbGFzdFRlbXBsYXRlID0gdGVtcGxhdGU7XG5cbiAgICAgICAgaWYoaW5kZXggPT09IDAgJiYgZW1wdHlUZW1wbGF0ZSl7XG4gICAgICAgICAgICB2YXIgY2hpbGQgPSBmYXN0bi50b0NvbXBvbmVudChlbXB0eVRlbXBsYXRlKGNvbXBvbmVudC5zY29wZSgpKSk7XG4gICAgICAgICAgICBpZighY2hpbGQpe1xuICAgICAgICAgICAgICAgIGNoaWxkID0gZmFzdG4oJ3RlbXBsYXRlJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjaGlsZC5fdGVtcGxhdGVkID0gdHJ1ZTtcblxuICAgICAgICAgICAgaXRlbXNNYXAuc2V0KHt9LCBjaGlsZCk7XG5cbiAgICAgICAgICAgIGNvbXBvbmVudC5pbnNlcnQoY2hpbGQpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVtb3ZlQ29tcG9uZW50KGNoaWxkQ29tcG9uZW50KXtcbiAgICAgICAgY29tcG9uZW50LnJlbW92ZShjaGlsZENvbXBvbmVudCk7XG4gICAgICAgIGNoaWxkQ29tcG9uZW50LmRlc3Ryb3koKTtcbiAgICB9XG5cbiAgICBjb21wb25lbnQuc2V0UHJvcGVydHkoJ2l0ZW1zJyxcbiAgICAgICAgZmFzdG4ucHJvcGVydHkoW10sIHNldHRpbmdzLml0ZW1DaGFuZ2VzIHx8ICd0eXBlIGtleXMgc2hhbGxvd1N0cnVjdHVyZScpXG4gICAgICAgICAgICAub24oJ2NoYW5nZScsIHVwZGF0ZUl0ZW1zKVxuICAgICk7XG5cbiAgICBjb21wb25lbnQuc2V0UHJvcGVydHkoJ3RlbXBsYXRlJyxcbiAgICAgICAgZmFzdG4ucHJvcGVydHkoKS5vbignY2hhbmdlJywgdXBkYXRlSXRlbXMpXG4gICAgKTtcblxuICAgIGNvbXBvbmVudC5zZXRQcm9wZXJ0eSgnZW1wdHlUZW1wbGF0ZScsXG4gICAgICAgIGZhc3RuLnByb3BlcnR5KCkub24oJ2NoYW5nZScsIHVwZGF0ZUl0ZW1zKVxuICAgICk7XG5cbiAgICByZXR1cm4gY29tcG9uZW50O1xufTsiLCJ2YXIgZmxhdHRlbiA9IHJlcXVpcmUoJ2ZsYXR0ZW4nKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihlbGVtZW50KXtcbiAgICB2YXIgbGFzdENsYXNzZXMgPSBbXTtcblxuICAgIHJldHVybiBmdW5jdGlvbihjbGFzc2VzKXtcblxuICAgICAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gbGFzdENsYXNzZXMuam9pbignICcpO1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gY2xlYW5DbGFzc05hbWUocmVzdWx0LCBjbGFzc05hbWUpe1xuICAgICAgICAgICAgaWYodHlwZW9mIGNsYXNzTmFtZSA9PT0gJ3N0cmluZycgJiYgY2xhc3NOYW1lLm1hdGNoKC9cXHMvKSl7XG4gICAgICAgICAgICAgICAgY2xhc3NOYW1lID0gY2xhc3NOYW1lLnNwbGl0KCcgJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKEFycmF5LmlzQXJyYXkoY2xhc3NOYW1lKSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdC5jb25jYXQoY2xhc3NOYW1lLnJlZHVjZShjbGVhbkNsYXNzTmFtZSwgW10pKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoY2xhc3NOYW1lICE9IG51bGwgJiYgY2xhc3NOYW1lICE9PSAnJyl7XG4gICAgICAgICAgICAgICAgcmVzdWx0LnB1c2goU3RyaW5nKGNsYXNzTmFtZSkudHJpbSgpKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBuZXdDbGFzc2VzID0gY2xlYW5DbGFzc05hbWUoW10sIGNsYXNzZXMpLFxuICAgICAgICAgICAgY3VycmVudENsYXNzZXMgPSBlbGVtZW50LmNsYXNzTmFtZSA/IGVsZW1lbnQuY2xhc3NOYW1lLnNwbGl0KCcgJykgOiBbXTtcblxuICAgICAgICBsYXN0Q2xhc3Nlcy5tYXAoZnVuY3Rpb24oY2xhc3NOYW1lKXtcbiAgICAgICAgICAgIGlmKCFjbGFzc05hbWUpe1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGluZGV4ID0gY3VycmVudENsYXNzZXMuaW5kZXhPZihjbGFzc05hbWUpO1xuXG4gICAgICAgICAgICBpZih+aW5kZXgpe1xuICAgICAgICAgICAgICAgIGN1cnJlbnRDbGFzc2VzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGN1cnJlbnRDbGFzc2VzID0gY3VycmVudENsYXNzZXMuY29uY2F0KG5ld0NsYXNzZXMpO1xuICAgICAgICBsYXN0Q2xhc3NlcyA9IG5ld0NsYXNzZXM7XG5cbiAgICAgICAgZWxlbWVudC5jbGFzc05hbWUgPSBjdXJyZW50Q2xhc3Nlcy5qb2luKCcgJyk7XG4gICAgfTtcbn07IiwidmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcblxuZnVuY3Rpb24gdG9BcnJheShpdGVtcyl7XG4gICAgcmV0dXJuIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGl0ZW1zKTtcbn1cblxudmFyIGRlZXBSZWdleCA9IC9bfC5dL2k7XG5cbmZ1bmN0aW9uIG1hdGNoRGVlcChwYXRoKXtcbiAgICByZXR1cm4gKHBhdGggKyAnJykubWF0Y2goZGVlcFJlZ2V4KTtcbn1cblxuZnVuY3Rpb24gaXNXaWxkY2FyZFBhdGgocGF0aCl7XG4gICAgdmFyIHN0cmluZ1BhdGggPSAocGF0aCArICcnKTtcbiAgICByZXR1cm4gfnN0cmluZ1BhdGguaW5kZXhPZignKicpO1xufVxuXG5mdW5jdGlvbiBnZXRUYXJnZXRLZXkocGF0aCl7XG4gICAgdmFyIHN0cmluZ1BhdGggPSAocGF0aCArICcnKTtcbiAgICByZXR1cm4gc3RyaW5nUGF0aC5zcGxpdCgnfCcpLnNoaWZ0KCk7XG59XG5cbnZhciBldmVudFN5c3RlbVZlcnNpb24gPSAxLFxuICAgIGdsb2JhbEtleSA9ICdfZW50aUV2ZW50U3RhdGUnICsgZXZlbnRTeXN0ZW1WZXJzaW9uXG4gICAgZ2xvYmFsU3RhdGUgPSBnbG9iYWxbZ2xvYmFsS2V5XSA9IGdsb2JhbFtnbG9iYWxLZXldIHx8IHtcbiAgICAgICAgaW5zdGFuY2VzOiBbXVxuICAgIH07XG5cbnZhciBtb2RpZmllZEVudGllcyA9IGdsb2JhbFN0YXRlLm1vZGlmaWVkRW50aWVzID0gZ2xvYmFsU3RhdGUubW9kaWZpZWRFbnRpZXMgfHwgbmV3IFNldCgpLFxuICAgIHRyYWNrZWRPYmplY3RzID0gZ2xvYmFsU3RhdGUudHJhY2tlZE9iamVjdHMgPSBnbG9iYWxTdGF0ZS50cmFja2VkT2JqZWN0cyB8fCBuZXcgV2Vha01hcCgpO1xuXG5mdW5jdGlvbiBsZWZ0QW5kUmVzdChwYXRoKXtcbiAgICB2YXIgc3RyaW5nUGF0aCA9IChwYXRoICsgJycpO1xuXG4gICAgLy8gU3BlY2lhbCBjYXNlIHdoZW4geW91IHdhbnQgdG8gZmlsdGVyIG9uIHNlbGYgKC4pXG4gICAgaWYoc3RyaW5nUGF0aC5zbGljZSgwLDIpID09PSAnLnwnKXtcbiAgICAgICAgcmV0dXJuIFsnLicsIHN0cmluZ1BhdGguc2xpY2UoMildO1xuICAgIH1cblxuICAgIHZhciBtYXRjaCA9IG1hdGNoRGVlcChzdHJpbmdQYXRoKTtcbiAgICBpZihtYXRjaCl7XG4gICAgICAgIHJldHVybiBbc3RyaW5nUGF0aC5zbGljZSgwLCBtYXRjaC5pbmRleCksIHN0cmluZ1BhdGguc2xpY2UobWF0Y2guaW5kZXgrMSldO1xuICAgIH1cbiAgICByZXR1cm4gc3RyaW5nUGF0aDtcbn1cblxuZnVuY3Rpb24gaXNXaWxkY2FyZEtleShrZXkpe1xuICAgIHJldHVybiBrZXkuY2hhckF0KDApID09PSAnKic7XG59XG5cbmZ1bmN0aW9uIGlzRmVyYWxjYXJkS2V5KGtleSl7XG4gICAgcmV0dXJuIGtleSA9PT0gJyoqJztcbn1cblxuZnVuY3Rpb24gYWRkSGFuZGxlcihvYmplY3QsIGtleSwgaGFuZGxlcil7XG4gICAgdmFyIHRyYWNrZWRLZXlzID0gdHJhY2tlZE9iamVjdHMuZ2V0KG9iamVjdCk7XG5cbiAgICBpZih0cmFja2VkS2V5cyA9PSBudWxsKXtcbiAgICAgICAgdHJhY2tlZEtleXMgPSB7fTtcbiAgICAgICAgdHJhY2tlZE9iamVjdHMuc2V0KG9iamVjdCwgdHJhY2tlZEtleXMpO1xuICAgIH1cblxuICAgIHZhciBoYW5kbGVycyA9IHRyYWNrZWRLZXlzW2tleV07XG5cbiAgICBpZighaGFuZGxlcnMpe1xuICAgICAgICBoYW5kbGVycyA9IG5ldyBTZXQoKTtcbiAgICAgICAgdHJhY2tlZEtleXNba2V5XSA9IGhhbmRsZXJzO1xuICAgIH1cblxuICAgIGhhbmRsZXJzLmFkZChoYW5kbGVyKTtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlSGFuZGxlcihvYmplY3QsIGtleSwgaGFuZGxlcil7XG4gICAgdmFyIHRyYWNrZWRLZXlzID0gdHJhY2tlZE9iamVjdHMuZ2V0KG9iamVjdCk7XG5cbiAgICBpZih0cmFja2VkS2V5cyA9PSBudWxsKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBoYW5kbGVycyA9IHRyYWNrZWRLZXlzW2tleV07XG5cbiAgICBpZighaGFuZGxlcnMpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaGFuZGxlcnMuZGVsZXRlKGhhbmRsZXIpO1xufVxuXG5mdW5jdGlvbiB0cmFja09iamVjdHMoZXZlbnROYW1lLCB3ZWFrTWFwLCBoYW5kbGVyLCBvYmplY3QsIGtleSwgcGF0aCl7XG4gICAgaWYoIW9iamVjdCB8fCB0eXBlb2Ygb2JqZWN0ICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgZXZlbnRLZXkgPSBrZXkgPT09ICcqKicgPyAnKicgOiBrZXksXG4gICAgICAgIHRhcmdldCA9IG9iamVjdFtrZXldLFxuICAgICAgICB0YXJnZXRJc09iamVjdCA9IHRhcmdldCAmJiB0eXBlb2YgdGFyZ2V0ID09PSAnb2JqZWN0JztcblxuICAgIGlmKHRhcmdldElzT2JqZWN0ICYmIHdlYWtNYXAuaGFzKHRhcmdldCkpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGhhbmRsZSA9IGZ1bmN0aW9uKHZhbHVlLCBldmVudCwgZW1pdEtleSl7XG4gICAgICAgIGlmKGV2ZW50S2V5ICE9PSAnKicgJiYgdHlwZW9mIG9iamVjdFtldmVudEtleV0gPT09ICdvYmplY3QnICYmIG9iamVjdFtldmVudEtleV0gIT09IHRhcmdldCl7XG4gICAgICAgICAgICBpZih0YXJnZXRJc09iamVjdCl7XG4gICAgICAgICAgICAgICAgd2Vha01hcC5kZWxldGUodGFyZ2V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlbW92ZUhhbmRsZXIob2JqZWN0LCBldmVudEtleSwgaGFuZGxlKTtcbiAgICAgICAgICAgIHRyYWNrT2JqZWN0cyhldmVudE5hbWUsIHdlYWtNYXAsIGhhbmRsZXIsIG9iamVjdCwga2V5LCBwYXRoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGV2ZW50S2V5ID09PSAnKicpe1xuICAgICAgICAgICAgdHJhY2tLZXlzKG9iamVjdCwga2V5LCBwYXRoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCF3ZWFrTWFwLmhhcyhvYmplY3QpKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGtleSAhPT0gJyoqJyB8fCAhcGF0aCl7XG4gICAgICAgICAgICBoYW5kbGVyKHZhbHVlLCBldmVudCwgZW1pdEtleSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiB0cmFja0tleXModGFyZ2V0LCByb290LCByZXN0KXtcbiAgICAgICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyh0YXJnZXQpO1xuICAgICAgICBmb3IodmFyIGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBpZihpc0ZlcmFsY2FyZEtleShyb290KSl7XG4gICAgICAgICAgICAgICAgdHJhY2tPYmplY3RzKGV2ZW50TmFtZSwgd2Vha01hcCwgaGFuZGxlciwgdGFyZ2V0LCBrZXlzW2ldLCAnKionICsgKHJlc3QgPyAnLicgOiAnJykgKyAocmVzdCB8fCAnJykpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgdHJhY2tPYmplY3RzKGV2ZW50TmFtZSwgd2Vha01hcCwgaGFuZGxlciwgdGFyZ2V0LCBrZXlzW2ldLCByZXN0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFkZEhhbmRsZXIob2JqZWN0LCBldmVudEtleSwgaGFuZGxlKTtcblxuICAgIGlmKCF0YXJnZXRJc09iamVjdCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBUaGlzIHdvdWxkIG9idmlvdXNseSBiZSBiZXR0ZXIgaW1wbGVtZW50ZWQgd2l0aCBhIFdlYWtTZXQsXG4gICAgLy8gQnV0IEknbSB0cnlpbmcgdG8ga2VlcCBmaWxlc2l6ZSBkb3duLCBhbmQgSSBkb24ndCByZWFsbHkgd2FudCBhbm90aGVyXG4gICAgLy8gcG9seWZpbGwgd2hlbiBXZWFrTWFwIHdvcmtzIHdlbGwgZW5vdWdoIGZvciB0aGUgdGFzay5cbiAgICB3ZWFrTWFwLnNldCh0YXJnZXQsIG51bGwpO1xuXG4gICAgaWYoIXBhdGgpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHJvb3RBbmRSZXN0ID0gbGVmdEFuZFJlc3QocGF0aCksXG4gICAgICAgIHJvb3QsXG4gICAgICAgIHJlc3Q7XG5cbiAgICBpZighQXJyYXkuaXNBcnJheShyb290QW5kUmVzdCkpe1xuICAgICAgICByb290ID0gcm9vdEFuZFJlc3Q7XG4gICAgfWVsc2V7XG4gICAgICAgIHJvb3QgPSByb290QW5kUmVzdFswXTtcbiAgICAgICAgcmVzdCA9IHJvb3RBbmRSZXN0WzFdO1xuXG4gICAgICAgIC8vIElmIHRoZSByb290IGlzICcuJywgd2F0Y2ggZm9yIGV2ZW50cyBvbiAqXG4gICAgICAgIGlmKHJvb3QgPT09ICcuJyl7XG4gICAgICAgICAgICByb290ID0gJyonO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYodGFyZ2V0SXNPYmplY3QgJiYgaXNXaWxkY2FyZEtleShyb290KSl7XG4gICAgICAgIHRyYWNrS2V5cyh0YXJnZXQsIHJvb3QsIHJlc3QpO1xuICAgIH1cblxuICAgIHRyYWNrT2JqZWN0cyhldmVudE5hbWUsIHdlYWtNYXAsIGhhbmRsZXIsIHRhcmdldCwgcm9vdCwgcmVzdCk7XG59XG5cbnZhciB0cmFja2VkRXZlbnRzID0gbmV3IFdlYWtNYXAoKTtcbmZ1bmN0aW9uIGNyZWF0ZUhhbmRsZXIoZW50aSwgdHJhY2tlZE9iamVjdFBhdGhzLCB0cmFja2VkUGF0aHMsIGV2ZW50TmFtZSl7XG4gICAgdmFyIG9sZE1vZGVsID0gZW50aS5fbW9kZWw7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGV2ZW50LCBlbWl0S2V5KXtcbiAgICAgICAgdHJhY2tlZFBhdGhzLmVudGlzLmZvckVhY2goZnVuY3Rpb24oZW50aSl7XG4gICAgICAgICAgICBpZihlbnRpLl9lbWl0dGVkRXZlbnRzW2V2ZW50TmFtZV0gPT09IGVtaXRLZXkpe1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoZW50aS5fbW9kZWwgIT09IG9sZE1vZGVsKXtcbiAgICAgICAgICAgICAgICB0cmFja2VkUGF0aHMuZW50aXMuZGVsZXRlKGVudGkpO1xuICAgICAgICAgICAgICAgIGlmKHRyYWNrZWRQYXRocy5lbnRpcy5zaXplID09PSAwKXtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHRyYWNrZWRPYmplY3RQYXRoc1tldmVudE5hbWVdO1xuICAgICAgICAgICAgICAgICAgICBpZighT2JqZWN0LmtleXModHJhY2tlZE9iamVjdFBhdGhzKS5sZW5ndGgpe1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJhY2tlZEV2ZW50cy5kZWxldGUob2xkTW9kZWwpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZW50aS5fZW1pdHRlZEV2ZW50c1tldmVudE5hbWVdID0gZW1pdEtleTtcblxuICAgICAgICAgICAgdmFyIHRhcmdldEtleSA9IGdldFRhcmdldEtleShldmVudE5hbWUpLFxuICAgICAgICAgICAgICAgIHZhbHVlID0gaXNXaWxkY2FyZFBhdGgodGFyZ2V0S2V5KSA/IHVuZGVmaW5lZCA6IGVudGkuZ2V0KHRhcmdldEtleSk7XG5cbiAgICAgICAgICAgIGVudGkuZW1pdChldmVudE5hbWUsIHZhbHVlLCBldmVudCk7XG4gICAgICAgIH0pO1xuICAgIH07XG59XG5cbmZ1bmN0aW9uIHRyYWNrUGF0aChlbnRpLCBldmVudE5hbWUpe1xuICAgIHZhciBvYmplY3QgPSBlbnRpLl9tb2RlbCxcbiAgICAgICAgdHJhY2tlZE9iamVjdFBhdGhzID0gdHJhY2tlZEV2ZW50cy5nZXQob2JqZWN0KTtcblxuICAgIGlmKCF0cmFja2VkT2JqZWN0UGF0aHMpe1xuICAgICAgICB0cmFja2VkT2JqZWN0UGF0aHMgPSB7fTtcbiAgICAgICAgdHJhY2tlZEV2ZW50cy5zZXQob2JqZWN0LCB0cmFja2VkT2JqZWN0UGF0aHMpO1xuICAgIH1cblxuICAgIHZhciB0cmFja2VkUGF0aHMgPSB0cmFja2VkT2JqZWN0UGF0aHNbZXZlbnROYW1lXTtcblxuICAgIGlmKCF0cmFja2VkUGF0aHMpe1xuICAgICAgICB0cmFja2VkUGF0aHMgPSB7XG4gICAgICAgICAgICBlbnRpczogbmV3IFNldCgpLFxuICAgICAgICAgICAgdHJhY2tlZE9iamVjdHM6IG5ldyBXZWFrTWFwKClcbiAgICAgICAgfTtcbiAgICAgICAgdHJhY2tlZE9iamVjdFBhdGhzW2V2ZW50TmFtZV0gPSB0cmFja2VkUGF0aHM7XG4gICAgfWVsc2UgaWYodHJhY2tlZFBhdGhzLmVudGlzLmhhcyhlbnRpKSl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0cmFja2VkUGF0aHMuZW50aXMuYWRkKGVudGkpO1xuXG4gICAgdmFyIGhhbmRsZXIgPSBjcmVhdGVIYW5kbGVyKGVudGksIHRyYWNrZWRPYmplY3RQYXRocywgdHJhY2tlZFBhdGhzLCBldmVudE5hbWUpO1xuXG4gICAgdHJhY2tPYmplY3RzKGV2ZW50TmFtZSwgdHJhY2tlZFBhdGhzLnRyYWNrZWRPYmplY3RzLCBoYW5kbGVyLCB7bW9kZWw6b2JqZWN0fSwgJ21vZGVsJywgZXZlbnROYW1lKTtcbn1cblxuZnVuY3Rpb24gdHJhY2tQYXRocyhlbnRpKXtcbiAgICBpZighZW50aS5fZXZlbnRzIHx8ICFlbnRpLl9tb2RlbCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBmb3IodmFyIGtleSBpbiBlbnRpLl9ldmVudHMpe1xuICAgICAgICB0cmFja1BhdGgoZW50aSwga2V5KTtcbiAgICB9XG4gICAgbW9kaWZpZWRFbnRpZXMuZGVsZXRlKGVudGkpO1xufVxuXG5mdW5jdGlvbiBlbWl0RXZlbnQob2JqZWN0LCBrZXksIHZhbHVlLCBlbWl0S2V5KXtcblxuICAgIG1vZGlmaWVkRW50aWVzLmZvckVhY2godHJhY2tQYXRocyk7XG5cbiAgICB2YXIgdHJhY2tlZEtleXMgPSB0cmFja2VkT2JqZWN0cy5nZXQob2JqZWN0KTtcblxuICAgIGlmKCF0cmFja2VkS2V5cyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgZXZlbnQgPSB7XG4gICAgICAgIHZhbHVlOiB2YWx1ZSxcbiAgICAgICAga2V5OiBrZXksXG4gICAgICAgIG9iamVjdDogb2JqZWN0XG4gICAgfTtcblxuICAgIGZ1bmN0aW9uIGVtaXRGb3JLZXkoaGFuZGxlcil7XG4gICAgICAgIGhhbmRsZXIoZXZlbnQsIGVtaXRLZXkpO1xuICAgIH1cblxuICAgIGlmKHRyYWNrZWRLZXlzW2tleV0pe1xuICAgICAgICB0cmFja2VkS2V5c1trZXldLmZvckVhY2goZW1pdEZvcktleSk7XG4gICAgfVxuXG4gICAgaWYodHJhY2tlZEtleXNbJyonXSl7XG4gICAgICAgIHRyYWNrZWRLZXlzWycqJ10uZm9yRWFjaChlbWl0Rm9yS2V5KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGVtaXQoZXZlbnRzKXtcbiAgICB2YXIgZW1pdEtleSA9IHt9O1xuICAgIGV2ZW50cy5mb3JFYWNoKGZ1bmN0aW9uKGV2ZW50KXtcbiAgICAgICAgZW1pdEV2ZW50KGV2ZW50WzBdLCBldmVudFsxXSwgZXZlbnRbMl0sIGVtaXRLZXkpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBFbnRpKG1vZGVsKXtcbiAgICB2YXIgZGV0YWNoZWQgPSBtb2RlbCA9PT0gZmFsc2U7XG5cbiAgICBpZighbW9kZWwgfHwgKHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZGVsICE9PSAnZnVuY3Rpb24nKSl7XG4gICAgICAgIG1vZGVsID0ge307XG4gICAgfVxuXG4gICAgdGhpcy5fZW1pdHRlZEV2ZW50cyA9IHt9O1xuICAgIGlmKGRldGFjaGVkKXtcbiAgICAgICAgdGhpcy5fbW9kZWwgPSB7fTtcbiAgICB9ZWxzZXtcbiAgICAgICAgdGhpcy5hdHRhY2gobW9kZWwpO1xuICAgIH1cblxuICAgIHRoaXMub24oJ25ld0xpc3RlbmVyJywgZnVuY3Rpb24oKXtcbiAgICAgICAgbW9kaWZpZWRFbnRpZXMuYWRkKHRoaXMpO1xuICAgIH0pO1xufVxuRW50aS5nZXQgPSBmdW5jdGlvbihtb2RlbCwga2V5KXtcbiAgICBpZighbW9kZWwgfHwgdHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBrZXkgPSBnZXRUYXJnZXRLZXkoa2V5KTtcblxuICAgIGlmKGtleSA9PT0gJy4nKXtcbiAgICAgICAgcmV0dXJuIG1vZGVsO1xuICAgIH1cblxuXG4gICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xuICAgICAgICByZXR1cm4gRW50aS5nZXQobW9kZWxbcGF0aFswXV0sIHBhdGhbMV0pO1xuICAgIH1cblxuICAgIHJldHVybiBtb2RlbFtrZXldO1xufTtcbkVudGkuc2V0ID0gZnVuY3Rpb24obW9kZWwsIGtleSwgdmFsdWUpe1xuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGtleSA9IGdldFRhcmdldEtleShrZXkpO1xuXG4gICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xuICAgICAgICByZXR1cm4gRW50aS5zZXQobW9kZWxbcGF0aFswXV0sIHBhdGhbMV0sIHZhbHVlKTtcbiAgICB9XG5cbiAgICB2YXIgb3JpZ2luYWwgPSBtb2RlbFtrZXldO1xuXG4gICAgaWYodHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0JyAmJiB2YWx1ZSA9PT0gb3JpZ2luYWwpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGtleXNDaGFuZ2VkID0gIShrZXkgaW4gbW9kZWwpO1xuXG4gICAgbW9kZWxba2V5XSA9IHZhbHVlO1xuXG4gICAgdmFyIGV2ZW50cyA9IFtbbW9kZWwsIGtleSwgdmFsdWVdXTtcblxuICAgIGlmKGtleXNDaGFuZ2VkKXtcbiAgICAgICAgaWYoQXJyYXkuaXNBcnJheShtb2RlbCkpe1xuICAgICAgICAgICAgZXZlbnRzLnB1c2goW21vZGVsLCAnbGVuZ3RoJywgbW9kZWwubGVuZ3RoXSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBlbWl0KGV2ZW50cyk7XG59O1xuRW50aS5wdXNoID0gZnVuY3Rpb24obW9kZWwsIGtleSwgdmFsdWUpe1xuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciB0YXJnZXQ7XG4gICAgaWYoYXJndW1lbnRzLmxlbmd0aCA8IDMpe1xuICAgICAgICB2YWx1ZSA9IGtleTtcbiAgICAgICAga2V5ID0gJy4nO1xuICAgICAgICB0YXJnZXQgPSBtb2RlbDtcbiAgICB9ZWxzZXtcbiAgICAgICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgICAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgICAgIHJldHVybiBFbnRpLnB1c2gobW9kZWxbcGF0aFswXV0sIHBhdGhbMV0sIHZhbHVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRhcmdldCA9IG1vZGVsW2tleV07XG4gICAgfVxuXG4gICAgaWYoIUFycmF5LmlzQXJyYXkodGFyZ2V0KSl7XG4gICAgICAgIHRocm93ICdUaGUgdGFyZ2V0IGlzIG5vdCBhbiBhcnJheS4nO1xuICAgIH1cblxuICAgIHRhcmdldC5wdXNoKHZhbHVlKTtcblxuICAgIHZhciBldmVudHMgPSBbXG4gICAgICAgIFt0YXJnZXQsIHRhcmdldC5sZW5ndGgtMSwgdmFsdWVdLFxuICAgICAgICBbdGFyZ2V0LCAnbGVuZ3RoJywgdGFyZ2V0Lmxlbmd0aF1cbiAgICBdO1xuXG4gICAgZW1pdChldmVudHMpO1xufTtcbkVudGkuaW5zZXJ0ID0gZnVuY3Rpb24obW9kZWwsIGtleSwgdmFsdWUsIGluZGV4KXtcbiAgICBpZighbW9kZWwgfHwgdHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cblxuICAgIHZhciB0YXJnZXQ7XG4gICAgaWYoYXJndW1lbnRzLmxlbmd0aCA8IDQpe1xuICAgICAgICBpbmRleCA9IHZhbHVlO1xuICAgICAgICB2YWx1ZSA9IGtleTtcbiAgICAgICAga2V5ID0gJy4nO1xuICAgICAgICB0YXJnZXQgPSBtb2RlbDtcbiAgICB9ZWxzZXtcbiAgICAgICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgICAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgICAgIHJldHVybiBFbnRpLmluc2VydChtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSwgdmFsdWUsIGluZGV4KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRhcmdldCA9IG1vZGVsW2tleV07XG4gICAgfVxuXG4gICAgaWYoIUFycmF5LmlzQXJyYXkodGFyZ2V0KSl7XG4gICAgICAgIHRocm93ICdUaGUgdGFyZ2V0IGlzIG5vdCBhbiBhcnJheS4nO1xuICAgIH1cblxuICAgIHRhcmdldC5zcGxpY2UoaW5kZXgsIDAsIHZhbHVlKTtcblxuICAgIHZhciBldmVudHMgPSBbXG4gICAgICAgIFt0YXJnZXQsIGluZGV4LCB2YWx1ZV0sXG4gICAgICAgIFt0YXJnZXQsICdsZW5ndGgnLCB0YXJnZXQubGVuZ3RoXVxuICAgIF07XG5cbiAgICBlbWl0KGV2ZW50cyk7XG59O1xuRW50aS5yZW1vdmUgPSBmdW5jdGlvbihtb2RlbCwga2V5LCBzdWJLZXkpe1xuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBwYXRoID0gbGVmdEFuZFJlc3Qoa2V5KTtcbiAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgcmV0dXJuIEVudGkucmVtb3ZlKG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdLCBzdWJLZXkpO1xuICAgIH1cblxuICAgIC8vIFJlbW92ZSBhIGtleSBvZmYgb2YgYW4gb2JqZWN0IGF0ICdrZXknXG4gICAgaWYoc3ViS2V5ICE9IG51bGwpe1xuICAgICAgICBFbnRpLnJlbW92ZShtb2RlbFtrZXldLCBzdWJLZXkpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYoa2V5ID09PSAnLicpe1xuICAgICAgICB0aHJvdyAnLiAoc2VsZikgaXMgbm90IGEgdmFsaWQga2V5IHRvIHJlbW92ZSc7XG4gICAgfVxuXG4gICAgdmFyIGV2ZW50cyA9IFtdO1xuXG4gICAgaWYoQXJyYXkuaXNBcnJheShtb2RlbCkpe1xuICAgICAgICBtb2RlbC5zcGxpY2Uoa2V5LCAxKTtcbiAgICAgICAgZXZlbnRzLnB1c2goW21vZGVsLCAnbGVuZ3RoJywgbW9kZWwubGVuZ3RoXSk7XG4gICAgfWVsc2V7XG4gICAgICAgIGRlbGV0ZSBtb2RlbFtrZXldO1xuICAgICAgICBldmVudHMucHVzaChbbW9kZWwsIGtleV0pO1xuICAgIH1cblxuICAgIGVtaXQoZXZlbnRzKTtcbn07XG5FbnRpLm1vdmUgPSBmdW5jdGlvbihtb2RlbCwga2V5LCBpbmRleCl7XG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xuICAgICAgICByZXR1cm4gRW50aS5tb3ZlKG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdLCBpbmRleCk7XG4gICAgfVxuXG4gICAgaWYoa2V5ID09PSBpbmRleCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZighQXJyYXkuaXNBcnJheShtb2RlbCkpe1xuICAgICAgICB0aHJvdyAnVGhlIG1vZGVsIGlzIG5vdCBhbiBhcnJheS4nO1xuICAgIH1cblxuICAgIHZhciBpdGVtID0gbW9kZWxba2V5XTtcblxuICAgIG1vZGVsLnNwbGljZShrZXksIDEpO1xuXG4gICAgbW9kZWwuc3BsaWNlKGluZGV4IC0gKGluZGV4ID4ga2V5ID8gMCA6IDEpLCAwLCBpdGVtKTtcblxuICAgIGVtaXQoW1ttb2RlbCwgaW5kZXgsIGl0ZW1dXSk7XG59O1xuRW50aS51cGRhdGUgPSBmdW5jdGlvbihtb2RlbCwga2V5LCB2YWx1ZSl7XG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHRhcmdldCxcbiAgICAgICAgaXNBcnJheSA9IEFycmF5LmlzQXJyYXkodmFsdWUpO1xuXG4gICAgaWYoYXJndW1lbnRzLmxlbmd0aCA8IDMpe1xuICAgICAgICB2YWx1ZSA9IGtleTtcbiAgICAgICAga2V5ID0gJy4nO1xuICAgICAgICB0YXJnZXQgPSBtb2RlbDtcbiAgICB9ZWxzZXtcbiAgICAgICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgICAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgICAgIHJldHVybiBFbnRpLnVwZGF0ZShtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSwgdmFsdWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGFyZ2V0ID0gbW9kZWxba2V5XTtcblxuICAgICAgICBpZih0YXJnZXQgPT0gbnVsbCl7XG4gICAgICAgICAgICBtb2RlbFtrZXldID0gaXNBcnJheSA/IFtdIDoge307XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZih0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgdGhyb3cgJ1RoZSB2YWx1ZSBpcyBub3QgYW4gb2JqZWN0Lic7XG4gICAgfVxuXG4gICAgaWYodHlwZW9mIHRhcmdldCAhPT0gJ29iamVjdCcpe1xuICAgICAgICB0aHJvdyAnVGhlIHRhcmdldCBpcyBub3QgYW4gb2JqZWN0Lic7XG4gICAgfVxuXG4gICAgdmFyIGV2ZW50cyA9IFtdO1xuXG4gICAgZnVuY3Rpb24gdXBkYXRlVGFyZ2V0KHRhcmdldCwgdmFsdWUpe1xuICAgICAgICBmb3IodmFyIGtleSBpbiB2YWx1ZSl7XG4gICAgICAgICAgICBpZih0YXJnZXRba2V5XSAmJiB0eXBlb2YgdGFyZ2V0W2tleV0gPT09ICdvYmplY3QnKXtcbiAgICAgICAgICAgICAgICB1cGRhdGVUYXJnZXQodGFyZ2V0W2tleV0sIHZhbHVlW2tleV0pO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGFyZ2V0W2tleV0gPSB2YWx1ZVtrZXldO1xuICAgICAgICAgICAgZXZlbnRzLnB1c2goW3RhcmdldCwga2V5LCB2YWx1ZVtrZXldXSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihBcnJheS5pc0FycmF5KHRhcmdldCkpe1xuICAgICAgICAgICAgZXZlbnRzLnB1c2goW3RhcmdldCwgJ2xlbmd0aCcsIHRhcmdldC5sZW5ndGhdKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHVwZGF0ZVRhcmdldCh0YXJnZXQsIHZhbHVlKTtcblxuICAgIGVtaXQoZXZlbnRzKTtcbn07XG5FbnRpLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRXZlbnRFbWl0dGVyLnByb3RvdHlwZSk7XG5FbnRpLnByb3RvdHlwZS5fbWF4TGlzdGVuZXJzID0gMTAwO1xuRW50aS5wcm90b3R5cGUuY29uc3RydWN0b3IgPSBFbnRpO1xuRW50aS5wcm90b3R5cGUuYXR0YWNoID0gZnVuY3Rpb24obW9kZWwpe1xuICAgIGlmKHRoaXMuX21vZGVsICE9PSBtb2RlbCl7XG4gICAgICAgIHRoaXMuZGV0YWNoKCk7XG4gICAgfVxuXG4gICAgbW9kaWZpZWRFbnRpZXMuYWRkKHRoaXMpO1xuICAgIHRoaXMuX2F0dGFjaGVkID0gdHJ1ZTtcbiAgICB0aGlzLl9tb2RlbCA9IG1vZGVsO1xuICAgIHRoaXMuZW1pdCgnYXR0YWNoJywgbW9kZWwpO1xufTtcbkVudGkucHJvdG90eXBlLmRldGFjaCA9IGZ1bmN0aW9uKCl7XG4gICAgbW9kaWZpZWRFbnRpZXMuZGVsZXRlKHRoaXMpO1xuXG4gICAgdGhpcy5fZW1pdHRlZEV2ZW50cyA9IHt9O1xuICAgIHRoaXMuX21vZGVsID0ge307XG4gICAgdGhpcy5fYXR0YWNoZWQgPSBmYWxzZTtcbiAgICB0aGlzLmVtaXQoJ2RldGFjaCcpO1xufTtcbkVudGkucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbigpe1xuICAgIHRoaXMuZGV0YWNoKCk7XG4gICAgdGhpcy5fZXZlbnRzID0gbnVsbDtcbiAgICB0aGlzLmVtaXQoJ2Rlc3Ryb3knKTtcbn07XG5FbnRpLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihrZXkpe1xuICAgIHJldHVybiBFbnRpLmdldCh0aGlzLl9tb2RlbCwga2V5KTtcbn07XG5cbkVudGkucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUpe1xuICAgIHJldHVybiBFbnRpLnNldCh0aGlzLl9tb2RlbCwga2V5LCB2YWx1ZSk7XG59O1xuXG5FbnRpLnByb3RvdHlwZS5wdXNoID0gZnVuY3Rpb24oa2V5LCB2YWx1ZSl7XG4gICAgcmV0dXJuIEVudGkucHVzaC5hcHBseShudWxsLCBbdGhpcy5fbW9kZWxdLmNvbmNhdCh0b0FycmF5KGFyZ3VtZW50cykpKTtcbn07XG5cbkVudGkucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUsIGluZGV4KXtcbiAgICByZXR1cm4gRW50aS5pbnNlcnQuYXBwbHkobnVsbCwgW3RoaXMuX21vZGVsXS5jb25jYXQodG9BcnJheShhcmd1bWVudHMpKSk7XG59O1xuXG5FbnRpLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbihrZXksIHN1YktleSl7XG4gICAgcmV0dXJuIEVudGkucmVtb3ZlLmFwcGx5KG51bGwsIFt0aGlzLl9tb2RlbF0uY29uY2F0KHRvQXJyYXkoYXJndW1lbnRzKSkpO1xufTtcblxuRW50aS5wcm90b3R5cGUubW92ZSA9IGZ1bmN0aW9uKGtleSwgaW5kZXgpe1xuICAgIHJldHVybiBFbnRpLm1vdmUuYXBwbHkobnVsbCwgW3RoaXMuX21vZGVsXS5jb25jYXQodG9BcnJheShhcmd1bWVudHMpKSk7XG59O1xuXG5FbnRpLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbihrZXksIGluZGV4KXtcbiAgICByZXR1cm4gRW50aS51cGRhdGUuYXBwbHkobnVsbCwgW3RoaXMuX21vZGVsXS5jb25jYXQodG9BcnJheShhcmd1bWVudHMpKSk7XG59O1xuRW50aS5wcm90b3R5cGUuaXNBdHRhY2hlZCA9IGZ1bmN0aW9uKCl7XG4gICAgcmV0dXJuIHRoaXMuX2F0dGFjaGVkO1xufTtcbkVudGkucHJvdG90eXBlLmF0dGFjaGVkQ291bnQgPSBmdW5jdGlvbigpe1xuICAgIHJldHVybiBtb2RpZmllZEVudGllcy5zaXplO1xufTtcblxuRW50aS5pc0VudGkgPSBmdW5jdGlvbih0YXJnZXQpe1xuICAgIHJldHVybiB0YXJnZXQgJiYgISF+Z2xvYmFsU3RhdGUuaW5zdGFuY2VzLmluZGV4T2YodGFyZ2V0LmNvbnN0cnVjdG9yKTtcbn07XG5cbmdsb2JhbFN0YXRlLmluc3RhbmNlcy5wdXNoKEVudGkpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEVudGk7XG4iLCJmdW5jdGlvbiBmbGF0TWVyZ2UoYSxiKXtcbiAgICBpZighYiB8fCB0eXBlb2YgYiAhPT0gJ29iamVjdCcpe1xuICAgICAgICBiID0ge307XG4gICAgfVxuXG4gICAgaWYoIWEgfHwgdHlwZW9mIGEgIT09ICdvYmplY3QnKXtcbiAgICAgICAgYSA9IG5ldyBiLmNvbnN0cnVjdG9yKCk7XG4gICAgfVxuXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBhLmNvbnN0cnVjdG9yKCksXG4gICAgICAgIGFLZXlzID0gT2JqZWN0LmtleXMoYSksXG4gICAgICAgIGJLZXlzID0gT2JqZWN0LmtleXMoYik7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgYUtleXMubGVuZ3RoOyBpKyspe1xuICAgICAgICByZXN1bHRbYUtleXNbaV1dID0gYVthS2V5c1tpXV07XG4gICAgfVxuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGJLZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgcmVzdWx0W2JLZXlzW2ldXSA9IGJbYktleXNbaV1dO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZmxhdE1lcmdlOyIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZmxhdHRlbihsaXN0LCBkZXB0aCkge1xuICBkZXB0aCA9ICh0eXBlb2YgZGVwdGggPT0gJ251bWJlcicpID8gZGVwdGggOiBJbmZpbml0eTtcblxuICByZXR1cm4gX2ZsYXR0ZW4obGlzdCwgMSk7XG5cbiAgZnVuY3Rpb24gX2ZsYXR0ZW4obGlzdCwgZCkge1xuICAgIHJldHVybiBsaXN0LnJlZHVjZShmdW5jdGlvbiAoYWNjLCBpdGVtKSB7XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShpdGVtKSAmJiBkIDwgZGVwdGgpIHtcbiAgICAgICAgcmV0dXJuIGFjYy5jb25jYXQoX2ZsYXR0ZW4oaXRlbSwgZCArIDEpKTtcbiAgICAgIH1cbiAgICAgIGVsc2Uge1xuICAgICAgICByZXR1cm4gYWNjLmNvbmNhdChpdGVtKTtcbiAgICAgIH1cbiAgICB9LCBbXSk7XG4gIH1cbn07XG4iLCJcInVzZSBzdHJpY3RcIjtcblxuLyogZ2xvYmFsIG1vZHVsZSwgZGVmaW5lICovXG5cbmZ1bmN0aW9uIG1hcEVhY2gobWFwLCBvcGVyYXRpb24pe1xuICB2YXIga2V5cyA9IG1hcC5rZXlzKCk7XG4gIHZhciBuZXh0O1xuICB3aGlsZSghKG5leHQgPSBrZXlzLm5leHQoKSkuZG9uZSkge1xuICAgIG9wZXJhdGlvbihtYXAuZ2V0KG5leHQudmFsdWUpLCBuZXh0LnZhbHVlLCBtYXApO1xuICB9XG59XG5cbnZhciBNdWx0aW1hcCA9IChmdW5jdGlvbigpIHtcbiAgdmFyIG1hcEN0b3I7XG4gIGlmICh0eXBlb2YgTWFwICE9PSAndW5kZWZpbmVkJykge1xuICAgIG1hcEN0b3IgPSBNYXA7XG4gIH1cblxuICBmdW5jdGlvbiBNdWx0aW1hcChpdGVyYWJsZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHNlbGYuX21hcCA9IG1hcEN0b3I7XG5cbiAgICBpZiAoTXVsdGltYXAuTWFwKSB7XG4gICAgICBzZWxmLl9tYXAgPSBNdWx0aW1hcC5NYXA7XG4gICAgfVxuXG4gICAgc2VsZi5fID0gc2VsZi5fbWFwID8gbmV3IHNlbGYuX21hcCgpIDoge307XG5cbiAgICBpZiAoaXRlcmFibGUpIHtcbiAgICAgIGl0ZXJhYmxlLmZvckVhY2goZnVuY3Rpb24oaSkge1xuICAgICAgICBzZWxmLnNldChpWzBdLCBpWzFdKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBAcGFyYW0ge09iamVjdH0ga2V5XG4gICAqIEByZXR1cm4ge0FycmF5fSBBbiBhcnJheSBvZiB2YWx1ZXMsIHVuZGVmaW5lZCBpZiBubyBzdWNoIGEga2V5O1xuICAgKi9cbiAgTXVsdGltYXAucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGtleSkge1xuICAgIHJldHVybiB0aGlzLl9tYXAgPyB0aGlzLl8uZ2V0KGtleSkgOiB0aGlzLl9ba2V5XTtcbiAgfTtcblxuICAvKipcbiAgICogQHBhcmFtIHtPYmplY3R9IGtleVxuICAgKiBAcGFyYW0ge09iamVjdH0gdmFsLi4uXG4gICAqL1xuICBNdWx0aW1hcC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oa2V5LCB2YWwpIHtcbiAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG5cbiAgICBrZXkgPSBhcmdzLnNoaWZ0KCk7XG5cbiAgICB2YXIgZW50cnkgPSB0aGlzLmdldChrZXkpO1xuICAgIGlmICghZW50cnkpIHtcbiAgICAgIGVudHJ5ID0gW107XG4gICAgICBpZiAodGhpcy5fbWFwKVxuICAgICAgICB0aGlzLl8uc2V0KGtleSwgZW50cnkpO1xuICAgICAgZWxzZVxuICAgICAgICB0aGlzLl9ba2V5XSA9IGVudHJ5O1xuICAgIH1cblxuICAgIEFycmF5LnByb3RvdHlwZS5wdXNoLmFwcGx5KGVudHJ5LCBhcmdzKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfTtcblxuICAvKipcbiAgICogQHBhcmFtIHtPYmplY3R9IGtleVxuICAgKiBAcGFyYW0ge09iamVjdD19IHZhbFxuICAgKiBAcmV0dXJuIHtib29sZWFufSB0cnVlIGlmIGFueSB0aGluZyBjaGFuZ2VkXG4gICAqL1xuICBNdWx0aW1hcC5wcm90b3R5cGUuZGVsZXRlID0gZnVuY3Rpb24oa2V5LCB2YWwpIHtcbiAgICBpZiAoIXRoaXMuaGFzKGtleSkpXG4gICAgICByZXR1cm4gZmFsc2U7XG5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PSAxKSB7XG4gICAgICB0aGlzLl9tYXAgPyAodGhpcy5fLmRlbGV0ZShrZXkpKSA6IChkZWxldGUgdGhpcy5fW2tleV0pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBlbnRyeSA9IHRoaXMuZ2V0KGtleSk7XG4gICAgICB2YXIgaWR4ID0gZW50cnkuaW5kZXhPZih2YWwpO1xuICAgICAgaWYgKGlkeCAhPSAtMSkge1xuICAgICAgICBlbnRyeS5zcGxpY2UoaWR4LCAxKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9O1xuXG4gIC8qKlxuICAgKiBAcGFyYW0ge09iamVjdH0ga2V5XG4gICAqIEBwYXJhbSB7T2JqZWN0PX0gdmFsXG4gICAqIEByZXR1cm4ge2Jvb2xlYW59IHdoZXRoZXIgdGhlIG1hcCBjb250YWlucyAna2V5JyBvciAna2V5PT52YWwnIHBhaXJcbiAgICovXG4gIE11bHRpbWFwLnByb3RvdHlwZS5oYXMgPSBmdW5jdGlvbihrZXksIHZhbCkge1xuICAgIHZhciBoYXNLZXkgPSB0aGlzLl9tYXAgPyB0aGlzLl8uaGFzKGtleSkgOiB0aGlzLl8uaGFzT3duUHJvcGVydHkoa2V5KTtcblxuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09IDEgfHwgIWhhc0tleSlcbiAgICAgIHJldHVybiBoYXNLZXk7XG5cbiAgICB2YXIgZW50cnkgPSB0aGlzLmdldChrZXkpIHx8IFtdO1xuICAgIHJldHVybiBlbnRyeS5pbmRleE9mKHZhbCkgIT0gLTE7XG4gIH07XG5cblxuICAvKipcbiAgICogQHJldHVybiB7QXJyYXl9IGFsbCB0aGUga2V5cyBpbiB0aGUgbWFwXG4gICAqL1xuICBNdWx0aW1hcC5wcm90b3R5cGUua2V5cyA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLl9tYXApXG4gICAgICByZXR1cm4gbWFrZUl0ZXJhdG9yKHRoaXMuXy5rZXlzKCkpO1xuXG4gICAgcmV0dXJuIG1ha2VJdGVyYXRvcihPYmplY3Qua2V5cyh0aGlzLl8pKTtcbiAgfTtcblxuICAvKipcbiAgICogQHJldHVybiB7QXJyYXl9IGFsbCB0aGUgdmFsdWVzIGluIHRoZSBtYXBcbiAgICovXG4gIE11bHRpbWFwLnByb3RvdHlwZS52YWx1ZXMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgdmFscyA9IFtdO1xuICAgIHRoaXMuZm9yRWFjaEVudHJ5KGZ1bmN0aW9uKGVudHJ5KSB7XG4gICAgICBBcnJheS5wcm90b3R5cGUucHVzaC5hcHBseSh2YWxzLCBlbnRyeSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gbWFrZUl0ZXJhdG9yKHZhbHMpO1xuICB9O1xuXG4gIC8qKlxuICAgKlxuICAgKi9cbiAgTXVsdGltYXAucHJvdG90eXBlLmZvckVhY2hFbnRyeSA9IGZ1bmN0aW9uKGl0ZXIpIHtcbiAgICBtYXBFYWNoKHRoaXMsIGl0ZXIpO1xuICB9O1xuXG4gIE11bHRpbWFwLnByb3RvdHlwZS5mb3JFYWNoID0gZnVuY3Rpb24oaXRlcikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLmZvckVhY2hFbnRyeShmdW5jdGlvbihlbnRyeSwga2V5KSB7XG4gICAgICBlbnRyeS5mb3JFYWNoKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICAgICAgaXRlcihpdGVtLCBrZXksIHNlbGYpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH07XG5cblxuICBNdWx0aW1hcC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5fbWFwKSB7XG4gICAgICB0aGlzLl8uY2xlYXIoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fID0ge307XG4gICAgfVxuICB9O1xuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShcbiAgICBNdWx0aW1hcC5wcm90b3R5cGUsXG4gICAgXCJzaXplXCIsIHtcbiAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2UsXG4gICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHRvdGFsID0gMDtcblxuICAgICAgICBtYXBFYWNoKHRoaXMsIGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgICB0b3RhbCArPSB2YWx1ZS5sZW5ndGg7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB0b3RhbDtcbiAgICAgIH1cbiAgICB9KTtcblxuICB2YXIgc2FmYXJpTmV4dDtcblxuICB0cnl7XG4gICAgc2FmYXJpTmV4dCA9IG5ldyBGdW5jdGlvbignaXRlcmF0b3InLCAnbWFrZUl0ZXJhdG9yJywgJ3ZhciBrZXlzQXJyYXkgPSBbXTsgZm9yKHZhciBrZXkgb2YgaXRlcmF0b3Ipe2tleXNBcnJheS5wdXNoKGtleSk7fSByZXR1cm4gbWFrZUl0ZXJhdG9yKGtleXNBcnJheSkubmV4dDsnKTtcbiAgfWNhdGNoKGVycm9yKXtcbiAgICAvLyBmb3Igb2Ygbm90IGltcGxlbWVudGVkO1xuICB9XG5cbiAgZnVuY3Rpb24gbWFrZUl0ZXJhdG9yKGl0ZXJhdG9yKXtcbiAgICBpZihBcnJheS5pc0FycmF5KGl0ZXJhdG9yKSl7XG4gICAgICB2YXIgbmV4dEluZGV4ID0gMDtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbmV4dDogZnVuY3Rpb24oKXtcbiAgICAgICAgICByZXR1cm4gbmV4dEluZGV4IDwgaXRlcmF0b3IubGVuZ3RoID9cbiAgICAgICAgICAgIHt2YWx1ZTogaXRlcmF0b3JbbmV4dEluZGV4KytdLCBkb25lOiBmYWxzZX0gOlxuICAgICAgICAgIHtkb25lOiB0cnVlfTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBPbmx5IGFuIGlzc3VlIGluIHNhZmFyaVxuICAgIGlmKCFpdGVyYXRvci5uZXh0ICYmIHNhZmFyaU5leHQpe1xuICAgICAgaXRlcmF0b3IubmV4dCA9IHNhZmFyaU5leHQoaXRlcmF0b3IsIG1ha2VJdGVyYXRvcik7XG4gICAgfVxuXG4gICAgcmV0dXJuIGl0ZXJhdG9yO1xuICB9XG5cbiAgcmV0dXJuIE11bHRpbWFwO1xufSkoKTtcblxuXG5pZih0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcgJiYgbW9kdWxlICYmIG1vZHVsZS5leHBvcnRzKVxuICBtb2R1bGUuZXhwb3J0cyA9IE11bHRpbWFwO1xuZWxzZSBpZih0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpXG4gIGRlZmluZShmdW5jdGlvbigpIHsgcmV0dXJuIE11bHRpbWFwOyB9KTtcbiIsIid1c2Ugc3RyaWN0JztcbnZhciBwcm9wSXNFbnVtZXJhYmxlID0gT2JqZWN0LnByb3RvdHlwZS5wcm9wZXJ0eUlzRW51bWVyYWJsZTtcblxuZnVuY3Rpb24gVG9PYmplY3QodmFsKSB7XG5cdGlmICh2YWwgPT0gbnVsbCkge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IoJ09iamVjdC5hc3NpZ24gY2Fubm90IGJlIGNhbGxlZCB3aXRoIG51bGwgb3IgdW5kZWZpbmVkJyk7XG5cdH1cblxuXHRyZXR1cm4gT2JqZWN0KHZhbCk7XG59XG5cbmZ1bmN0aW9uIG93bkVudW1lcmFibGVLZXlzKG9iaikge1xuXHR2YXIga2V5cyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKG9iaik7XG5cblx0aWYgKE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMpIHtcblx0XHRrZXlzID0ga2V5cy5jb25jYXQoT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scyhvYmopKTtcblx0fVxuXG5cdHJldHVybiBrZXlzLmZpbHRlcihmdW5jdGlvbiAoa2V5KSB7XG5cdFx0cmV0dXJuIHByb3BJc0VudW1lcmFibGUuY2FsbChvYmosIGtleSk7XG5cdH0pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IE9iamVjdC5hc3NpZ24gfHwgZnVuY3Rpb24gKHRhcmdldCwgc291cmNlKSB7XG5cdHZhciBmcm9tO1xuXHR2YXIga2V5cztcblx0dmFyIHRvID0gVG9PYmplY3QodGFyZ2V0KTtcblxuXHRmb3IgKHZhciBzID0gMTsgcyA8IGFyZ3VtZW50cy5sZW5ndGg7IHMrKykge1xuXHRcdGZyb20gPSBhcmd1bWVudHNbc107XG5cdFx0a2V5cyA9IG93bkVudW1lcmFibGVLZXlzKE9iamVjdChmcm9tKSk7XG5cblx0XHRmb3IgKHZhciBpID0gMDsgaSA8IGtleXMubGVuZ3RoOyBpKyspIHtcblx0XHRcdHRvW2tleXNbaV1dID0gZnJvbVtrZXlzW2ldXTtcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gdG87XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpc1NhbWUoYSwgYil7XG4gICAgaWYoYSA9PT0gYil7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGlmKFxuICAgICAgICB0eXBlb2YgYSAhPT0gdHlwZW9mIGIgfHxcbiAgICAgICAgdHlwZW9mIGEgPT09ICdvYmplY3QnICYmXG4gICAgICAgICEoYSBpbnN0YW5jZW9mIERhdGUgJiYgYiBpbnN0YW5jZW9mIERhdGUpXG4gICAgKXtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHJldHVybiBTdHJpbmcoYSkgPT09IFN0cmluZyhiKTtcbn07IiwidmFyIG5hdHVyYWxTZWxlY3Rpb24gPSByZXF1aXJlKCduYXR1cmFsLXNlbGVjdGlvbicpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGVsZW1lbnQsIHZhbHVlKXtcbiAgICB2YXIgY2FuU2V0ID0gbmF0dXJhbFNlbGVjdGlvbihlbGVtZW50KSAmJiBlbGVtZW50ID09PSBkb2N1bWVudC5hY3RpdmVFbGVtZW50O1xuXG4gICAgaWYgKGNhblNldCkge1xuICAgICAgICB2YXIgc3RhcnQgPSBlbGVtZW50LnNlbGVjdGlvblN0YXJ0LFxuICAgICAgICAgICAgZW5kID0gZWxlbWVudC5zZWxlY3Rpb25FbmQ7XG5cbiAgICAgICAgZWxlbWVudC52YWx1ZSA9IHZhbHVlO1xuICAgICAgICBlbGVtZW50LnNldFNlbGVjdGlvblJhbmdlKHN0YXJ0LCBlbmQpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGVsZW1lbnQudmFsdWUgPSB2YWx1ZTtcbiAgICB9XG59O1xuIiwidmFyIHN1cHBvcnRlZFR5cGVzID0gWyd0ZXh0JywgJ3NlYXJjaCcsICd0ZWwnLCAndXJsJywgJ3Bhc3N3b3JkJ107XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZWxlbWVudCl7XG4gICAgcmV0dXJuICEhKGVsZW1lbnQuc2V0U2VsZWN0aW9uUmFuZ2UgJiYgfnN1cHBvcnRlZFR5cGVzLmluZGV4T2YoZWxlbWVudC50eXBlKSk7XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSBPYmplY3Quc2V0UHJvdG90eXBlT2YgfHwge19fcHJvdG9fXzpbXX0gaW5zdGFuY2VvZiBBcnJheSA/IHNldFByb3RvT2YgOiBtaXhpblByb3BlcnRpZXM7XG5cbmZ1bmN0aW9uIHNldFByb3RvT2Yob2JqLCBwcm90bykge1xuXHRvYmouX19wcm90b19fID0gcHJvdG87XG59XG5cbmZ1bmN0aW9uIG1peGluUHJvcGVydGllcyhvYmosIHByb3RvKSB7XG5cdGZvciAodmFyIHByb3AgaW4gcHJvdG8pIHtcblx0XHRvYmpbcHJvcF0gPSBwcm90b1twcm9wXTtcblx0fVxufVxuIiwidmFyIGNsb25lID0gcmVxdWlyZSgnY2xvbmUnKSxcbiAgICBkZWVwRXF1YWwgPSByZXF1aXJlKCdkZWVwLWVxdWFsJyk7XG5cbmZ1bmN0aW9uIGtleXNBcmVEaWZmZXJlbnQoa2V5czEsIGtleXMyKXtcbiAgICBpZihrZXlzMSA9PT0ga2V5czIpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmKCFrZXlzMSB8fCAha2V5czIgfHwga2V5czEubGVuZ3RoICE9PSBrZXlzMi5sZW5ndGgpe1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGtleXMxLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgaWYoIX5rZXlzMi5pbmRleE9mKGtleXMxW2ldKSl7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0S2V5cyh2YWx1ZSl7XG4gICAgaWYoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKHZhbHVlKTtcbn1cblxuZnVuY3Rpb24gV2hhdENoYW5nZWQodmFsdWUsIGNoYW5nZXNUb1RyYWNrKXtcbiAgICB0aGlzLl9jaGFuZ2VzVG9UcmFjayA9IHt9O1xuXG4gICAgaWYoY2hhbmdlc1RvVHJhY2sgPT0gbnVsbCl7XG4gICAgICAgIGNoYW5nZXNUb1RyYWNrID0gJ3ZhbHVlIHR5cGUga2V5cyBzdHJ1Y3R1cmUgcmVmZXJlbmNlJztcbiAgICB9XG5cbiAgICBpZih0eXBlb2YgY2hhbmdlc1RvVHJhY2sgIT09ICdzdHJpbmcnKXtcbiAgICAgICAgdGhyb3cgJ2NoYW5nZXNUb1RyYWNrIG11c3QgYmUgb2YgdHlwZSBzdHJpbmcnO1xuICAgIH1cblxuICAgIGNoYW5nZXNUb1RyYWNrID0gY2hhbmdlc1RvVHJhY2suc3BsaXQoJyAnKTtcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhbmdlc1RvVHJhY2subGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdGhpcy5fY2hhbmdlc1RvVHJhY2tbY2hhbmdlc1RvVHJhY2tbaV1dID0gdHJ1ZTtcbiAgICB9O1xuXG4gICAgdGhpcy51cGRhdGUodmFsdWUpO1xufVxuV2hhdENoYW5nZWQucHJvdG90eXBlLnVwZGF0ZSA9IGZ1bmN0aW9uKHZhbHVlKXtcbiAgICB2YXIgcmVzdWx0ID0ge30sXG4gICAgICAgIGNoYW5nZXNUb1RyYWNrID0gdGhpcy5fY2hhbmdlc1RvVHJhY2ssXG4gICAgICAgIG5ld0tleXMgPSBnZXRLZXlzKHZhbHVlKTtcblxuICAgIGlmKCd2YWx1ZScgaW4gY2hhbmdlc1RvVHJhY2sgJiYgdmFsdWUrJycgIT09IHRoaXMuX2xhc3RSZWZlcmVuY2UrJycpe1xuICAgICAgICByZXN1bHQudmFsdWUgPSB0cnVlO1xuICAgIH1cbiAgICBpZihcbiAgICAgICAgJ3R5cGUnIGluIGNoYW5nZXNUb1RyYWNrICYmIHR5cGVvZiB2YWx1ZSAhPT0gdHlwZW9mIHRoaXMuX2xhc3RWYWx1ZSB8fFxuICAgICAgICAodmFsdWUgPT09IG51bGwgfHwgdGhpcy5fbGFzdFZhbHVlID09PSBudWxsKSAmJiB0aGlzLnZhbHVlICE9PSB0aGlzLl9sYXN0VmFsdWUgLy8gdHlwZW9mIG51bGwgPT09ICdvYmplY3QnXG4gICAgKXtcbiAgICAgICAgcmVzdWx0LnR5cGUgPSB0cnVlO1xuICAgIH1cbiAgICBpZigna2V5cycgaW4gY2hhbmdlc1RvVHJhY2sgJiYga2V5c0FyZURpZmZlcmVudCh0aGlzLl9sYXN0S2V5cywgZ2V0S2V5cyh2YWx1ZSkpKXtcbiAgICAgICAgcmVzdWx0LmtleXMgPSB0cnVlO1xuICAgIH1cblxuICAgIGlmKHZhbHVlICE9PSBudWxsICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpe1xuICAgICAgICB2YXIgbGFzdFZhbHVlID0gdGhpcy5fbGFzdFZhbHVlO1xuXG4gICAgICAgIGlmKCdzaGFsbG93U3RydWN0dXJlJyBpbiBjaGFuZ2VzVG9UcmFjayAmJiAoIWxhc3RWYWx1ZSB8fCB0eXBlb2YgbGFzdFZhbHVlICE9PSAnb2JqZWN0JyB8fCBPYmplY3Qua2V5cyh2YWx1ZSkuc29tZShmdW5jdGlvbihrZXksIGluZGV4KXtcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZVtrZXldICE9PSBsYXN0VmFsdWVba2V5XTtcbiAgICAgICAgfSkpKXtcbiAgICAgICAgICAgIHJlc3VsdC5zaGFsbG93U3RydWN0dXJlID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZignc3RydWN0dXJlJyBpbiBjaGFuZ2VzVG9UcmFjayAmJiAhZGVlcEVxdWFsKHZhbHVlLCBsYXN0VmFsdWUpKXtcbiAgICAgICAgICAgIHJlc3VsdC5zdHJ1Y3R1cmUgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmKCdyZWZlcmVuY2UnIGluIGNoYW5nZXNUb1RyYWNrICYmIHZhbHVlICE9PSB0aGlzLl9sYXN0UmVmZXJlbmNlKXtcbiAgICAgICAgICAgIHJlc3VsdC5yZWZlcmVuY2UgPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fbGFzdFZhbHVlID0gJ3N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgPyBjbG9uZSh2YWx1ZSkgOiAnc2hhbGxvd1N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgPyBjbG9uZSh2YWx1ZSwgdHJ1ZSwgMSk6IHZhbHVlO1xuICAgIHRoaXMuX2xhc3RSZWZlcmVuY2UgPSB2YWx1ZTtcbiAgICB0aGlzLl9sYXN0S2V5cyA9IG5ld0tleXM7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBXaGF0Q2hhbmdlZDsiLCJ2YXIgY2xvbmUgPSAoZnVuY3Rpb24oKSB7XG4ndXNlIHN0cmljdCc7XG5cbi8qKlxuICogQ2xvbmVzIChjb3BpZXMpIGFuIE9iamVjdCB1c2luZyBkZWVwIGNvcHlpbmcuXG4gKlxuICogVGhpcyBmdW5jdGlvbiBzdXBwb3J0cyBjaXJjdWxhciByZWZlcmVuY2VzIGJ5IGRlZmF1bHQsIGJ1dCBpZiB5b3UgYXJlIGNlcnRhaW5cbiAqIHRoZXJlIGFyZSBubyBjaXJjdWxhciByZWZlcmVuY2VzIGluIHlvdXIgb2JqZWN0LCB5b3UgY2FuIHNhdmUgc29tZSBDUFUgdGltZVxuICogYnkgY2FsbGluZyBjbG9uZShvYmosIGZhbHNlKS5cbiAqXG4gKiBDYXV0aW9uOiBpZiBgY2lyY3VsYXJgIGlzIGZhbHNlIGFuZCBgcGFyZW50YCBjb250YWlucyBjaXJjdWxhciByZWZlcmVuY2VzLFxuICogeW91ciBwcm9ncmFtIG1heSBlbnRlciBhbiBpbmZpbml0ZSBsb29wIGFuZCBjcmFzaC5cbiAqXG4gKiBAcGFyYW0gYHBhcmVudGAgLSB0aGUgb2JqZWN0IHRvIGJlIGNsb25lZFxuICogQHBhcmFtIGBjaXJjdWxhcmAgLSBzZXQgdG8gdHJ1ZSBpZiB0aGUgb2JqZWN0IHRvIGJlIGNsb25lZCBtYXkgY29udGFpblxuICogICAgY2lyY3VsYXIgcmVmZXJlbmNlcy4gKG9wdGlvbmFsIC0gdHJ1ZSBieSBkZWZhdWx0KVxuICogQHBhcmFtIGBkZXB0aGAgLSBzZXQgdG8gYSBudW1iZXIgaWYgdGhlIG9iamVjdCBpcyBvbmx5IHRvIGJlIGNsb25lZCB0b1xuICogICAgYSBwYXJ0aWN1bGFyIGRlcHRoLiAob3B0aW9uYWwgLSBkZWZhdWx0cyB0byBJbmZpbml0eSlcbiAqIEBwYXJhbSBgcHJvdG90eXBlYCAtIHNldHMgdGhlIHByb3RvdHlwZSB0byBiZSB1c2VkIHdoZW4gY2xvbmluZyBhbiBvYmplY3QuXG4gKiAgICAob3B0aW9uYWwgLSBkZWZhdWx0cyB0byBwYXJlbnQgcHJvdG90eXBlKS5cbiovXG5mdW5jdGlvbiBjbG9uZShwYXJlbnQsIGNpcmN1bGFyLCBkZXB0aCwgcHJvdG90eXBlKSB7XG4gIHZhciBmaWx0ZXI7XG4gIGlmICh0eXBlb2YgY2lyY3VsYXIgPT09ICdvYmplY3QnKSB7XG4gICAgZGVwdGggPSBjaXJjdWxhci5kZXB0aDtcbiAgICBwcm90b3R5cGUgPSBjaXJjdWxhci5wcm90b3R5cGU7XG4gICAgZmlsdGVyID0gY2lyY3VsYXIuZmlsdGVyO1xuICAgIGNpcmN1bGFyID0gY2lyY3VsYXIuY2lyY3VsYXJcbiAgfVxuICAvLyBtYWludGFpbiB0d28gYXJyYXlzIGZvciBjaXJjdWxhciByZWZlcmVuY2VzLCB3aGVyZSBjb3JyZXNwb25kaW5nIHBhcmVudHNcbiAgLy8gYW5kIGNoaWxkcmVuIGhhdmUgdGhlIHNhbWUgaW5kZXhcbiAgdmFyIGFsbFBhcmVudHMgPSBbXTtcbiAgdmFyIGFsbENoaWxkcmVuID0gW107XG5cbiAgdmFyIHVzZUJ1ZmZlciA9IHR5cGVvZiBCdWZmZXIgIT0gJ3VuZGVmaW5lZCc7XG5cbiAgaWYgKHR5cGVvZiBjaXJjdWxhciA9PSAndW5kZWZpbmVkJylcbiAgICBjaXJjdWxhciA9IHRydWU7XG5cbiAgaWYgKHR5cGVvZiBkZXB0aCA9PSAndW5kZWZpbmVkJylcbiAgICBkZXB0aCA9IEluZmluaXR5O1xuXG4gIC8vIHJlY3Vyc2UgdGhpcyBmdW5jdGlvbiBzbyB3ZSBkb24ndCByZXNldCBhbGxQYXJlbnRzIGFuZCBhbGxDaGlsZHJlblxuICBmdW5jdGlvbiBfY2xvbmUocGFyZW50LCBkZXB0aCkge1xuICAgIC8vIGNsb25pbmcgbnVsbCBhbHdheXMgcmV0dXJucyBudWxsXG4gICAgaWYgKHBhcmVudCA9PT0gbnVsbClcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgaWYgKGRlcHRoID09IDApXG4gICAgICByZXR1cm4gcGFyZW50O1xuXG4gICAgdmFyIGNoaWxkO1xuICAgIHZhciBwcm90bztcbiAgICBpZiAodHlwZW9mIHBhcmVudCAhPSAnb2JqZWN0Jykge1xuICAgICAgcmV0dXJuIHBhcmVudDtcbiAgICB9XG5cbiAgICBpZiAoY2xvbmUuX19pc0FycmF5KHBhcmVudCkpIHtcbiAgICAgIGNoaWxkID0gW107XG4gICAgfSBlbHNlIGlmIChjbG9uZS5fX2lzUmVnRXhwKHBhcmVudCkpIHtcbiAgICAgIGNoaWxkID0gbmV3IFJlZ0V4cChwYXJlbnQuc291cmNlLCBfX2dldFJlZ0V4cEZsYWdzKHBhcmVudCkpO1xuICAgICAgaWYgKHBhcmVudC5sYXN0SW5kZXgpIGNoaWxkLmxhc3RJbmRleCA9IHBhcmVudC5sYXN0SW5kZXg7XG4gICAgfSBlbHNlIGlmIChjbG9uZS5fX2lzRGF0ZShwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBEYXRlKHBhcmVudC5nZXRUaW1lKCkpO1xuICAgIH0gZWxzZSBpZiAodXNlQnVmZmVyICYmIEJ1ZmZlci5pc0J1ZmZlcihwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBCdWZmZXIocGFyZW50Lmxlbmd0aCk7XG4gICAgICBwYXJlbnQuY29weShjaGlsZCk7XG4gICAgICByZXR1cm4gY2hpbGQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0eXBlb2YgcHJvdG90eXBlID09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIHByb3RvID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHBhcmVudCk7XG4gICAgICAgIGNoaWxkID0gT2JqZWN0LmNyZWF0ZShwcm90byk7XG4gICAgICB9XG4gICAgICBlbHNlIHtcbiAgICAgICAgY2hpbGQgPSBPYmplY3QuY3JlYXRlKHByb3RvdHlwZSk7XG4gICAgICAgIHByb3RvID0gcHJvdG90eXBlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjaXJjdWxhcikge1xuICAgICAgdmFyIGluZGV4ID0gYWxsUGFyZW50cy5pbmRleE9mKHBhcmVudCk7XG5cbiAgICAgIGlmIChpbmRleCAhPSAtMSkge1xuICAgICAgICByZXR1cm4gYWxsQ2hpbGRyZW5baW5kZXhdO1xuICAgICAgfVxuICAgICAgYWxsUGFyZW50cy5wdXNoKHBhcmVudCk7XG4gICAgICBhbGxDaGlsZHJlbi5wdXNoKGNoaWxkKTtcbiAgICB9XG5cbiAgICBmb3IgKHZhciBpIGluIHBhcmVudCkge1xuICAgICAgdmFyIGF0dHJzO1xuICAgICAgaWYgKHByb3RvKSB7XG4gICAgICAgIGF0dHJzID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwcm90bywgaSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRycyAmJiBhdHRycy5zZXQgPT0gbnVsbCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNoaWxkW2ldID0gX2Nsb25lKHBhcmVudFtpXSwgZGVwdGggLSAxKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY2hpbGQ7XG4gIH1cblxuICByZXR1cm4gX2Nsb25lKHBhcmVudCwgZGVwdGgpO1xufVxuXG4vKipcbiAqIFNpbXBsZSBmbGF0IGNsb25lIHVzaW5nIHByb3RvdHlwZSwgYWNjZXB0cyBvbmx5IG9iamVjdHMsIHVzZWZ1bGwgZm9yIHByb3BlcnR5XG4gKiBvdmVycmlkZSBvbiBGTEFUIGNvbmZpZ3VyYXRpb24gb2JqZWN0IChubyBuZXN0ZWQgcHJvcHMpLlxuICpcbiAqIFVTRSBXSVRIIENBVVRJT04hIFRoaXMgbWF5IG5vdCBiZWhhdmUgYXMgeW91IHdpc2ggaWYgeW91IGRvIG5vdCBrbm93IGhvdyB0aGlzXG4gKiB3b3Jrcy5cbiAqL1xuY2xvbmUuY2xvbmVQcm90b3R5cGUgPSBmdW5jdGlvbiBjbG9uZVByb3RvdHlwZShwYXJlbnQpIHtcbiAgaWYgKHBhcmVudCA9PT0gbnVsbClcbiAgICByZXR1cm4gbnVsbDtcblxuICB2YXIgYyA9IGZ1bmN0aW9uICgpIHt9O1xuICBjLnByb3RvdHlwZSA9IHBhcmVudDtcbiAgcmV0dXJuIG5ldyBjKCk7XG59O1xuXG4vLyBwcml2YXRlIHV0aWxpdHkgZnVuY3Rpb25zXG5cbmZ1bmN0aW9uIF9fb2JqVG9TdHIobykge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG8pO1xufTtcbmNsb25lLl9fb2JqVG9TdHIgPSBfX29ialRvU3RyO1xuXG5mdW5jdGlvbiBfX2lzRGF0ZShvKSB7XG4gIHJldHVybiB0eXBlb2YgbyA9PT0gJ29iamVjdCcgJiYgX19vYmpUb1N0cihvKSA9PT0gJ1tvYmplY3QgRGF0ZV0nO1xufTtcbmNsb25lLl9faXNEYXRlID0gX19pc0RhdGU7XG5cbmZ1bmN0aW9uIF9faXNBcnJheShvKSB7XG4gIHJldHVybiB0eXBlb2YgbyA9PT0gJ29iamVjdCcgJiYgX19vYmpUb1N0cihvKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn07XG5jbG9uZS5fX2lzQXJyYXkgPSBfX2lzQXJyYXk7XG5cbmZ1bmN0aW9uIF9faXNSZWdFeHAobykge1xuICByZXR1cm4gdHlwZW9mIG8gPT09ICdvYmplY3QnICYmIF9fb2JqVG9TdHIobykgPT09ICdbb2JqZWN0IFJlZ0V4cF0nO1xufTtcbmNsb25lLl9faXNSZWdFeHAgPSBfX2lzUmVnRXhwO1xuXG5mdW5jdGlvbiBfX2dldFJlZ0V4cEZsYWdzKHJlKSB7XG4gIHZhciBmbGFncyA9ICcnO1xuICBpZiAocmUuZ2xvYmFsKSBmbGFncyArPSAnZyc7XG4gIGlmIChyZS5pZ25vcmVDYXNlKSBmbGFncyArPSAnaSc7XG4gIGlmIChyZS5tdWx0aWxpbmUpIGZsYWdzICs9ICdtJztcbiAgcmV0dXJuIGZsYWdzO1xufTtcbmNsb25lLl9fZ2V0UmVnRXhwRmxhZ3MgPSBfX2dldFJlZ0V4cEZsYWdzO1xuXG5yZXR1cm4gY2xvbmU7XG59KSgpO1xuXG5pZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBjbG9uZTtcbn1cbiIsInZhciBwU2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG52YXIgb2JqZWN0S2V5cyA9IHJlcXVpcmUoJy4vbGliL2tleXMuanMnKTtcbnZhciBpc0FyZ3VtZW50cyA9IHJlcXVpcmUoJy4vbGliL2lzX2FyZ3VtZW50cy5qcycpO1xuXG52YXIgZGVlcEVxdWFsID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoYWN0dWFsLCBleHBlY3RlZCwgb3B0cykge1xuICBpZiAoIW9wdHMpIG9wdHMgPSB7fTtcbiAgLy8gNy4xLiBBbGwgaWRlbnRpY2FsIHZhbHVlcyBhcmUgZXF1aXZhbGVudCwgYXMgZGV0ZXJtaW5lZCBieSA9PT0uXG4gIGlmIChhY3R1YWwgPT09IGV4cGVjdGVkKSB7XG4gICAgcmV0dXJuIHRydWU7XG5cbiAgfSBlbHNlIGlmIChhY3R1YWwgaW5zdGFuY2VvZiBEYXRlICYmIGV4cGVjdGVkIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgIHJldHVybiBhY3R1YWwuZ2V0VGltZSgpID09PSBleHBlY3RlZC5nZXRUaW1lKCk7XG5cbiAgLy8gNy4zLiBPdGhlciBwYWlycyB0aGF0IGRvIG5vdCBib3RoIHBhc3MgdHlwZW9mIHZhbHVlID09ICdvYmplY3QnLFxuICAvLyBlcXVpdmFsZW5jZSBpcyBkZXRlcm1pbmVkIGJ5ID09LlxuICB9IGVsc2UgaWYgKHR5cGVvZiBhY3R1YWwgIT0gJ29iamVjdCcgJiYgdHlwZW9mIGV4cGVjdGVkICE9ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIG9wdHMuc3RyaWN0ID8gYWN0dWFsID09PSBleHBlY3RlZCA6IGFjdHVhbCA9PSBleHBlY3RlZDtcblxuICAvLyA3LjQuIEZvciBhbGwgb3RoZXIgT2JqZWN0IHBhaXJzLCBpbmNsdWRpbmcgQXJyYXkgb2JqZWN0cywgZXF1aXZhbGVuY2UgaXNcbiAgLy8gZGV0ZXJtaW5lZCBieSBoYXZpbmcgdGhlIHNhbWUgbnVtYmVyIG9mIG93bmVkIHByb3BlcnRpZXMgKGFzIHZlcmlmaWVkXG4gIC8vIHdpdGggT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKSwgdGhlIHNhbWUgc2V0IG9mIGtleXNcbiAgLy8gKGFsdGhvdWdoIG5vdCBuZWNlc3NhcmlseSB0aGUgc2FtZSBvcmRlciksIGVxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeVxuICAvLyBjb3JyZXNwb25kaW5nIGtleSwgYW5kIGFuIGlkZW50aWNhbCAncHJvdG90eXBlJyBwcm9wZXJ0eS4gTm90ZTogdGhpc1xuICAvLyBhY2NvdW50cyBmb3IgYm90aCBuYW1lZCBhbmQgaW5kZXhlZCBwcm9wZXJ0aWVzIG9uIEFycmF5cy5cbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gb2JqRXF1aXYoYWN0dWFsLCBleHBlY3RlZCwgb3B0cyk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaXNVbmRlZmluZWRPck51bGwodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGlzQnVmZmVyICh4KSB7XG4gIGlmICgheCB8fCB0eXBlb2YgeCAhPT0gJ29iamVjdCcgfHwgdHlwZW9mIHgubGVuZ3RoICE9PSAnbnVtYmVyJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIHguY29weSAhPT0gJ2Z1bmN0aW9uJyB8fCB0eXBlb2YgeC5zbGljZSAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoeC5sZW5ndGggPiAwICYmIHR5cGVvZiB4WzBdICE9PSAnbnVtYmVyJykgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gb2JqRXF1aXYoYSwgYiwgb3B0cykge1xuICB2YXIgaSwga2V5O1xuICBpZiAoaXNVbmRlZmluZWRPck51bGwoYSkgfHwgaXNVbmRlZmluZWRPck51bGwoYikpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvLyBhbiBpZGVudGljYWwgJ3Byb3RvdHlwZScgcHJvcGVydHkuXG4gIGlmIChhLnByb3RvdHlwZSAhPT0gYi5wcm90b3R5cGUpIHJldHVybiBmYWxzZTtcbiAgLy9+fn5JJ3ZlIG1hbmFnZWQgdG8gYnJlYWsgT2JqZWN0LmtleXMgdGhyb3VnaCBzY3Jld3kgYXJndW1lbnRzIHBhc3NpbmcuXG4gIC8vICAgQ29udmVydGluZyB0byBhcnJheSBzb2x2ZXMgdGhlIHByb2JsZW0uXG4gIGlmIChpc0FyZ3VtZW50cyhhKSkge1xuICAgIGlmICghaXNBcmd1bWVudHMoYikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgYSA9IHBTbGljZS5jYWxsKGEpO1xuICAgIGIgPSBwU2xpY2UuY2FsbChiKTtcbiAgICByZXR1cm4gZGVlcEVxdWFsKGEsIGIsIG9wdHMpO1xuICB9XG4gIGlmIChpc0J1ZmZlcihhKSkge1xuICAgIGlmICghaXNCdWZmZXIoYikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKGEubGVuZ3RoICE9PSBiLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICAgIGZvciAoaSA9IDA7IGkgPCBhLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYVtpXSAhPT0gYltpXSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICB0cnkge1xuICAgIHZhciBrYSA9IG9iamVjdEtleXMoYSksXG4gICAgICAgIGtiID0gb2JqZWN0S2V5cyhiKTtcbiAgfSBjYXRjaCAoZSkgey8vaGFwcGVucyB3aGVuIG9uZSBpcyBhIHN0cmluZyBsaXRlcmFsIGFuZCB0aGUgb3RoZXIgaXNuJ3RcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgLy8gaGF2aW5nIHRoZSBzYW1lIG51bWJlciBvZiBvd25lZCBwcm9wZXJ0aWVzIChrZXlzIGluY29ycG9yYXRlc1xuICAvLyBoYXNPd25Qcm9wZXJ0eSlcbiAgaWYgKGthLmxlbmd0aCAhPSBrYi5sZW5ndGgpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvL3RoZSBzYW1lIHNldCBvZiBrZXlzIChhbHRob3VnaCBub3QgbmVjZXNzYXJpbHkgdGhlIHNhbWUgb3JkZXIpLFxuICBrYS5zb3J0KCk7XG4gIGtiLnNvcnQoKTtcbiAgLy9+fn5jaGVhcCBrZXkgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGlmIChrYVtpXSAhPSBrYltpXSlcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICAvL2VxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeSBjb3JyZXNwb25kaW5nIGtleSwgYW5kXG4gIC8vfn5+cG9zc2libHkgZXhwZW5zaXZlIGRlZXAgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGtleSA9IGthW2ldO1xuICAgIGlmICghZGVlcEVxdWFsKGFba2V5XSwgYltrZXldLCBvcHRzKSkgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0eXBlb2YgYSA9PT0gdHlwZW9mIGI7XG59XG4iLCJ2YXIgc3VwcG9ydHNBcmd1bWVudHNDbGFzcyA9IChmdW5jdGlvbigpe1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKGFyZ3VtZW50cylcbn0pKCkgPT0gJ1tvYmplY3QgQXJndW1lbnRzXSc7XG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHN1cHBvcnRzQXJndW1lbnRzQ2xhc3MgPyBzdXBwb3J0ZWQgOiB1bnN1cHBvcnRlZDtcblxuZXhwb3J0cy5zdXBwb3J0ZWQgPSBzdXBwb3J0ZWQ7XG5mdW5jdGlvbiBzdXBwb3J0ZWQob2JqZWN0KSB7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwob2JqZWN0KSA9PSAnW29iamVjdCBBcmd1bWVudHNdJztcbn07XG5cbmV4cG9ydHMudW5zdXBwb3J0ZWQgPSB1bnN1cHBvcnRlZDtcbmZ1bmN0aW9uIHVuc3VwcG9ydGVkKG9iamVjdCl7XG4gIHJldHVybiBvYmplY3QgJiZcbiAgICB0eXBlb2Ygb2JqZWN0ID09ICdvYmplY3QnICYmXG4gICAgdHlwZW9mIG9iamVjdC5sZW5ndGggPT0gJ251bWJlcicgJiZcbiAgICBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqZWN0LCAnY2FsbGVlJykgJiZcbiAgICAhT2JqZWN0LnByb3RvdHlwZS5wcm9wZXJ0eUlzRW51bWVyYWJsZS5jYWxsKG9iamVjdCwgJ2NhbGxlZScpIHx8XG4gICAgZmFsc2U7XG59O1xuIiwiZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gdHlwZW9mIE9iamVjdC5rZXlzID09PSAnZnVuY3Rpb24nXG4gID8gT2JqZWN0LmtleXMgOiBzaGltO1xuXG5leHBvcnRzLnNoaW0gPSBzaGltO1xuZnVuY3Rpb24gc2hpbSAob2JqKSB7XG4gIHZhciBrZXlzID0gW107XG4gIGZvciAodmFyIGtleSBpbiBvYmopIGtleXMucHVzaChrZXkpO1xuICByZXR1cm4ga2V5cztcbn1cbiIsInZhciBFbnRpID0gcmVxdWlyZSgnZW50aScpLFxuICAgIFdoYXRDaGFuZ2VkID0gcmVxdWlyZSgnd2hhdC1jaGFuZ2VkJyksXG4gICAgc2FtZSA9IHJlcXVpcmUoJ3NhbWUtdmFsdWUnKSxcbiAgICBmaXJtZXIgPSByZXF1aXJlKCcuL2Zpcm1lcicpLFxuICAgIGNyZWF0ZUJpbmRpbmcgPSByZXF1aXJlKCcuL2JpbmRpbmcnKSxcbiAgICBmdW5jdGlvbkVtaXR0ZXIgPSByZXF1aXJlKCcuL2Z1bmN0aW9uRW1pdHRlcicpLFxuICAgIHNldFByb3RvdHlwZU9mID0gcmVxdWlyZSgnc2V0cHJvdG90eXBlb2YnKSxcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKTtcblxudmFyIHByb3BlcnR5UHJvdG8gPSBPYmplY3QuY3JlYXRlKGZ1bmN0aW9uRW1pdHRlcik7XG5cbnByb3BlcnR5UHJvdG8uX2Zhc3RuX3Byb3BlcnR5ID0gdHJ1ZTtcbnByb3BlcnR5UHJvdG8uX2Zpcm0gPSAxO1xuXG5mdW5jdGlvbiBwcm9wZXJ0eVRlbXBsYXRlKHZhbHVlKXtcbiAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgIHJldHVybiB0aGlzLmJpbmRpbmcgJiYgdGhpcy5iaW5kaW5nKCkgfHwgdGhpcy5wcm9wZXJ0eS5fdmFsdWU7XG4gICAgfVxuXG4gICAgaWYoIXRoaXMuZGVzdHJveWVkKXtcbiAgICAgICAgaWYodGhpcy5iaW5kaW5nKXtcbiAgICAgICAgICAgIHRoaXMuYmluZGluZyh2YWx1ZSk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMudmFsdWVVcGRhdGUodmFsdWUpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnByb3BlcnR5O1xufVxuXG5mdW5jdGlvbiBjaGFuZ2VDaGVja2VyKGN1cnJlbnQsIGNoYW5nZXMpe1xuICAgIGlmKGNoYW5nZXMpe1xuICAgICAgICB2YXIgY2hhbmdlcyA9IG5ldyBXaGF0Q2hhbmdlZChjdXJyZW50LCBjaGFuZ2VzKTtcblxuICAgICAgICByZXR1cm4gZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICAgICAgcmV0dXJuIE9iamVjdC5rZXlzKGNoYW5nZXMudXBkYXRlKHZhbHVlKSkubGVuZ3RoID4gMDtcbiAgICAgICAgfTtcbiAgICB9ZWxzZXtcbiAgICAgICAgdmFyIGxhc3RWYWx1ZSA9IGN1cnJlbnQ7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbihuZXdWYWx1ZSl7XG4gICAgICAgICAgICBpZighc2FtZShsYXN0VmFsdWUsIG5ld1ZhbHVlKSl7XG4gICAgICAgICAgICAgICAgbGFzdFZhbHVlID0gbmV3VmFsdWU7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxufVxuXG5cbmZ1bmN0aW9uIHByb3BlcnR5QmluZGluZyhuZXdCaW5kaW5nKXtcbiAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgIHJldHVybiB0aGlzLmJpbmRpbmc7XG4gICAgfVxuXG4gICAgaWYoIWlzLmJpbmRpbmcobmV3QmluZGluZykpe1xuICAgICAgICBuZXdCaW5kaW5nID0gY3JlYXRlQmluZGluZyhuZXdCaW5kaW5nKTtcbiAgICB9XG5cbiAgICBpZihuZXdCaW5kaW5nID09PSB0aGlzLmJpbmRpbmcpe1xuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0eTtcbiAgICB9XG5cbiAgICBpZih0aGlzLmJpbmRpbmcpe1xuICAgICAgICB0aGlzLmJpbmRpbmcucmVtb3ZlTGlzdGVuZXIoJ2NoYW5nZScsIHRoaXMudmFsdWVVcGRhdGUpO1xuICAgIH1cblxuICAgIHRoaXMuYmluZGluZyA9IG5ld0JpbmRpbmc7XG5cbiAgICBpZih0aGlzLm1vZGVsKXtcbiAgICAgICAgdGhpcy5wcm9wZXJ0eS5hdHRhY2godGhpcy5tb2RlbCwgdGhpcy5wcm9wZXJ0eS5fZmlybSk7XG4gICAgfVxuXG4gICAgdGhpcy5iaW5kaW5nLm9uKCdjaGFuZ2UnLCB0aGlzLnZhbHVlVXBkYXRlKTtcbiAgICB0aGlzLnZhbHVlVXBkYXRlKHRoaXMuYmluZGluZygpKTtcblxuICAgIHJldHVybiB0aGlzLnByb3BlcnR5O1xufTtcblxuZnVuY3Rpb24gYXR0YWNoUHJvcGVydHkob2JqZWN0LCBmaXJtKXtcbiAgICBpZihmaXJtZXIodGhpcy5wcm9wZXJ0eSwgZmlybSkpe1xuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0eTtcbiAgICB9XG5cbiAgICB0aGlzLnByb3BlcnR5Ll9maXJtID0gZmlybTtcblxuICAgIGlmKCEob2JqZWN0IGluc3RhbmNlb2YgT2JqZWN0KSl7XG4gICAgICAgIG9iamVjdCA9IHt9O1xuICAgIH1cblxuICAgIGlmKHRoaXMuYmluZGluZyl7XG4gICAgICAgIHRoaXMubW9kZWwgPSBvYmplY3Q7XG4gICAgICAgIHRoaXMuYmluZGluZy5hdHRhY2gob2JqZWN0LCAxKTtcbiAgICB9XG5cbiAgICBpZih0aGlzLnByb3BlcnR5Ll9ldmVudHMgJiYgJ2F0dGFjaCcgaW4gdGhpcy5wcm9wZXJ0eS5fZXZlbnRzKXtcbiAgICAgICAgdGhpcy5wcm9wZXJ0eS5lbWl0KCdhdHRhY2gnLCBvYmplY3QsIDEpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnByb3BlcnR5O1xufTtcblxuZnVuY3Rpb24gZGV0YWNoUHJvcGVydHkoZmlybSl7XG4gICAgaWYoZmlybWVyKHRoaXMucHJvcGVydHksIGZpcm0pKXtcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvcGVydHk7XG4gICAgfVxuXG4gICAgaWYodGhpcy5iaW5kaW5nKXtcbiAgICAgICAgdGhpcy5iaW5kaW5nLnJlbW92ZUxpc3RlbmVyKCdjaGFuZ2UnLCB0aGlzLnZhbHVlVXBkYXRlKTtcbiAgICAgICAgdGhpcy5iaW5kaW5nLmRldGFjaCgxKTtcbiAgICAgICAgdGhpcy5tb2RlbCA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYodGhpcy5wcm9wZXJ0eS5fZXZlbnRzICYmICdkZXRhY2gnIGluIHRoaXMucHJvcGVydHkuX2V2ZW50cyl7XG4gICAgICAgIHRoaXMucHJvcGVydHkuZW1pdCgnZGV0YWNoJywgMSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucHJvcGVydHk7XG59O1xuXG5mdW5jdGlvbiB1cGRhdGVQcm9wZXJ0eSgpe1xuICAgIGlmKCF0aGlzLmRlc3Ryb3llZCl7XG5cbiAgICAgICAgaWYodGhpcy5wcm9wZXJ0eS5fdXBkYXRlKXtcbiAgICAgICAgICAgIHRoaXMucHJvcGVydHkuX3VwZGF0ZSh0aGlzLnByb3BlcnR5Ll92YWx1ZSwgdGhpcy5wcm9wZXJ0eSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnByb3BlcnR5LmVtaXQoJ3VwZGF0ZScsIHRoaXMucHJvcGVydHkuX3ZhbHVlKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMucHJvcGVydHk7XG59O1xuXG5mdW5jdGlvbiBwcm9wZXJ0eVVwZGF0ZXIoZm4pe1xuICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvcGVydHkuX3VwZGF0ZTtcbiAgICB9XG4gICAgdGhpcy5wcm9wZXJ0eS5fdXBkYXRlID0gZm47XG4gICAgcmV0dXJuIHRoaXMucHJvcGVydHk7XG59O1xuXG5mdW5jdGlvbiBkZXN0cm95UHJvcGVydHkoKXtcbiAgICBpZighdGhpcy5kZXN0cm95ZWQpe1xuICAgICAgICB0aGlzLmRlc3Ryb3llZCA9IHRydWU7XG5cbiAgICAgICAgdGhpcy5wcm9wZXJ0eVxuICAgICAgICAgICAgLnJlbW92ZUFsbExpc3RlbmVycygnY2hhbmdlJylcbiAgICAgICAgICAgIC5yZW1vdmVBbGxMaXN0ZW5lcnMoJ3VwZGF0ZScpXG4gICAgICAgICAgICAucmVtb3ZlQWxsTGlzdGVuZXJzKCdhdHRhY2gnKTtcblxuICAgICAgICB0aGlzLnByb3BlcnR5LmVtaXQoJ2Rlc3Ryb3knKTtcbiAgICAgICAgdGhpcy5wcm9wZXJ0eS5kZXRhY2goKTtcbiAgICAgICAgaWYodGhpcy5iaW5kaW5nKXtcbiAgICAgICAgICAgIHRoaXMuYmluZGluZy5kZXN0cm95KHRydWUpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnByb3BlcnR5O1xufTtcblxuZnVuY3Rpb24gcHJvcGVydHlEZXN0cm95ZWQoKXtcbiAgICByZXR1cm4gdGhpcy5kZXN0cm95ZWQ7XG59O1xuXG5mdW5jdGlvbiBhZGRQcm9wZXJ0eVRvKGNvbXBvbmVudCwga2V5KXtcbiAgICBjb21wb25lbnQuc2V0UHJvcGVydHkoa2V5LCB0aGlzLnByb3BlcnR5KTtcblxuICAgIHJldHVybiB0aGlzLnByb3BlcnR5O1xufTtcblxuZnVuY3Rpb24gY3JlYXRlUHJvcGVydHkoY3VycmVudFZhbHVlLCBjaGFuZ2VzLCB1cGRhdGVyKXtcbiAgICBpZih0eXBlb2YgY2hhbmdlcyA9PT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgIHVwZGF0ZXIgPSBjaGFuZ2VzO1xuICAgICAgICBjaGFuZ2VzID0gbnVsbDtcbiAgICB9XG5cbiAgICB2YXIgcHJvcGVydHlTY29wZSA9XG4gICAgICAgIHByb3BlcnR5ID0gcHJvcGVydHlUZW1wbGF0ZS5iaW5kKHByb3BlcnR5U2NvcGUpXG4gICAgICAgIHByb3BlcnR5U2NvcGUgPSB7XG4gICAgICAgIGhhc0NoYW5nZWQ6IGNoYW5nZUNoZWNrZXIoY3VycmVudFZhbHVlLCBjaGFuZ2VzKSxcbiAgICAgICAgdmFsdWVVcGRhdGU6IGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgICAgIHByb3BlcnR5Ll92YWx1ZSA9IHZhbHVlO1xuICAgICAgICAgICAgaWYoIXByb3BlcnR5U2NvcGUuaGFzQ2hhbmdlZCh2YWx1ZSkpe1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHByb3BlcnR5LmVtaXQoJ2NoYW5nZScsIHByb3BlcnR5Ll92YWx1ZSk7XG4gICAgICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICB2YXIgcHJvcGVydHkgPSBwcm9wZXJ0eVNjb3BlLnByb3BlcnR5ID0gcHJvcGVydHlUZW1wbGF0ZS5iaW5kKHByb3BlcnR5U2NvcGUpO1xuXG4gICAgcHJvcGVydHkuX3ZhbHVlID0gY3VycmVudFZhbHVlO1xuICAgIHByb3BlcnR5Ll91cGRhdGUgPSB1cGRhdGVyO1xuXG4gICAgc2V0UHJvdG90eXBlT2YocHJvcGVydHksIHByb3BlcnR5UHJvdG8pO1xuXG4gICAgcHJvcGVydHkuYmluZGluZyA9IHByb3BlcnR5QmluZGluZy5iaW5kKHByb3BlcnR5U2NvcGUpO1xuICAgIHByb3BlcnR5LmF0dGFjaCA9IGF0dGFjaFByb3BlcnR5LmJpbmQocHJvcGVydHlTY29wZSk7XG4gICAgcHJvcGVydHkuZGV0YWNoID0gZGV0YWNoUHJvcGVydHkuYmluZChwcm9wZXJ0eVNjb3BlKTtcbiAgICBwcm9wZXJ0eS51cGRhdGUgPSB1cGRhdGVQcm9wZXJ0eS5iaW5kKHByb3BlcnR5U2NvcGUpO1xuICAgIHByb3BlcnR5LnVwZGF0ZXIgPSBwcm9wZXJ0eVVwZGF0ZXIuYmluZChwcm9wZXJ0eVNjb3BlKTtcbiAgICBwcm9wZXJ0eS5kZXN0cm95ID0gZGVzdHJveVByb3BlcnR5LmJpbmQocHJvcGVydHlTY29wZSk7XG4gICAgcHJvcGVydHkuZGVzdHJveWVkID0gcHJvcGVydHlEZXN0cm95ZWQuYmluZChwcm9wZXJ0eVNjb3BlKTtcbiAgICBwcm9wZXJ0eS5hZGRUbyA9IGFkZFByb3BlcnR5VG8uYmluZChwcm9wZXJ0eVNjb3BlKTtcblxuICAgIHJldHVybiBwcm9wZXJ0eTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gY3JlYXRlUHJvcGVydHk7IiwidmFyIHRvZG8gPSBbXSxcbiAgICB0b2RvS2V5cyA9IFtdLFxuICAgIHNjaGVkdWxlZCxcbiAgICB1cGRhdGVzID0gMDtcblxuZnVuY3Rpb24gcnVuKCl7XG4gICAgdmFyIHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICB3aGlsZSh0b2RvLmxlbmd0aCAmJiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lIDwgMTYpe1xuICAgICAgICB0b2RvS2V5cy5zaGlmdCgpO1xuICAgICAgICB0b2RvLnNoaWZ0KCkoKTtcbiAgICB9XG5cbiAgICBpZih0b2RvLmxlbmd0aCl7XG4gICAgICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZShydW4pO1xuICAgIH1lbHNle1xuICAgICAgICBzY2hlZHVsZWQgPSBmYWxzZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNjaGVkdWxlKGtleSwgZm4pe1xuICAgIGlmKH50b2RvS2V5cy5pbmRleE9mKGtleSkpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdG9kby5wdXNoKGZuKTtcbiAgICB0b2RvS2V5cy5wdXNoKGtleSk7XG5cbiAgICBpZighc2NoZWR1bGVkKXtcbiAgICAgICAgc2NoZWR1bGVkID0gdHJ1ZTtcbiAgICAgICAgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHJ1bik7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHNjaGVkdWxlOyIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZmFzdG4sIGNvbXBvbmVudCwgdHlwZSwgc2V0dGluZ3MsIGNoaWxkcmVuKXtcbiAgICB2YXIgaXRlbU1vZGVsID0gbmV3IGZhc3RuLk1vZGVsKHt9KTtcblxuICAgIGZ1bmN0aW9uIHJlcGxhY2VFbGVtZW50KGVsZW1lbnQpe1xuICAgICAgICBpZihjb21wb25lbnQuZWxlbWVudCAmJiBjb21wb25lbnQuZWxlbWVudC5wYXJlbnROb2RlKXtcbiAgICAgICAgICAgIGNvbXBvbmVudC5lbGVtZW50LnBhcmVudE5vZGUucmVwbGFjZUNoaWxkKGVsZW1lbnQsIGNvbXBvbmVudC5lbGVtZW50KTtcbiAgICAgICAgfVxuICAgICAgICBjb21wb25lbnQuZWxlbWVudCA9IGVsZW1lbnQ7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdXBkYXRlKCl7XG5cbiAgICAgICAgdmFyIHZhbHVlID0gY29tcG9uZW50LmRhdGEoKSxcbiAgICAgICAgICAgIHRlbXBsYXRlID0gY29tcG9uZW50LnRlbXBsYXRlKCk7XG5cbiAgICAgICAgaXRlbU1vZGVsLnNldCgnaXRlbScsIHZhbHVlKTtcblxuICAgICAgICB2YXIgbmV3Q29tcG9uZW50ID0gdGVtcGxhdGUgJiYgZmFzdG4udG9Db21wb25lbnQodGVtcGxhdGUoaXRlbU1vZGVsLCBjb21wb25lbnQuc2NvcGUoKSwgY29tcG9uZW50Ll9jdXJyZW50Q29tcG9uZW50KSk7XG5cbiAgICAgICAgaWYoY29tcG9uZW50Ll9jdXJyZW50Q29tcG9uZW50ICYmIGNvbXBvbmVudC5fY3VycmVudENvbXBvbmVudCAhPT0gbmV3Q29tcG9uZW50KXtcbiAgICAgICAgICAgIGlmKGZhc3RuLmlzQ29tcG9uZW50KGNvbXBvbmVudC5fY3VycmVudENvbXBvbmVudCkpe1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudC5fY3VycmVudENvbXBvbmVudC5kZXN0cm95KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb21wb25lbnQuX2N1cnJlbnRDb21wb25lbnQgPSBuZXdDb21wb25lbnQ7XG5cbiAgICAgICAgaWYoIW5ld0NvbXBvbmVudCl7XG4gICAgICAgICAgICByZXBsYWNlRWxlbWVudChjb21wb25lbnQuZW1wdHlFbGVtZW50KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGZhc3RuLmlzQ29tcG9uZW50KG5ld0NvbXBvbmVudCkpe1xuICAgICAgICAgICAgaWYoY29tcG9uZW50Ll9zZXR0aW5ncy5hdHRhY2hUZW1wbGF0ZXMgIT09IGZhbHNlKXtcbiAgICAgICAgICAgICAgICBuZXdDb21wb25lbnQuYXR0YWNoKGl0ZW1Nb2RlbCwgMik7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBuZXdDb21wb25lbnQuYXR0YWNoKGNvbXBvbmVudC5zY29wZSgpLCAxKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoY29tcG9uZW50LmVsZW1lbnQgJiYgY29tcG9uZW50LmVsZW1lbnQgIT09IG5ld0NvbXBvbmVudC5lbGVtZW50KXtcbiAgICAgICAgICAgICAgICBpZihuZXdDb21wb25lbnQuZWxlbWVudCA9PSBudWxsKXtcbiAgICAgICAgICAgICAgICAgICAgbmV3Q29tcG9uZW50LnJlbmRlcigpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXBsYWNlRWxlbWVudChjb21wb25lbnQuX2N1cnJlbnRDb21wb25lbnQuZWxlbWVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb21wb25lbnQucmVuZGVyID0gZnVuY3Rpb24oKXtcbiAgICAgICAgdmFyIGVsZW1lbnQ7XG4gICAgICAgIGNvbXBvbmVudC5lbXB0eUVsZW1lbnQgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnJyk7XG4gICAgICAgIGlmKGNvbXBvbmVudC5fY3VycmVudENvbXBvbmVudCl7XG4gICAgICAgICAgICBjb21wb25lbnQuX2N1cnJlbnRDb21wb25lbnQucmVuZGVyKCk7XG4gICAgICAgICAgICBlbGVtZW50ID0gY29tcG9uZW50Ll9jdXJyZW50Q29tcG9uZW50LmVsZW1lbnQ7XG4gICAgICAgIH1cbiAgICAgICAgY29tcG9uZW50LmVsZW1lbnQgPSBlbGVtZW50IHx8IGNvbXBvbmVudC5lbXB0eUVsZW1lbnQ7XG4gICAgICAgIGNvbXBvbmVudC5lbWl0KCdyZW5kZXInKTtcbiAgICB9O1xuXG4gICAgY29tcG9uZW50LnNldFByb3BlcnR5KCdkYXRhJyxcbiAgICAgICAgZmFzdG4ucHJvcGVydHkodW5kZWZpbmVkLCBzZXR0aW5ncy5kYXRhQ2hhbmdlcyB8fCAndmFsdWUgc3RydWN0dXJlJylcbiAgICAgICAgICAgIC5vbignY2hhbmdlJywgdXBkYXRlKVxuICAgICk7XG5cbiAgICBjb21wb25lbnQuc2V0UHJvcGVydHkoJ3RlbXBsYXRlJyxcbiAgICAgICAgZmFzdG4ucHJvcGVydHkodW5kZWZpbmVkLCAndmFsdWUnKVxuICAgICAgICAgICAgLm9uKCdjaGFuZ2UnLCB1cGRhdGUpXG4gICAgKTtcblxuICAgIGNvbXBvbmVudC5vbignZGVzdHJveScsIGZ1bmN0aW9uKCl7XG4gICAgICAgIGlmKGZhc3RuLmlzQ29tcG9uZW50KGNvbXBvbmVudC5fY3VycmVudENvbXBvbmVudCkpe1xuICAgICAgICAgICAgY29tcG9uZW50Ll9jdXJyZW50Q29tcG9uZW50LmRlc3Ryb3koKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29tcG9uZW50Lm9uKCdhdHRhY2gnLCBmdW5jdGlvbihkYXRhKXtcbiAgICAgICAgaWYoZmFzdG4uaXNDb21wb25lbnQoY29tcG9uZW50Ll9jdXJyZW50Q29tcG9uZW50KSl7XG4gICAgICAgICAgICBjb21wb25lbnQuX2N1cnJlbnRDb21wb25lbnQuYXR0YWNoKGNvbXBvbmVudC5zY29wZSgpLCAxKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGNvbXBvbmVudDtcbn07IiwiZnVuY3Rpb24gdXBkYXRlVGV4dCgpe1xuICAgIGlmKCF0aGlzLmVsZW1lbnQpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHZhbHVlID0gdGhpcy50ZXh0KCk7XG5cbiAgICB0aGlzLmVsZW1lbnQudGV4dENvbnRlbnQgPSAodmFsdWUgPT0gbnVsbCA/ICcnIDogdmFsdWUpO1xufVxuXG5mdW5jdGlvbiBhdXRvUmVuZGVyKGNvbnRlbnQpe1xuICAgIHRoaXMuZWxlbWVudCA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKGNvbnRlbnQpO1xufVxuXG5mdW5jdGlvbiBhdXRvVGV4dCh0ZXh0LCBmYXN0biwgY29udGVudCkge1xuICAgIHRleHQucmVuZGVyID0gYXV0b1JlbmRlci5iaW5kKHRleHQsIGNvbnRlbnQpO1xuXG4gICAgcmV0dXJuIHRleHQ7XG59XG5cbmZ1bmN0aW9uIHJlbmRlcigpe1xuICAgIHRoaXMuZWxlbWVudCA9IHRoaXMuY3JlYXRlVGV4dE5vZGUodGhpcy50ZXh0KCkpO1xuICAgIHRoaXMuZW1pdCgncmVuZGVyJyk7XG59O1xuXG5mdW5jdGlvbiB0ZXh0Q29tcG9uZW50KGZhc3RuLCBjb21wb25lbnQsIHR5cGUsIHNldHRpbmdzLCBjaGlsZHJlbil7XG4gICAgaWYoc2V0dGluZ3MuYXV0byl7XG4gICAgICAgIGRlbGV0ZSBzZXR0aW5ncy5hdXRvO1xuICAgICAgICBpZighZmFzdG4uaXNCaW5kaW5nKGNoaWxkcmVuWzBdKSl7XG4gICAgICAgICAgICByZXR1cm4gYXV0b1RleHQoY29tcG9uZW50LCBmYXN0biwgY2hpbGRyZW5bMF0pO1xuICAgICAgICB9XG4gICAgICAgIHNldHRpbmdzLnRleHQgPSBjaGlsZHJlbi5wb3AoKTtcbiAgICB9XG5cbiAgICBjb21wb25lbnQuY3JlYXRlVGV4dE5vZGUgPSB0ZXh0Q29tcG9uZW50LmNyZWF0ZVRleHROb2RlO1xuICAgIGNvbXBvbmVudC5yZW5kZXIgPSByZW5kZXIuYmluZChjb21wb25lbnQpO1xuXG4gICAgY29tcG9uZW50LnNldFByb3BlcnR5KCd0ZXh0JywgZmFzdG4ucHJvcGVydHkoJycsIHVwZGF0ZVRleHQuYmluZChjb21wb25lbnQpKSk7XG5cbiAgICByZXR1cm4gY29tcG9uZW50O1xufVxuXG50ZXh0Q29tcG9uZW50LmNyZWF0ZVRleHROb2RlID0gZnVuY3Rpb24odGV4dCl7XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKHRleHQpO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSB0ZXh0Q29tcG9uZW50OyJdfQ==
